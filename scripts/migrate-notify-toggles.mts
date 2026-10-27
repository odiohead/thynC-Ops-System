/**
 * 알림 설정 재편 마이그레이션 (2026-10-27, projects/domain_event_notify_design.md) — 구 3겹 토글 → 이벤트 사용 여부 + 라우트 조건
 *   npx tsx --tsconfig tsconfig.json scripts/migrate-notify-toggles.mts [--apply]   (기본 dry-run)
 *
 * ① notify_event_toggles(created/statusChanged/…) → notify_event_enabled {TICKET_CREATED: bool, …} (카탈로그 legacyToggle 매핑, 없는 키는 true)
 * ② notify_types_enabled 에서 꺼진 업무 타입이 있으면 — 업무 유형 조건이 비어 있는(=전체) 라우트의 ref_types 를 "켜진 타입"으로 채워 현재 동작 보존
 *    (TaskType → refType: TICKET→NONE, 그 외 동일 키). 이후 notify_types_enabled 는 전부 true 로 기록(참조 코드 제거됨)
 * ③ notify_events_enabled 가 off 면 notify_enabled 도 off (전역 하나로 통합), notify_events_enabled=on
 * idempotent: 이미 notify_event_enabled 가 있으면 ①은 건너뜀
 */
import { prisma } from '../lib/prisma'
import { NOTIFY_EVENTS, NOTIFY_EVENT_ENABLED_KEY } from '../lib/notify-events'

const apply = process.argv.includes('--apply')
const TASK_TO_REF: Record<string, string> = { PROJECT: 'PROJECT', SITE_VISIT: 'SITE_VISIT', INSTALL_PLAN: 'INSTALL_PLAN', MAINTENANCE: 'MAINTENANCE', ETC: 'ETC', VOC: 'VOC', STOCK_OUT: 'STOCK_OUT', AS: 'AS', TICKET: 'NONE' }
const get = async (key: string) => (await prisma.appSetting.findUnique({ where: { key } }))?.value ?? null
const up = (key: string, value: string) => prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })

const existing = await get(NOTIFY_EVENT_ENABLED_KEY)
const toggles = JSON.parse((await get('notify_event_toggles')) ?? '{}') as Record<string, boolean>
const types = JSON.parse((await get('notify_types_enabled')) ?? '{}') as Record<string, boolean>
const eventsEnabled = (await get('notify_events_enabled')) ?? 'on'
const enabled = (await get('notify_enabled')) ?? 'off'

// ①
const map: Record<string, boolean> = {}
for (const e of NOTIFY_EVENTS) map[e.key] = e.legacyToggle ? toggles[e.legacyToggle] !== false : true
console.log(`① notify_event_enabled ${existing ? '(이미 있음 — 건너뜀)' : ''}:`, JSON.stringify(map))

// ②
const disabled = Object.keys(TASK_TO_REF).filter((t) => types[t] === false)
const enabledRefs = Object.entries(TASK_TO_REF).filter(([t]) => types[t] !== false).map(([, r]) => r)
const routes = await prisma.notifyRoute.findMany({ where: { refTypes: { isEmpty: true }, eventType: { notIn: ['DAILY_DIGEST'] } }, select: { id: true, name: true, eventType: true } })
console.log(`② 꺼진 업무 타입: [${disabled.join(', ')}] → 전체 대상 라우트 ${routes.length}건의 업무 유형 조건을 [${disabled.length ? enabledRefs.join(', ') : '(변경 없음)'}]로`)
for (const r of routes) console.log(`   - #${r.id} ${r.name} (${r.eventType})`)

// ③
console.log(`③ notify_enabled=${enabled}, notify_events_enabled=${eventsEnabled} → notify_enabled=${eventsEnabled === 'off' ? 'off' : enabled}, notify_events_enabled=on`)

if (!apply) { console.log('\n(dry-run — --apply 로 실행)'); await prisma.$disconnect(); process.exit(0) }

await prisma.$transaction([
  ...(existing ? [] : [up(NOTIFY_EVENT_ENABLED_KEY, JSON.stringify(map))]),
  ...(disabled.length ? routes.map((r) => prisma.notifyRoute.update({ where: { id: r.id }, data: { refTypes: enabledRefs } })) : []),
  up('notify_types_enabled', JSON.stringify(Object.fromEntries(Object.keys(TASK_TO_REF).map((t) => [t, true])))),
  ...(eventsEnabled === 'off' ? [up('notify_enabled', 'off')] : []),
  up('notify_events_enabled', 'on'),
])
console.log('적용 완료')
await prisma.$disconnect()
