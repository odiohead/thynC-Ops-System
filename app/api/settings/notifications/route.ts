import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { FIELD_CATALOG, DEFAULT_FIELDS, TASK_TYPES, TASK_TYPE_LABELS } from '@/lib/notifyFields'
import { startNotifyScheduler, getNotifyInterval } from '@/lib/notify-scheduler'
import { getDelayRules, getStatusDwellRules, DEFAULT_DELAY_RULES, type DelayRules, type StatusDwellRules } from '@/lib/delay-rules'
import { getTypesEnabled, type TaskType } from '@/lib/notify'

const DELAY_INTERVALS = ['off', '1h', '6h', '24h']
const PRIORITIES = ['긴급', '높음', '보통', '낮음']

/** 지연 기준 규칙 정제(음수·비수치 방지, 미지정은 기본값) */
function sanitizeDelayRules(input: unknown): DelayRules {
  const r = (input ?? {}) as Partial<DelayRules>
  const num = (v: unknown, def: number) => {
    const n = Math.floor(Number(v))
    return Number.isFinite(n) && n >= 0 ? n : def
  }
  const md = (r.maintenanceDays ?? {}) as Record<string, unknown>
  const maintenanceDays: Record<string, number> = {}
  for (const p of PRIORITIES) maintenanceDays[p] = num(md[p], DEFAULT_DELAY_RULES.maintenanceDays[p])
  return {
    siteVisitDays: num(r.siteVisitDays, DEFAULT_DELAY_RULES.siteVisitDays),
    installPlanDays: num(r.installPlanDays, DEFAULT_DELAY_RULES.installPlanDays),
    etcDays: num(r.etcDays, DEFAULT_DELAY_RULES.etcDays),
    projectGraceDays: num(r.projectGraceDays, DEFAULT_DELAY_RULES.projectGraceDays),
    maintenanceDays,
  }
}

const DWELL_TYPES = ['PROJECT', 'SITE_VISIT', 'MAINTENANCE', 'ETC'] as const

/** 단계 체류 규칙 정제 — 값이 양의 정수인 항목만 유지 (0/빈값 = 미사용) */
function sanitizeStatusDwell(input: unknown): StatusDwellRules {
  const src = (input ?? {}) as Record<string, Record<string, unknown>>
  const out: StatusDwellRules = {}
  for (const t of DWELL_TYPES) {
    const m = src[t]
    if (!m || typeof m !== 'object') continue
    const clean: Record<string, number> = {}
    for (const [status, v] of Object.entries(m)) {
      const n = Math.floor(Number(v))
      if (Number.isFinite(n) && n > 0) clean[status] = n
    }
    if (Object.keys(clean).length) out[t] = clean
  }
  return out
}

/** 단계 체류 설정 UI용 — 타입별 선택 가능한 상태 목록 (판정에서 제외되는 완료·보류성 상태는 뺌) */
async function getStatusOptions(): Promise<Record<string, string[]>> {
  const [codes, buildStatuses] = await Promise.all([
    prisma.statusCode.findMany({
      where: { category: { in: ['SITE_VISIT', 'MAINTENANCE_STATUS', 'ETC_TASK_STATUS'] } },
      select: { category: true, name: true },
      orderBy: { order: 'asc' },
    }),
    prisma.buildStatus.findMany({ select: { label: true }, orderBy: { sortOrder: 'asc' } }),
  ])
  const byCat = (cat: string, exclude: string[]) =>
    codes.filter((c) => c.category === cat && !exclude.includes(c.name)).map((c) => c.name)
  return {
    PROJECT: buildStatuses.map((b) => b.label).filter((l) => !l.includes('완료') && !l.includes('보류')),
    SITE_VISIT: byCat('SITE_VISIT', ['회신완료']),
    MAINTENANCE: byCat('MAINTENANCE_STATUS', ['완료', '보류']),
    ETC: byCat('ETC_TASK_STATUS', ['완료', '보류']),
  }
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

export async function GET(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser || !isAdminOrAbove(authUser.role)) {
    return NextResponse.json({ error: '권한 없음' }, { status: 403 })
  }

  const rows = await prisma.appSetting.findMany({
    where: { key: { in: ['notify_enabled', 'notify_events_enabled', 'notify_delay_interval', 'notify_dm_enabled'] } },
  })
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))

  return NextResponse.json({
    enabled: (map['notify_enabled'] ?? 'off') === 'on',
    eventsEnabled: (map['notify_events_enabled'] ?? 'on') !== 'off',
    delayInterval: map['notify_delay_interval'] ?? 'off',
    activeDelayInterval: getNotifyInterval(),
    dmEnabled: (map['notify_dm_enabled'] ?? 'off') === 'on',
    typesEnabled: await getTypesEnabled(),
    delayRules: await getDelayRules(),
    statusDwell: await getStatusDwellRules(),
    statusOptions: await getStatusOptions(),
    priorities: PRIORITIES,
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
  const { enabled, eventsEnabled, fields, delayInterval, dmEnabled, delayRules, statusDwell, typesEnabled } = body
  const delayVal = DELAY_INTERVALS.includes(delayInterval) ? delayInterval : 'off'
  const dmVal = dmEnabled ? 'on' : 'off'
  const cleanRules = sanitizeDelayRules(delayRules)
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

  await prisma.$transaction([
    prisma.appSetting.upsert({ where: { key: 'notify_enabled' }, update: { value: enabledVal }, create: { key: 'notify_enabled', value: enabledVal } }),
    prisma.appSetting.upsert({ where: { key: 'notify_events_enabled' }, update: { value: eventsVal }, create: { key: 'notify_events_enabled', value: eventsVal } }),
    prisma.appSetting.upsert({ where: { key: 'notify_event_fields' }, update: { value: JSON.stringify(clean) }, create: { key: 'notify_event_fields', value: JSON.stringify(clean) } }),
    prisma.appSetting.upsert({ where: { key: 'notify_delay_interval' }, update: { value: delayVal }, create: { key: 'notify_delay_interval', value: delayVal } }),
    prisma.appSetting.upsert({ where: { key: 'notify_dm_enabled' }, update: { value: dmVal }, create: { key: 'notify_dm_enabled', value: dmVal } }),
    prisma.appSetting.upsert({ where: { key: 'notify_delay_rules' }, update: { value: JSON.stringify(cleanRules) }, create: { key: 'notify_delay_rules', value: JSON.stringify(cleanRules) } }),
    prisma.appSetting.upsert({ where: { key: 'notify_status_dwell' }, update: { value: JSON.stringify(cleanDwell) }, create: { key: 'notify_status_dwell', value: JSON.stringify(cleanDwell) } }),
    prisma.appSetting.upsert({ where: { key: 'notify_types_enabled' }, update: { value: JSON.stringify(cleanTypes) }, create: { key: 'notify_types_enabled', value: JSON.stringify(cleanTypes) } }),
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
    after: { enabled, eventsEnabled, delayInterval: delayVal, dmEnabled: dmVal, typesEnabled: cleanTypes, delayRules: cleanRules, statusDwell: cleanDwell, fields: clean },
  })

  return NextResponse.json({ message: '저장되었습니다.', fields: clean })
}
