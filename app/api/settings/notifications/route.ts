import { NextRequest, NextResponse } from 'next/server'
import { TicketSeverity, TicketStatus } from '@prisma/client'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { FIELD_CATALOG, DEFAULT_FIELDS, TASK_TYPES, TASK_TYPE_LABELS } from '@/lib/notifyFields'
import { startNotifyScheduler, getNotifyInterval } from '@/lib/notify-scheduler'
import { getSlaRules, getTicketDwellRules, DEFAULT_SLA_RULES, type SlaRules, type TicketDwellRules } from '@/lib/delay-rules'
import { getTypesEnabled, getEventToggles, type TaskType, type TicketEventToggles } from '@/lib/notify'
import { TICKET_STATUS_LABELS, TICKET_SEVERITY_LABELS } from '@/lib/ticket-shared'

const DELAY_INTERVALS = ['off', '1h', '6h', '24h']
const SEVERITIES = Object.values(TicketSeverity) as TicketSeverity[]
// 체류 설정 대상 상태 (CLOSED는 터미널이라 제외)
const DWELL_STATUSES = (Object.values(TicketStatus) as TicketStatus[]).filter((s) => s !== 'CLOSED')

/** Sev별 SLA 규칙 정제 (음수·비수치 방지, 미지정은 기본값. 0 = SLA 미적용) */
function sanitizeSlaRules(input: unknown): SlaRules {
  const r = (input ?? {}) as Partial<SlaRules>
  const num = (v: unknown, def: number) => {
    const n = Math.floor(Number(v))
    return Number.isFinite(n) && n >= 0 ? n : def
  }
  const days = {} as Record<TicketSeverity, number>
  const src = (r.days ?? {}) as Record<string, unknown>
  for (const s of SEVERITIES) days[s] = num(src[s], DEFAULT_SLA_RULES.days[s])
  return { days, warnDays: num(r.warnDays, DEFAULT_SLA_RULES.warnDays) }
}

/** 티켓 상태 체류 규칙 정제 — 값이 양의 정수인 상태만 유지 (0/빈값 = 미사용) */
function sanitizeStatusDwell(input: unknown): TicketDwellRules {
  const src = (input ?? {}) as Record<string, unknown>
  const out: TicketDwellRules = {}
  for (const s of DWELL_STATUSES) {
    const n = Math.floor(Number(src[s]))
    if (Number.isFinite(n) && n > 0) out[s] = n
  }
  return out
}

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
    where: { key: { in: ['notify_enabled', 'notify_events_enabled', 'notify_delay_interval', 'notify_dm_enabled', 'notify_assign_dm', 'notify_queue_mentions', 'notify_sev1_channel'] } },
  })
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))

  return NextResponse.json({
    enabled: (map['notify_enabled'] ?? 'off') === 'on',
    eventsEnabled: (map['notify_events_enabled'] ?? 'on') !== 'off',
    delayInterval: map['notify_delay_interval'] ?? 'off',
    activeDelayInterval: getNotifyInterval(),
    dmEnabled: (map['notify_dm_enabled'] ?? 'off') === 'on',
    assignDm: (map['notify_assign_dm'] ?? 'on') !== 'off',
    queueMentions: (map['notify_queue_mentions'] ?? 'on') !== 'off',
    sev1Channel: (map['notify_sev1_channel'] ?? 'on') !== 'off',
    eventToggles: await getEventToggles(),
    autoCloseDays: await readIntSetting('ticket_auto_close_days', 0),
    typesEnabled: await getTypesEnabled(),
    slaRules: await getSlaRules(),
    statusDwell: await getTicketDwellRules(),
    severities: SEVERITIES.map((s) => ({ value: s, label: TICKET_SEVERITY_LABELS[s] })),
    dwellStatuses: DWELL_STATUSES.map((s) => ({ value: s, label: TICKET_STATUS_LABELS[s] })),
    fields: await readFields(),
    catalog: FIELD_CATALOG,
    labels: TASK_TYPE_LABELS,
    taskTypes: TASK_TYPES,
    mode: process.env.SLACK_NOTIFY_MODE || 'off',
  })
}

export async function PUT(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser || !isAdminOrAbove(authUser.role)) {
    return NextResponse.json({ error: '권한 없음' }, { status: 403 })
  }

  const body = await request.json()
  const { enabled, eventsEnabled, fields, delayInterval, dmEnabled, assignDm, queueMentions, sev1Channel, eventToggles, autoCloseDays, slaRules, statusDwell, typesEnabled } = body
  const delayVal = DELAY_INTERVALS.includes(delayInterval) ? delayInterval : 'off'
  const dmVal = dmEnabled ? 'on' : 'off'
  const assignDmVal = assignDm === false ? 'off' : 'on'
  const queueMentionsVal = queueMentions === false ? 'off' : 'on'
  const sev1ChannelVal = sev1Channel === false ? 'off' : 'on'
  const et = (eventToggles ?? {}) as Partial<TicketEventToggles>
  const cleanEventToggles: TicketEventToggles = {
    created: et.created !== false,
    statusChanged: et.statusChanged !== false,
    queueTransferred: et.queueTransferred !== false,
    sevEscalated: et.sevEscalated !== false,
  }
  const autoCloseNum = Math.floor(Number(autoCloseDays))
  const autoCloseVal = String(Number.isFinite(autoCloseNum) && autoCloseNum >= 0 ? autoCloseNum : 0)
  const cleanSla = sanitizeSlaRules(slaRules)
  const cleanDwell = sanitizeStatusDwell(statusDwell)
  // 업무 타입별 on/off — 명시적으로 false인 것만 off, 나머지 on
  const cleanTypes = {} as Record<TaskType, boolean>
  for (const t of TASK_TYPES) cleanTypes[t] = !(typesEnabled && typesEnabled[t] === false)

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
    upsert('notify_delay_interval', delayVal),
    upsert('notify_dm_enabled', dmVal),
    upsert('notify_assign_dm', assignDmVal),
    upsert('notify_queue_mentions', queueMentionsVal),
    upsert('notify_sev1_channel', sev1ChannelVal),
    upsert('notify_event_toggles', JSON.stringify(cleanEventToggles)),
    upsert('ticket_auto_close_days', autoCloseVal),
    upsert('notify_sla_rules', JSON.stringify(cleanSla)),
    upsert('notify_status_dwell', JSON.stringify(cleanDwell)),
    upsert('notify_types_enabled', JSON.stringify(cleanTypes)),
  ])

  // 지연 감지 스케줄러 즉시 반영
  startNotifyScheduler(delayVal)

  await logAudit({
    req: request,
    actor: auditActorFromJWT(authUser),
    action: 'UPDATE',
    resource: 'setting:notifications',
    resourceId: 'notifications',
    resourceLabel: 'Slack 알림 설정',
    after: { enabled, eventsEnabled, delayInterval: delayVal, dmEnabled: dmVal, assignDm: assignDmVal, queueMentions: queueMentionsVal, sev1Channel: sev1ChannelVal, eventToggles: cleanEventToggles, autoCloseDays: autoCloseVal, typesEnabled: cleanTypes, slaRules: cleanSla, statusDwell: cleanDwell, fields: clean },
  })

  return NextResponse.json({ message: '저장되었습니다.', fields: clean })
}
