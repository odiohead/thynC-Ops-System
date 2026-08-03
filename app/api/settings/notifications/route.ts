import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { FIELD_CATALOG, DEFAULT_FIELDS, TASK_TYPES, TASK_TYPE_LABELS } from '@/lib/notifyFields'
import { startNotifyScheduler, TICK_OPTIONS, DEFAULT_TICK } from '@/lib/notify-scheduler'
import { getTypesEnabled, getEventToggles, type TaskType, type TicketEventToggles } from '@/lib/notify'

/**
 * 알림 전역 설정 (v2 P1 재편 — notification_v2_design.md)
 * 폐기된 키: notify_delay_interval·notify_dm_enabled·notify_dm_policy·notify_assign_dm(DM 폐기),
 *            notify_sla_rules·notify_status_dwell(SLA 정책으로 일원화)
 * 추가된 키: notify_digest_hour·notify_digest_channel_id (전역 SLA 초과 요약 — P4)
 */

/** notify_event_fields(JSON) → 타입별 필드 배열. 미지정 타입은 추천 기본값 */
async function readFields(): Promise<Record<TaskType, string[]>> {
  const row = await prisma.appSetting.findUnique({ where: { key: 'notify_event_fields' } })
  let parsed: Partial<Record<TaskType, string[]>> = {}
  if (row?.value) {
    try {
      parsed = JSON.parse(row.value)
    } catch {
      parsed = {}
    }
  }
  const result = {} as Record<TaskType, string[]>
  for (const t of TASK_TYPES) {
    result[t] = Array.isArray(parsed[t]) ? parsed[t]! : DEFAULT_FIELDS[t]
  }
  return result
}

async function readIntSetting(key: string, def: number): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key } })
  const n = Math.floor(Number(row?.value))
  return Number.isFinite(n) && n >= 0 ? n : def
}

export async function GET(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser || !isAdminOrAbove(authUser.role)) {
    return NextResponse.json({ error: '권한 없음' }, { status: 403 })
  }

  const rows = await prisma.appSetting.findMany({
    where: {
      key: {
        in: [
          'notify_enabled', 'notify_events_enabled', 'notify_tick_interval', 'notify_breach_tick_cap',
          'notify_queue_mentions', 'notify_sev1_channel', 'notify_digest_hour', 'notify_digest_channel_id',
        ],
      },
    },
  })
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))

  const digestChannelId = parseInt(map['notify_digest_channel_id'] ?? '')
  const channels = await prisma.notifyChannel.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, slackChannelId: true },
  })

  return NextResponse.json({
    enabled: (map['notify_enabled'] ?? 'off') === 'on',
    eventsEnabled: (map['notify_events_enabled'] ?? 'on') !== 'off',
    tickInterval: map['notify_tick_interval'] ?? DEFAULT_TICK,
    breachTickCap: parseInt(map['notify_breach_tick_cap'] ?? '20') || 20,
    tickOptions: TICK_OPTIONS,
    queueMentions: (map['notify_queue_mentions'] ?? 'on') !== 'off',
    sev1Channel: (map['notify_sev1_channel'] ?? 'on') !== 'off',
    // 전역 SLA 초과 요약 (P4) — 시각(KST 0~23, -1 = off) + 채널
    digestHour: Number.isFinite(parseInt(map['notify_digest_hour'] ?? '')) ? parseInt(map['notify_digest_hour']!) : -1,
    digestChannelId: Number.isFinite(digestChannelId) ? digestChannelId : null,
    channels,
    eventToggles: await getEventToggles(),
    autoCloseDays: await readIntSetting('ticket_auto_close_days', 0),
    typesEnabled: await getTypesEnabled(),
    fields: await readFields(),
    catalog: FIELD_CATALOG,
    labels: TASK_TYPE_LABELS,
    taskTypes: TASK_TYPES,
    mode: process.env.SLACK_NOTIFY_MODE || 'off', // 발송 모드는 env 소유 (읽기 전용 표시)
  })
}

export async function PUT(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser || !isAdminOrAbove(authUser.role)) {
    return NextResponse.json({ error: '권한 없음' }, { status: 403 })
  }

  const body = await request.json()
  const {
    enabled, eventsEnabled, fields, tickInterval, breachTickCap,
    queueMentions, sev1Channel, eventToggles, autoCloseDays, typesEnabled,
    digestHour, digestChannelId,
  } = body

  // F3 수정: tick·cap은 페이로드에 있을 때만 갱신 (누락 시 기존값 유지 — 조용한 5m 리셋 방지)
  const tickProvided = (TICK_OPTIONS as readonly string[]).includes(tickInterval)
  const capNum = Math.floor(Number(breachTickCap))
  const capProvided = Number.isFinite(capNum) && capNum > 0

  const queueMentionsVal = queueMentions === false ? 'off' : 'on'
  const sev1ChannelVal = sev1Channel === false ? 'off' : 'on'
  const et = (eventToggles ?? {}) as Partial<TicketEventToggles>
  const cleanEventToggles: TicketEventToggles = {
    created: et.created !== false,
    statusChanged: et.statusChanged !== false,
    queueTransferred: et.queueTransferred !== false,
    sevEscalated: et.sevEscalated !== false,
    assigned: et.assigned !== false,
  }
  const autoCloseNum = Math.floor(Number(autoCloseDays))
  const autoCloseVal = String(Number.isFinite(autoCloseNum) && autoCloseNum >= 0 ? autoCloseNum : 0)
  const cleanTypes = {} as Record<TaskType, boolean>
  for (const t of TASK_TYPES) cleanTypes[t] = !(typesEnabled && typesEnabled[t] === false)

  // 전역 요약: 시각 0~23만 유효, 그 외 -1(off). 채널은 존재 검증
  const digestHourNum = Math.floor(Number(digestHour))
  const digestHourVal = Number.isFinite(digestHourNum) && digestHourNum >= 0 && digestHourNum <= 23 ? String(digestHourNum) : '-1'
  let digestChannelVal = ''
  const digestChNum = Math.floor(Number(digestChannelId))
  if (Number.isFinite(digestChNum) && digestChNum > 0) {
    const ch = await prisma.notifyChannel.findUnique({ where: { id: digestChNum }, select: { id: true } })
    if (ch) digestChannelVal = String(ch.id)
  }

  // 필드는 카탈로그에 있는 key만 허용 (미지정 타입은 기본값)
  const clean = {} as Record<TaskType, string[]>
  for (const t of TASK_TYPES) {
    const validKeys = new Set(FIELD_CATALOG[t].map((f) => f.key))
    const sel = fields && Array.isArray(fields[t]) ? (fields[t] as string[]).filter((k) => validKeys.has(k)) : DEFAULT_FIELDS[t]
    clean[t] = sel
  }

  const enabledVal = enabled ? 'on' : 'off'
  const eventsVal = eventsEnabled ? 'on' : 'off'

  const upsert = (key: string, value: string) =>
    prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })

  await prisma.$transaction([
    upsert('notify_enabled', enabledVal),
    upsert('notify_events_enabled', eventsVal),
    upsert('notify_event_fields', JSON.stringify(clean)),
    ...(tickProvided ? [upsert('notify_tick_interval', tickInterval)] : []),
    ...(capProvided ? [upsert('notify_breach_tick_cap', String(capNum))] : []),
    upsert('notify_queue_mentions', queueMentionsVal),
    upsert('notify_sev1_channel', sev1ChannelVal),
    upsert('notify_digest_hour', digestHourVal),
    upsert('notify_digest_channel_id', digestChannelVal),
    upsert('notify_event_toggles', JSON.stringify(cleanEventToggles)),
    upsert('ticket_auto_close_days', autoCloseVal),
    upsert('notify_types_enabled', JSON.stringify(cleanTypes)),
  ])

  // tick 주기가 실제로 바뀐 요청일 때만 스케줄러 재기동
  if (tickProvided) startNotifyScheduler(tickInterval)

  await logAudit({
    req: request,
    actor: auditActorFromJWT(authUser),
    action: 'UPDATE',
    resource: 'setting:notifications',
    resourceId: 'notifications',
    resourceLabel: 'Slack 알림 설정',
    after: {
      enabled, eventsEnabled,
      ...(tickProvided ? { tickInterval } : {}),
      ...(capProvided ? { breachTickCap: capNum } : {}),
      queueMentions: queueMentionsVal, sev1Channel: sev1ChannelVal,
      digestHour: digestHourVal, digestChannelId: digestChannelVal || null,
      eventToggles: cleanEventToggles, autoCloseDays: autoCloseVal, typesEnabled: cleanTypes, fields: clean,
    },
  })

  return NextResponse.json({ message: '저장되었습니다.', fields: clean })
}
