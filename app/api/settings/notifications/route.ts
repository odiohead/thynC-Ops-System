import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { FIELD_CATALOG, DEFAULT_FIELDS, TASK_TYPES, TASK_TYPE_LABELS } from '@/lib/notifyFields'
import { startNotifyScheduler, TICK_OPTIONS, DEFAULT_TICK } from '@/lib/notify-scheduler'
import { getEventEnabledMap, type TaskType } from '@/lib/notify'
import { NOTIFY_EVENTS, NOTIFY_EVENT_GROUPS, NOTIFY_EVENT_ENABLED_KEY } from '@/lib/notify-events'

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
    // 2026-10-27 재편: 이벤트별 사용 여부(카탈로그 키) — 구 eventToggles·typesEnabled 대체
    eventEnabled: await getEventEnabledMap(),
    events: NOTIFY_EVENTS,
    eventGroups: NOTIFY_EVENT_GROUPS,
    autoCloseDays: await readIntSetting('ticket_auto_close_days', 0),
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
    enabled, fields, tickInterval, breachTickCap,
    queueMentions, sev1Channel, eventEnabled, autoCloseDays,
    digestHour, digestChannelId,
  } = body
  // 전역 on/off 하나로 통합 (구 notify_events_enabled는 항상 on으로 기록 — 재편 2026-10-27)
  const eventsEnabled = true

  // F3 수정: tick·cap은 페이로드에 있을 때만 갱신 (누락 시 기존값 유지 — 조용한 5m 리셋 방지)
  const tickProvided = (TICK_OPTIONS as readonly string[]).includes(tickInterval)
  const capNum = Math.floor(Number(breachTickCap))
  const capProvided = Number.isFinite(capNum) && capNum > 0

  const queueMentionsVal = queueMentions === false ? 'off' : 'on'
  const sev1ChannelVal = sev1Channel === false ? 'off' : 'on'
  // 이벤트별 사용 여부 — 카탈로그에 있는 키만, 미지정은 on (페이로드에 없으면 기존값 유지)
  const eventEnabledProvided = eventEnabled && typeof eventEnabled === 'object'
  const cleanEventEnabled: Record<string, boolean> = {}
  if (eventEnabledProvided) for (const e of NOTIFY_EVENTS) cleanEventEnabled[e.key] = (eventEnabled as Record<string, unknown>)[e.key] !== false
  const autoCloseNum = Math.floor(Number(autoCloseDays))
  const autoCloseVal = String(Number.isFinite(autoCloseNum) && autoCloseNum >= 0 ? autoCloseNum : 0)

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
    ...(eventEnabledProvided ? [upsert(NOTIFY_EVENT_ENABLED_KEY, JSON.stringify(cleanEventEnabled))] : []),
    upsert('ticket_auto_close_days', autoCloseVal),
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
      ...(eventEnabledProvided ? { eventEnabled: cleanEventEnabled } : {}), autoCloseDays: autoCloseVal, fields: clean,
    },
  })

  return NextResponse.json({ message: '저장되었습니다.', fields: clean })
}
