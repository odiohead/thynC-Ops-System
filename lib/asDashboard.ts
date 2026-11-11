/**
 * AS 대시보드 집계 (projects/as_dashboard_design.md §3 — 지표 정의의 단일 소스, 2026-11-11)
 *
 * 화면 `/as-receipts/dashboard`의 4개 탭이 각각 한 섹션을 부른다: now(현황) · period(기간 분석) · hospitals(병원별) · quality(기기·품질).
 * 공통 필터 = 기간(from~to) · 구분(고장/분실) · 기기군(심전계/산소포화도/기타) · 병원. '현황'만 기간을 쓰지 않는다(조회 시점 스냅샷).
 *
 * 공통 규칙 (기존 화면과 같은 정의를 쓴다 — 숫자가 서로 달라지면 안 됨)
 * - 미종결 접수 = 상태 없음 또는 ticket_status ∉ (RESOLVED, CLOSED) — 목록 요약 스트립(`/api/as-receipts/summary`)과 동일
 * - 물량 집계에서 '취소' 접수와 라인취소(CANCELED)는 제외 — VOC·AS 주간 대시보드(lib/vocDashboard.ts)와 동일
 * - 기기군은 `asDeviceGroupOf`(원장 모델명 → 미등록 기기종류 → 시리얼 접두) 단일 소스. SQL로 다시 구현하지 않고 라인을 읽어 JS에서 접는다
 * - 수리 대기·입고 예정은 수리대기 큐(`asQueueBucketWhere`)를 그대로 호출 — 큐 화면 건수와 항상 같다
 * - 확인필요는 목록 `needsCheck=1` 필터(`findAsNeedsCheckReceiptIds`)와 같은 SQL
 * - 분실 한도·라이트 한도는 `lib/asLostQuota`·`lib/asDealQuota`의 정의 그대로(병원 1곳은 기존 함수, 표는 일괄 함수)
 * - 귀속 기준일: 접수 = receipt_date, 완료 = resolved_at, 발송 = 라인 shipped_at, 회수기기 처리 = 라인 repaired_at (모두 DATE — 문자열 YYYY-MM-DD로 비교)
 * - 기기군 필터가 켜지면 라인은 그 기기군만, 접수는 그 기기군 라인을 1대 이상 가진 건만 센다
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  asDeviceGroupOf, AS_DEVICE_GROUPS, AS_DEVICE_GROUP_TO_CODE, AS_DEVICE_GROUP_CODE_LIST, AS_DEVICE_GROUP_CODE_LABELS,
  AS_CATEGORIES, AS_OUTCOME_LABELS, AS_PICKUP_METHOD_LABELS, AS_SHIP_METHOD_LABELS, AS_TAGS, AS_TAG_LABELS, AS_TAG_FIELDS,
  AS_REPAIR_RESULTS, AS_REPAIR_RESULT_LABELS, AS_QUEUE_BUCKET_LABELS, AS_QUEUE_BUCKET_DESC, AS_SERIAL_RE,
  type AsCategory, type AsDeviceGroup, type AsDeviceGroupCode, type AsLostQuota, type AsDealQuota, type AsOutcome, type AsRepairResult,
} from '@/lib/asReceiptShared'
import { asQueueBucketWhere, asDeviceGroupWhere } from '@/lib/asReceiptQueue'
import { findAsNeedsCheckReceiptIds } from '@/lib/asReceiptSearch'
import { computeAsLostQuota, computeAsLostQuotaAll, type AsLostQuotaHospital } from '@/lib/asLostQuota'
import { computeAsDealQuota, computeAsLiteQuotaAll, type AsLiteQuotaHospital } from '@/lib/asDealQuota'

// ─── 날짜 (전부 KST 달력일 문자열) ───
const DAY = 86_400_000
const toMs = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`)
const isYmd = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toMs(s))
const addDays = (ymd: string, n: number) => new Date(toMs(ymd) + n * DAY).toISOString().slice(0, 10)
const diffDays = (a: string, b: string) => Math.round((toMs(a) - toMs(b)) / DAY)
const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
const mondayOf = (ymd: string) => addDays(ymd, -((new Date(toMs(ymd)).getUTCDay() + 6) % 7))
const within = (d: string | null | undefined, from: string, to: string) => !!d && d >= from && d <= to
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`

// ─── 필터 ───
export const AS_DASH_SECTIONS = ['now', 'period', 'hospitals', 'quality'] as const
export type AsDashSection = (typeof AS_DASH_SECTIONS)[number]
export const AS_DASH_DEFAULT_DAYS = 30
export interface AsDashFilter { from: string; to: string; category: AsCategory | null; group: AsDeviceGroupCode | null; hospitalCode: string | null; hospitalName: string | null }
export interface AsDashRange { from: string; to: string; days: number; prevFrom: string; prevTo: string }

/** 쿼리 파라미터 → 필터. `from=all`이면 가장 오래된 접수일부터. 잘못된 값은 기본값(최근 30일)으로 */
export async function resolveAsDashFilter(sp: URLSearchParams): Promise<AsDashFilter> {
  const today = todayKst()
  const toRaw = sp.get('to')
  const to = isYmd(toRaw) ? toRaw : today
  let from = addDays(to, -(AS_DASH_DEFAULT_DAYS - 1))
  const fromRaw = sp.get('from')
  if (fromRaw === 'all') {
    const r = await prisma.$queryRaw<{ d: string | null }[]>`SELECT min(receipt_date)::text AS d FROM as_receipts`
    if (isYmd(r[0]?.d)) from = r[0]!.d as string
  } else if (isYmd(fromRaw)) from = fromRaw
  if (from > to) from = to
  const category = sp.get('category')
  const group = sp.get('group')
  // 병원 — 코드가 실제 병원일 때만 필터로 인정(이름은 화면 표시용으로 함께 돌려준다)
  const hospitalParam = sp.get('hospital')?.trim()
  const hospital = hospitalParam ? await prisma.hospital.findUnique({ where: { hospitalCode: hospitalParam }, select: { hospitalCode: true, hospitalName: true } }) : null
  return {
    from, to,
    category: (AS_CATEGORIES as readonly string[]).includes(category ?? '') ? (category as AsCategory) : null,
    group: (AS_DEVICE_GROUP_CODE_LIST as readonly string[]).includes(group ?? '') ? (group as AsDeviceGroupCode) : null,
    hospitalCode: hospital?.hospitalCode ?? null, hospitalName: hospital?.hospitalName ?? null,
  }
}
function rangeOf(f: AsDashFilter): AsDashRange {
  const days = diffDays(f.to, f.from) + 1
  const prevTo = addDays(f.from, -1)
  return { from: f.from, to: f.to, days, prevFrom: addDays(prevTo, -(days - 1)), prevTo }
}

// ─── 사실 행 (접수 + 라인) ───
interface LineFact {
  id: number; receiptId: number; serialNo: string; group: AsDeviceGroup
  outcome: string | null; draftOutcome: string | null; intakeState: string
  receivedAt: string | null; shippedAt: string | null; shipMethod: string | null
  repairResult: string | null; repairedAt: string | null; repairedBy: string | null
  wardName: string | null; productType: string | null; stockOutActive: boolean
}
interface ReceiptFact {
  id: number; asCode: string; hospitalCode: string; hospitalName: string; category: string
  receiptDate: string; receivedAt: string | null; resolvedAt: string | null
  preReplace: boolean; priorityRepair: boolean; firmwareUpdate: boolean; accessoryIncluded: boolean; combinedPack: boolean
  source: string; pickupMethod: string | null
  statusId: number | null; statusName: string | null; statusOrder: number | null; statusColor: string | null; statusChangedOn: string | null
  canceled: boolean; done: boolean; open: boolean
  lines: LineFact[]
}
const OPEN_SQL = Prisma.sql`(s.id IS NULL OR s.ticket_status IS NULL OR s.ticket_status NOT IN ('RESOLVED', 'CLOSED'))`

function filterSql(f: AsDashFilter): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`TRUE`]
  if (f.hospitalCode) parts.push(Prisma.sql`r.hospital_code = ${f.hospitalCode}`)
  if (f.category) parts.push(Prisma.sql`r.category = ${f.category}`)
  return Prisma.join(parts, ' AND ')
}

/** scope(별칭 r = as_receipts, s = status_codes)에 걸리는 접수와 그 라인 전부. 기기군 필터는 여기서 적용 */
async function loadFacts(f: AsDashFilter, scope: Prisma.Sql): Promise<ReceiptFact[]> {
  const where = Prisma.sql`(${scope}) AND ${filterSql(f)}`
  const [rRows, iRows] = await Promise.all([
    prisma.$queryRaw<{
      id: number; as_code: string; hospital_code: string; hospital_name: string; category: string
      receipt_date: string; received_at: string | null; resolved_at: string | null
      pre_replace: boolean; priority_repair: boolean; firmware_update: boolean; accessory_included: boolean; combined_pack: boolean
      source: string; pickup_method: string | null
      status_id: number | null; status_name: string | null; status_order: number | null; status_color: string | null; ticket_status: string | null; status_changed_on: string | null
    }[]>(Prisma.sql`
      SELECT r.id, r.as_code, r.hospital_code, h.hospital_name, r.category,
             r.receipt_date::text AS receipt_date, r.received_at::text AS received_at, r.resolved_at::text AS resolved_at,
             r.pre_replace, r.priority_repair, r.firmware_update, r.accessory_included, r.combined_pack, r.source, r.pickup_method,
             r.status_id, s.name AS status_name, s."order" AS status_order, s.color AS status_color, s.ticket_status::text AS ticket_status,
             ((r.status_changed_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date::text AS status_changed_on
      FROM as_receipts r JOIN hospitals h ON h.hospital_code = r.hospital_code LEFT JOIN status_codes s ON s.id = r.status_id
      WHERE ${where}`),
    prisma.$queryRaw<{
      id: number; receipt_id: number; serial_no: string; device_name: string | null; device_kind: string | null
      outcome: string | null; draft_outcome: string | null; intake_state: string
      received_at: string | null; shipped_at: string | null; ship_method: string | null
      repair_result: string | null; repaired_at: string | null; repaired_by: string | null
      ward_name: string | null; product_type: string | null; stock_out_active: boolean
    }[]>(Prisma.sql`
      SELECT i.id, i.receipt_id, i.serial_no, di.device_name, i.device_kind, i.outcome, i.draft_outcome, i.intake_state,
             i.received_at::text AS received_at, i.shipped_at::text AS shipped_at, i.ship_method,
             i.repair_result, i.repaired_at::text AS repaired_at, u.name AS repaired_by, i.ward_name,
             coalesce(hd.product_type, nhd.product_type) AS product_type,
             (so.id IS NOT NULL AND (ss.id IS NULL OR ss.ticket_status IS NULL OR ss.ticket_status NOT IN ('RESOLVED', 'CLOSED'))) AS stock_out_active
      FROM as_receipt_items i JOIN as_receipts r ON r.id = i.receipt_id LEFT JOIN status_codes s ON s.id = r.status_id
      LEFT JOIN device_units du ON du.id = i.device_id LEFT JOIN device_info di ON di.id = du.device_info_id
      LEFT JOIN hospital_devices hd ON hd.device_id = i.device_id
      LEFT JOIN hospital_devices nhd ON nhd.device_id = i.new_device_id
      LEFT JOIN users u ON u.id = i.repaired_by_id
      LEFT JOIN stock_out_requests so ON so.id = i.stock_out_request_id LEFT JOIN status_codes ss ON ss.id = so.status_id
      WHERE ${where}
      ORDER BY i.id`),
  ])
  const linesBy = new Map<number, LineFact[]>()
  for (const i of iRows) {
    const group = asDeviceGroupOf(i.device_name, i.device_kind, i.serial_no)
    if (f.group && AS_DEVICE_GROUP_TO_CODE[group] !== f.group) continue
    const arr = linesBy.get(i.receipt_id) ?? []
    arr.push({
      id: i.id, receiptId: i.receipt_id, serialNo: i.serial_no, group, outcome: i.outcome, draftOutcome: i.draft_outcome, intakeState: i.intake_state,
      receivedAt: i.received_at, shippedAt: i.shipped_at, shipMethod: i.ship_method, repairResult: i.repair_result, repairedAt: i.repaired_at, repairedBy: i.repaired_by,
      wardName: i.ward_name, productType: i.product_type, stockOutActive: !!i.stock_out_active,
    })
    linesBy.set(i.receipt_id, arr)
  }
  const out: ReceiptFact[] = []
  for (const r of rRows) {
    const lines = linesBy.get(r.id) ?? []
    if (f.group && !lines.length) continue
    const closed = r.ticket_status === 'RESOLVED' || r.ticket_status === 'CLOSED'
    out.push({
      id: r.id, asCode: r.as_code, hospitalCode: r.hospital_code, hospitalName: r.hospital_name, category: r.category,
      receiptDate: r.receipt_date, receivedAt: r.received_at, resolvedAt: r.resolved_at,
      preReplace: r.pre_replace, priorityRepair: r.priority_repair, firmwareUpdate: r.firmware_update, accessoryIncluded: r.accessory_included, combinedPack: r.combined_pack,
      source: r.source, pickupMethod: r.pickup_method,
      statusId: r.status_id, statusName: r.status_name, statusOrder: r.status_order, statusColor: r.status_color, statusChangedOn: r.status_changed_on,
      canceled: r.status_name === '취소', done: r.status_name === '완료', open: !closed,
      lines,
    })
  }
  return out
}

/** 물량으로 세는 라인(라인취소 제외) */
const liveLines = (r: ReceiptFact) => r.lines.filter((l) => l.outcome !== 'CANCELED')

// ─── 통계 ───
export interface Dist { n: number; median: number | null; p90: number | null; avg: number | null }
function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos); const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo) // percentile_cont와 같은 선형 보간
}
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10)
function dist(values: number[]): Dist {
  const s = [...values].sort((a, b) => a - b)
  return { n: s.length, median: round1(quantile(s, 0.5)), p90: round1(quantile(s, 0.9)), avg: s.length ? round1(s.reduce((a, b) => a + b, 0) / s.length) : null }
}
const pct1 = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null)
export interface Pair { cur: number; prev: number }
export interface CountItem { key: string; label: string; count: number }
const groupCounts = (lines: LineFact[]) => AS_DEVICE_GROUPS.map((g) => ({ group: g, count: lines.filter((l) => l.group === g).length }))

// ══════════════════════════════════════════════════════════════════════
// ① 현황 (조회 시점 스냅샷 — 기간 필터 미적용)
// ══════════════════════════════════════════════════════════════════════
export const AS_DASH_AGING = [{ label: '3일 이내', max: 3 }, { label: '4~7일', max: 7 }, { label: '8~14일', max: 14 }, { label: '15일 이상', max: Infinity }] as const
export const AS_DASH_OVERDUE_DAYS = 14 // 목록 요약 스트립 '2주 경과 미처리'와 동일 기준

export interface AsDashStage { statusId: number | null; name: string; color: string | null; receipts: number; devices: number; aging: number[]; stayMedian: number | null; oldestDays: number | null }
export interface AsDashWork { key: 'INCOMING' | 'WAITING' | 'SHIP' | 'LOST'; label: string; desc: string; total: number; byGroup: { group: AsDeviceGroup; count: number }[]; parts: { label: string; count: number }[]; href: string | null }
export interface AsDashOpenReceipt { id: number; asCode: string; hospitalCode: string; hospitalName: string; category: string; statusName: string | null; statusColor: string | null; receiptDate: string; days: number; devices: number; openLines: number; tags: string[] }
export interface AsDashOpenHospital { hospitalCode: string; name: string; receipts: number; devices: number; oldestDays: number; overdue: number }
export interface AsDashNow {
  today: string
  kpi: { openReceipts: number; openDevices: number; openLines: number; todayReceipts: number; weekReceipts: number; weekStart: string; overdue: number; needsCheck: number; intakePending: number }
  agingLabels: string[]
  stages: AsDashStage[]
  work: AsDashWork[]
  oldest: AsDashOpenReceipt[]
  hospitals: AsDashOpenHospital[]
}

export async function buildAsDashNow(f: AsDashFilter): Promise<AsDashNow> {
  const today = todayKst()
  const weekStart = mondayOf(today)
  const receiptWhere: Prisma.AsReceiptWhereInput = { ...(f.hospitalCode ? { hospitalCode: f.hospitalCode } : {}), ...(f.category ? { category: f.category } : {}) }
  const queueGroups: AsDeviceGroupCode[] = f.group ? [f.group] : [...AS_DEVICE_GROUP_CODE_LIST]
  const queueCount = (bucket: 'WAITING' | 'INCOMING', g: AsDeviceGroupCode) =>
    prisma.asReceiptItem.count({ where: { AND: [asQueueBucketWhere(bucket), asDeviceGroupWhere(g), { receipt: receiptWhere }] } })

  const needsIds = await findAsNeedsCheckReceiptIds()
  const [facts, statuses, intakePending, waiting, incoming] = await Promise.all([
    loadFacts(f, Prisma.sql`${OPEN_SQL} OR r.receipt_date >= ${weekStart}::date OR r.id = ANY(${needsIds}::int[])`),
    prisma.statusCode.findMany({ where: { category: 'AS_STATUS' }, orderBy: { order: 'asc' }, select: { id: true, name: true, color: true, ticketStatus: true } }),
    prisma.asIntakeLink.count({ where: { state: 'PENDING' } }),
    Promise.all(queueGroups.map((g) => queueCount('WAITING', g))),
    Promise.all(queueGroups.map((g) => queueCount('INCOMING', g))),
  ])
  const open = facts.filter((r) => r.open)
  const needsSet = new Set(needsIds)
  const overdueCut = addDays(today, -AS_DASH_OVERDUE_DAYS)

  // 단계별 — AS_STATUS 마스터의 미종결 상태를 순서대로(0건도 표시), 상태 없는 접수가 있으면 맨 뒤에
  const stageOf = (name: string, statusId: number | null, color: string | null, rows: ReceiptFact[]): AsDashStage => {
    const aging = AS_DASH_AGING.map(() => 0)
    for (const r of rows) {
      const d = diffDays(today, r.receiptDate)
      aging[AS_DASH_AGING.findIndex((b) => d <= b.max)]++
    }
    const stays = rows.filter((r) => r.statusChangedOn).map((r) => Math.max(0, diffDays(today, r.statusChangedOn as string)))
    return {
      statusId, name, color, receipts: rows.length, devices: rows.reduce((a, r) => a + liveLines(r).length, 0), aging,
      stayMedian: dist(stays).median, oldestDays: rows.length ? Math.max(...rows.map((r) => diffDays(today, r.receiptDate))) : null,
    }
  }
  const stages = statuses
    .filter((s) => s.ticketStatus !== 'RESOLVED' && s.ticketStatus !== 'CLOSED')
    .map((s) => stageOf(s.name, s.id, s.color, open.filter((r) => r.statusId === s.id)))
  const noStatus = open.filter((r) => r.statusId === null)
  if (noStatus.length) stages.push(stageOf('상태 없음', null, null, noStatus))

  // 기기 단위 작업 대기
  const byQueue = (counts: number[]) => queueGroups.map((g, i) => ({ group: AS_DEVICE_GROUP_CODE_LABELS[g], count: counts[i] }))
  const shipRepaired: LineFact[] = []; const shipPre: LineFact[] = []; const lostReq: LineFact[] = []; const lostTodo: LineFact[] = []
  for (const r of open) {
    for (const l of r.lines) {
      if (l.outcome !== null) continue
      if (r.category === 'LOST') { (l.stockOutActive ? lostReq : lostTodo).push(l); continue }
      if (l.shippedAt) continue
      if (l.repairedAt && l.repairResult !== 'SCRAPPED') shipRepaired.push(l)
      else if (r.preReplace) shipPre.push(l)
    }
  }
  const queueQs = (bucket: string) => `/as-receipts/queue?bucket=${bucket}${f.group ? `&group=${f.group}` : ''}`
  const work: AsDashWork[] = [
    { key: 'INCOMING', label: AS_QUEUE_BUCKET_LABELS.INCOMING, desc: AS_QUEUE_BUCKET_DESC.INCOMING, total: incoming.reduce((a, b) => a + b, 0), byGroup: byQueue(incoming), parts: [], href: queueQs('INCOMING') },
    { key: 'WAITING', label: AS_QUEUE_BUCKET_LABELS.WAITING, desc: AS_QUEUE_BUCKET_DESC.WAITING, total: waiting.reduce((a, b) => a + b, 0), byGroup: byQueue(waiting), parts: [], href: queueQs('WAITING') },
    {
      key: 'SHIP', label: '발송 대기', desc: '미종결 고장 접수의 결과 미확정·미발송 기기 중 보낼 차례인 것 — 회수기기 처리(수리·문제없음)가 끝났거나, 선교체 접수라 교체기를 먼저 보내야 하는 기기',
      total: shipRepaired.length + shipPre.length, byGroup: groupCounts([...shipRepaired, ...shipPre]),
      parts: [{ label: '수리 끝남', count: shipRepaired.length }, { label: '선교체', count: shipPre.length }], href: null,
    },
    {
      key: 'LOST', label: '분실 처리 대기', desc: '미종결 분실 접수의 결과 미확정 기기 — 출고요청이 진행 중이거나, 아직 출고요청·분실종결을 하지 않은 기기',
      total: lostReq.length + lostTodo.length, byGroup: groupCounts([...lostReq, ...lostTodo]),
      parts: [{ label: '출고요청 진행', count: lostReq.length }, { label: '미처리', count: lostTodo.length }], href: null,
    },
  ]

  const tagsOf = (r: ReceiptFact) => AS_TAGS.filter((t) => r[AS_TAG_FIELDS[t]]).map((t) => AS_TAG_LABELS[t])
  const oldest = [...open].sort((a, b) => a.receiptDate.localeCompare(b.receiptDate) || a.id - b.id).slice(0, 10).map((r) => ({
    id: r.id, asCode: r.asCode, hospitalCode: r.hospitalCode, hospitalName: r.hospitalName, category: r.category, statusName: r.statusName, statusColor: r.statusColor,
    receiptDate: r.receiptDate, days: diffDays(today, r.receiptDate), devices: liveLines(r).length, openLines: r.lines.filter((l) => l.outcome === null).length, tags: tagsOf(r),
  }))
  const hospMap = new Map<string, AsDashOpenHospital>()
  for (const r of open) {
    const h = hospMap.get(r.hospitalCode) ?? { hospitalCode: r.hospitalCode, name: r.hospitalName, receipts: 0, devices: 0, oldestDays: 0, overdue: 0 }
    h.receipts++; h.devices += liveLines(r).length
    h.oldestDays = Math.max(h.oldestDays, diffDays(today, r.receiptDate))
    if (r.receiptDate < overdueCut) h.overdue++
    hospMap.set(r.hospitalCode, h)
  }

  return {
    today,
    kpi: {
      openReceipts: open.length, openDevices: open.reduce((a, r) => a + liveLines(r).length, 0), openLines: open.reduce((a, r) => a + r.lines.filter((l) => l.outcome === null).length, 0),
      todayReceipts: facts.filter((r) => r.receiptDate === today).length, weekReceipts: facts.filter((r) => r.receiptDate >= weekStart).length, weekStart,
      overdue: open.filter((r) => r.receiptDate < overdueCut).length,
      needsCheck: facts.filter((r) => needsSet.has(r.id)).length, intakePending,
    },
    agingLabels: AS_DASH_AGING.map((b) => b.label),
    stages, work, oldest,
    hospitals: Array.from(hospMap.values()).sort((a, b) => b.receipts - a.receipts || b.devices - a.devices || b.oldestDays - a.oldestDays).slice(0, 10),
  }
}

// ══════════════════════════════════════════════════════════════════════
// ② 기간 분석
// ══════════════════════════════════════════════════════════════════════
export type AsDashGranularity = 'day' | 'week' | 'month'
export const AS_DASH_GRANULARITIES: readonly AsDashGranularity[] = ['day', 'week', 'month']
export interface AsDashTrendRow { key: string; label: string; faultReceipts: number; lostReceipts: number; faultDevices: number; lostDevices: number; resolved: number; shipped: number }
export interface AsDashLeadSegment { key: 'FAULT_NORMAL' | 'FAULT_PRE' | 'LOST'; label: string; toIntake: Dist; intakeToShip: Dist; total: Dist }
export interface AsDashPeriod {
  range: AsDashRange
  kpi: {
    receipts: Pair; devices: Pair; canceled: number
    resolved: Pair; closed: number; netFlow: number
    shipped: Pair
    lead: { label: string; cur: Dist; prevMedian: number | null }
    replace: { pct: number | null; replace: number; repair: number }
    preReplace: { pct: number | null; count: number; base: number }
  }
  granularity: AsDashGranularity
  trend: AsDashTrendRow[]
  outcomes: { key: string; label: string; fault: number; lost: number; total: number }[]
  lead: { segments: AsDashLeadSegment[]; resolve: Dist; histogram: { label: string; count: number }[] }
  mix: { source: CountItem[]; pickup: CountItem[]; ship: CountItem[]; tags: CountItem[]; base: { receipts: number; shippedLines: number } }
}

const SOURCE_LABELS: Record<string, string> = { CHANNELTALK: '채널톡 자동', INTAKE_QUEUE: '등록대기 확정', SHEET: '시트 인입', MANUAL: '화면 등록', IMPORT: '이력 이관' }
const OUTCOME_ORDER = ['IN_PROGRESS', 'REPAIR_RETURN', 'REPLACE', 'LOST', 'NOT_RECEIVED', 'FOUND', 'CANCELED'] as const
const outcomeLabel = (k: string) => (k === 'IN_PROGRESS' ? '진행 중' : AS_OUTCOME_LABELS[k as AsOutcome] ?? k)
const LEAD_HIST = [{ label: '3일 이내', max: 3 }, { label: '4~7일', max: 7 }, { label: '8~14일', max: 14 }, { label: '15~21일', max: 21 }, { label: '22일 이상', max: Infinity }]
/** 발송으로 끝난 결과 — 수리출하 소요 집계 대상(VOC·AS 주간 대시보드와 동일) */
const SHIPPED_OUTCOMES = ['REPAIR_RETURN', 'REPLACE']

function pickGranularity(days: number, asked: AsDashGranularity | null): AsDashGranularity {
  const auto: AsDashGranularity = days <= 45 ? 'day' : days <= 210 ? 'week' : 'month'
  if (!asked) return auto
  if (asked === 'day' && days > 92) return 'week' // 막대가 너무 많아지면 한 단계 올린다
  if (asked === 'week' && days > 560) return 'month'
  return asked
}
function bucketKey(ymd: string, g: AsDashGranularity) { return g === 'day' ? ymd : g === 'week' ? mondayOf(ymd) : ymd.slice(0, 7) }
function bucketKeys(from: string, to: string, g: AsDashGranularity): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = []
  if (g === 'month') {
    let [y, m] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))]
    const end = to.slice(0, 7)
    for (;;) {
      const key = `${y}-${String(m).padStart(2, '0')}`
      out.push({ key, label: `${String(y).slice(2)}.${String(m).padStart(2, '0')}` })
      if (key >= end) break
      m++; if (m > 12) { m = 1; y++ }
    }
    return out
  }
  const step = g === 'day' ? 1 : 7
  for (let d = g === 'day' ? from : mondayOf(from); d <= to; d = addDays(d, step)) out.push({ key: d, label: md(d) })
  return out
}

export async function buildAsDashPeriod(f: AsDashFilter, askedGranularity: AsDashGranularity | null = null): Promise<AsDashPeriod> {
  const range = rangeOf(f)
  const { from, to, prevFrom, prevTo } = range
  const facts = await loadFacts(f, Prisma.sql`
    (r.receipt_date BETWEEN ${prevFrom}::date AND ${to}::date) OR (r.resolved_at BETWEEN ${prevFrom}::date AND ${to}::date)
    OR EXISTS (SELECT 1 FROM as_receipt_items x WHERE x.receipt_id = r.id AND x.shipped_at BETWEEN ${prevFrom}::date AND ${to}::date)`)
  const live = facts.filter((r) => !r.canceled)
  const cohort = live.filter((r) => within(r.receiptDate, from, to))
  const cohortPrev = live.filter((r) => within(r.receiptDate, prevFrom, prevTo))
  const devicesOf = (rows: ReceiptFact[]) => rows.reduce((a, r) => a + liveLines(r).length, 0)
  const shippedLines = (a: string, b: string) => live.flatMap((r) => liveLines(r).filter((l) => within(l.shippedAt, a, b)).map((l) => ({ r, l })))
  const shippedCur = shippedLines(from, to)
  const shippedPrev = shippedLines(prevFrom, prevTo)

  // 소요일 (달력일) — 기간 안에 발송된 수리반환·교체 라인 기준
  const leadOf = (rows: { r: ReceiptFact; l: LineFact }[]) => {
    const seg = (key: AsDashLeadSegment['key'], label: string, pred: (r: ReceiptFact) => boolean): AsDashLeadSegment => {
      const xs = rows.filter(({ r, l }) => pred(r) && SHIPPED_OUTCOMES.includes(l.outcome ?? ''))
      const total: number[] = []; const toIntake: number[] = []; const intakeToShip: number[] = []
      for (const { r, l } of xs) {
        const t = diffDays(l.shippedAt as string, r.receiptDate)
        if (t >= 0) total.push(t)
        const recv = l.receivedAt ?? r.receivedAt
        if (recv && key === 'FAULT_NORMAL') { // 선교체는 발송이 입고보다 앞서고 분실은 입고가 없다 — 단계 분해는 일반 고장만
          const a = diffDays(recv, r.receiptDate); const b = diffDays(l.shippedAt as string, recv)
          if (a >= 0 && b >= 0) { toIntake.push(a); intakeToShip.push(b) }
        }
      }
      return { key, label, toIntake: dist(toIntake), intakeToShip: dist(intakeToShip), total: dist(total) }
    }
    return [
      seg('FAULT_NORMAL', '고장 · 일반', (r) => r.category === 'FAULT' && !r.preReplace),
      seg('FAULT_PRE', '고장 · 선교체', (r) => r.category === 'FAULT' && r.preReplace),
      seg('LOST', '분실', (r) => r.category === 'LOST'),
    ]
  }
  const headlineLead = (rows: { r: ReceiptFact; l: LineFact }[]) => {
    const cat = f.category === 'LOST' ? 'LOST' : 'FAULT'
    return dist(rows.filter(({ r, l }) => r.category === cat && SHIPPED_OUTCOMES.includes(l.outcome ?? '')).map(({ r, l }) => diffDays(l.shippedAt as string, r.receiptDate)).filter((d) => d >= 0))
  }
  const segments = leadOf(shippedCur)
  const normalTotals = shippedCur.filter(({ r, l }) => r.category === 'FAULT' && !r.preReplace && SHIPPED_OUTCOMES.includes(l.outcome ?? '')).map(({ r, l }) => diffDays(l.shippedAt as string, r.receiptDate)).filter((d) => d >= 0)
  const histogram = LEAD_HIST.map((b, i) => ({ label: b.label, count: normalTotals.filter((d) => d <= b.max && (i === 0 || d > LEAD_HIST[i - 1].max)).length }))
  const resolvedCur = live.filter((r) => r.done && within(r.resolvedAt, from, to))
  const resolvedPrev = live.filter((r) => r.done && within(r.resolvedAt, prevFrom, prevTo))
  const closedCur = facts.filter((r) => !r.open && within(r.resolvedAt, from, to)).length // 완료 + 취소 — 재공 증감용

  // 추이
  const granularity = pickGranularity(range.days, askedGranularity)
  const trendMap = new Map<string, AsDashTrendRow>(bucketKeys(from, to, granularity).map((b) => [b.key, { ...b, faultReceipts: 0, lostReceipts: 0, faultDevices: 0, lostDevices: 0, resolved: 0, shipped: 0 }]))
  const at = (ymd: string) => trendMap.get(bucketKey(ymd, granularity))
  for (const r of cohort) {
    const row = at(r.receiptDate); if (!row) continue
    const n = liveLines(r).length
    if (r.category === 'LOST') { row.lostReceipts++; row.lostDevices += n } else { row.faultReceipts++; row.faultDevices += n }
  }
  for (const r of resolvedCur) { const row = at(r.resolvedAt as string); if (row) row.resolved++ }
  for (const { l } of shippedCur) { const row = at(l.shippedAt as string); if (row) row.shipped++ }

  // 처리 결과 — 기간 내 접수된 라인이 지금 어떤 결과인가
  const outcomeAcc = new Map<string, { fault: number; lost: number }>()
  for (const r of cohort) for (const l of r.lines) {
    const k = l.outcome ?? 'IN_PROGRESS'
    const cur = outcomeAcc.get(k) ?? { fault: 0, lost: 0 }
    if (r.category === 'LOST') cur.lost++; else cur.fault++
    outcomeAcc.set(k, cur)
  }
  const outcomes = OUTCOME_ORDER.map((k) => { const v = outcomeAcc.get(k) ?? { fault: 0, lost: 0 }; return { key: k, label: outcomeLabel(k), fault: v.fault, lost: v.lost, total: v.fault + v.lost } })

  const faultCohort = cohort.filter((r) => r.category === 'FAULT')
  const faultLines = faultCohort.flatMap((r) => r.lines)
  const replace = faultLines.filter((l) => l.outcome === 'REPLACE').length
  const repair = faultLines.filter((l) => l.outcome === 'REPAIR_RETURN').length
  const preCount = faultCohort.filter((r) => r.preReplace).length

  // 구성
  const countBy = <T,>(rows: T[], keyOf: (x: T) => string | null, labels: Record<string, string>, order: string[]): CountItem[] => {
    const m = new Map<string, number>()
    for (const x of rows) { const k = keyOf(x) ?? '(미지정)'; m.set(k, (m.get(k) ?? 0) + 1) }
    const keys = [...order.filter((k) => m.has(k)), ...Array.from(m.keys()).filter((k) => !order.includes(k)).sort()]
    return keys.map((k) => ({ key: k, label: labels[k] ?? k, count: m.get(k) ?? 0 }))
  }
  const cohortShipped = cohort.flatMap((r) => liveLines(r).filter((l) => l.shippedAt))

  return {
    range,
    kpi: {
      receipts: { cur: cohort.length, prev: cohortPrev.length }, devices: { cur: devicesOf(cohort), prev: devicesOf(cohortPrev) },
      canceled: facts.filter((r) => r.canceled && within(r.receiptDate, from, to)).length,
      resolved: { cur: resolvedCur.length, prev: resolvedPrev.length }, closed: closedCur,
      netFlow: facts.filter((r) => within(r.receiptDate, from, to)).length - closedCur,
      shipped: { cur: shippedCur.length, prev: shippedPrev.length },
      lead: { label: f.category === 'LOST' ? '분실' : '고장', cur: headlineLead(shippedCur), prevMedian: headlineLead(shippedPrev).median },
      replace: { pct: pct1(replace, replace + repair), replace, repair },
      preReplace: { pct: pct1(preCount, faultCohort.length), count: preCount, base: faultCohort.length },
    },
    granularity, trend: Array.from(trendMap.values()),
    outcomes,
    lead: {
      segments,
      resolve: dist(resolvedCur.map((r) => diffDays(r.resolvedAt as string, r.receiptDate)).filter((d) => d >= 0)),
      histogram,
    },
    mix: {
      source: countBy(cohort, (r) => r.source, SOURCE_LABELS, Object.keys(SOURCE_LABELS)),
      pickup: countBy(cohort, (r) => r.pickupMethod, AS_PICKUP_METHOD_LABELS, Object.keys(AS_PICKUP_METHOD_LABELS)),
      ship: countBy(cohortShipped, (l) => l.shipMethod, AS_SHIP_METHOD_LABELS, Object.keys(AS_SHIP_METHOD_LABELS)),
      tags: AS_TAGS.map((t) => ({ key: t, label: AS_TAG_LABELS[t], count: cohort.filter((r) => r[AS_TAG_FIELDS[t]]).length })),
      base: { receipts: cohort.length, shippedLines: cohortShipped.length },
    },
  }
}

// ══════════════════════════════════════════════════════════════════════
// ③ 병원별
// ══════════════════════════════════════════════════════════════════════
export const AS_DASH_RATIO_MIN_DEPLOYED = 50 // 접수율 순위에서 소규모 병원 왜곡 방지 (VOC·AS 주간 대시보드와 같은 하한)
export interface AsDashHospitalRow {
  hospitalCode: string; name: string
  receipts: number; devices: number; faultDevices: number; lostDevices: number; ecg: number; spo2: number; etc: number
  replaced: number; leadMedian: number | null; leadN: number
  openNow: number; deployed: number; ratio: number | null
  lost: AsLostQuotaHospital | null; lite: AsLiteQuotaHospital | null
}
export interface AsDashHospitalDetail {
  hospitalCode: string; name: string
  wards: { ward: string; devices: number; fault: number; lost: number; ecg: number; spo2: number }[]
  receipts: { id: number; asCode: string; receiptDate: string; category: string; statusName: string | null; statusColor: string | null; devices: number; summary: string; lastShippedAt: string | null }[]
  receiptsTotal: number
  lostQuota: AsLostQuota; dealQuota: AsDealQuota
}
export interface AsDashHospitals {
  range: AsDashRange
  rows: AsDashHospitalRow[]
  totals: { hospitals: number; receipts: number; devices: number; faultDevices: number; lostDevices: number; replaced: number; openNow: number; lostOver: number; liteOver: number }
  ratioMinDeployed: number
  detail: AsDashHospitalDetail | null
}

async function loadDeployed(hospitalCode: string | null) {
  return prisma.$queryRaw<{ hospital_code: string; device_name: string | null; product_type: string | null; n: number }[]>(Prisma.sql`
    SELECT hd.hospital_code, di.device_name, hd.product_type, count(*)::int AS n
    FROM hospital_devices hd JOIN device_units du ON du.id = hd.device_id JOIN device_info di ON di.id = du.device_info_id
    WHERE hd.status = 'ACTIVE' AND hd.hospital_code IS NOT NULL ${hospitalCode ? Prisma.sql`AND hd.hospital_code = ${hospitalCode}` : Prisma.empty}
    GROUP BY hd.hospital_code, di.device_name, hd.product_type`)
}

export async function buildAsDashHospitals(f: AsDashFilter): Promise<AsDashHospitals> {
  const range = rangeOf(f)
  const { from, to } = range
  const [facts, deployedRows, lostAll, liteAll] = await Promise.all([
    loadFacts(f, Prisma.sql`
      (r.receipt_date BETWEEN ${from}::date AND ${to}::date) OR ${OPEN_SQL}
      OR EXISTS (SELECT 1 FROM as_receipt_items x WHERE x.receipt_id = r.id AND x.shipped_at BETWEEN ${from}::date AND ${to}::date)`),
    loadDeployed(f.hospitalCode),
    computeAsLostQuotaAll(),
    computeAsLiteQuotaAll(),
  ])
  const deployed = new Map<string, number>()
  for (const d of deployedRows) {
    const g = asDeviceGroupOf(d.device_name, null)
    if (f.group && AS_DEVICE_GROUP_TO_CODE[g] !== f.group) continue
    deployed.set(d.hospital_code, (deployed.get(d.hospital_code) ?? 0) + Number(d.n))
  }

  const rows = new Map<string, AsDashHospitalRow & { leads: number[] }>()
  const rowOf = (code: string, name: string) => {
    let row = rows.get(code)
    if (!row) {
      row = { hospitalCode: code, name, receipts: 0, devices: 0, faultDevices: 0, lostDevices: 0, ecg: 0, spo2: 0, etc: 0, replaced: 0, leadMedian: null, leadN: 0, openNow: 0, deployed: 0, ratio: null, lost: null, lite: null, leads: [] }
      rows.set(code, row)
    }
    return row
  }
  for (const r of facts) {
    if (r.open) rowOf(r.hospitalCode, r.hospitalName).openNow++
    if (r.canceled) continue
    if (within(r.receiptDate, from, to)) {
      const row = rowOf(r.hospitalCode, r.hospitalName)
      row.receipts++
      for (const l of liveLines(r)) {
        row.devices++
        if (r.category === 'LOST') row.lostDevices++; else { row.faultDevices++; if (l.outcome === 'REPLACE') row.replaced++ }
        if (l.group === '심전계') row.ecg++; else if (l.group === '산소포화도') row.spo2++; else row.etc++
      }
    }
    for (const l of liveLines(r)) {
      if (within(l.shippedAt, from, to) && SHIPPED_OUTCOMES.includes(l.outcome ?? '')) {
        const d = diffDays(l.shippedAt as string, r.receiptDate)
        if (d >= 0) rowOf(r.hospitalCode, r.hospitalName).leads.push(d)
      }
    }
  }
  // 한도 초과 병원은 기간 내 접수가 없어도 표에 올린다(한도 현황이 빠지지 않게) — 병원명 조회
  const overCodes = new Set<string>()
  lostAll.forEach((v, code) => { if (v.over) overCodes.add(code) })
  liteAll.forEach((v, code) => { if (v.over) overCodes.add(code) })
  const missing = Array.from(overCodes).filter((c) => !rows.has(c) && (!f.hospitalCode || f.hospitalCode === c))
  if (missing.length) {
    const hs = await prisma.hospital.findMany({ where: { hospitalCode: { in: missing } }, select: { hospitalCode: true, hospitalName: true } })
    for (const h of hs) rowOf(h.hospitalCode, h.hospitalName)
  }
  const list: AsDashHospitalRow[] = Array.from(rows.values()).map(({ leads, ...row }) => {
    const d = dist(leads)
    const dep = deployed.get(row.hospitalCode) ?? 0
    return { ...row, leadMedian: d.median, leadN: d.n, deployed: dep, ratio: pct1(row.devices, dep), lost: lostAll.get(row.hospitalCode) ?? null, lite: liteAll.get(row.hospitalCode) ?? null }
  }).sort((a, b) => b.devices - a.devices || b.receipts - a.receipts || a.name.localeCompare(b.name, 'ko'))

  let detail: AsDashHospitalDetail | null = null
  if (f.hospitalCode) {
    const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: f.hospitalCode }, select: { hospitalCode: true, hospitalName: true } })
    if (hospital) {
      const cohort = facts.filter((r) => !r.canceled && within(r.receiptDate, from, to))
      const wardMap = new Map<string, AsDashHospitalDetail['wards'][number]>()
      for (const r of cohort) for (const l of liveLines(r)) {
        const key = l.wardName?.trim() || '(병동 미기재)'
        const w = wardMap.get(key) ?? { ward: key, devices: 0, fault: 0, lost: 0, ecg: 0, spo2: 0 }
        w.devices++
        if (r.category === 'LOST') w.lost++; else w.fault++
        if (l.group === '심전계') w.ecg++; else if (l.group === '산소포화도') w.spo2++
        wardMap.set(key, w)
      }
      const summaryOf = (r: ReceiptFact) => {
        const m = new Map<string, number>()
        for (const l of r.lines) { const k = l.outcome ?? 'IN_PROGRESS'; m.set(k, (m.get(k) ?? 0) + 1) }
        return OUTCOME_ORDER.filter((k) => m.has(k)).map((k) => `${outcomeLabel(k)} ${m.get(k)}`).join(' · ')
      }
      const [lostQuota, dealQuota] = await Promise.all([
        computeAsLostQuota({ id: 0, hospitalCode: hospital.hospitalCode }),
        computeAsDealQuota({ id: 0, hospitalCode: hospital.hospitalCode, category: 'LOST' }), // category LOST = '이 접수분' 없이 누계만
      ])
      const sorted = [...cohort].sort((a, b) => b.receiptDate.localeCompare(a.receiptDate) || b.id - a.id)
      detail = {
        hospitalCode: hospital.hospitalCode, name: hospital.hospitalName,
        wards: Array.from(wardMap.values()).sort((a, b) => b.devices - a.devices || a.ward.localeCompare(b.ward, 'ko')),
        receipts: sorted.slice(0, 100).map((r) => ({
          id: r.id, asCode: r.asCode, receiptDate: r.receiptDate, category: r.category, statusName: r.statusName, statusColor: r.statusColor,
          devices: liveLines(r).length, summary: summaryOf(r),
          lastShippedAt: r.lines.map((l) => l.shippedAt).filter((d): d is string => !!d).sort().pop() ?? null,
        })),
        receiptsTotal: sorted.length, lostQuota, dealQuota,
      }
    }
  }

  return {
    range, rows: list,
    totals: {
      hospitals: list.filter((r) => r.receipts > 0).length,
      receipts: list.reduce((a, r) => a + r.receipts, 0), devices: list.reduce((a, r) => a + r.devices, 0),
      faultDevices: list.reduce((a, r) => a + r.faultDevices, 0), lostDevices: list.reduce((a, r) => a + r.lostDevices, 0),
      replaced: list.reduce((a, r) => a + r.replaced, 0), openNow: list.reduce((a, r) => a + r.openNow, 0),
      lostOver: list.filter((r) => r.lost?.over).length, liteOver: list.filter((r) => r.lite?.over).length,
    },
    ratioMinDeployed: AS_DASH_RATIO_MIN_DEPLOYED,
    detail,
  }
}

// ══════════════════════════════════════════════════════════════════════
// ④ 기기·품질
// ══════════════════════════════════════════════════════════════════════
export const AS_DASH_REPEAT_WINDOW_DAYS = 30
const AS_DASH_REPEAT_GAPS = [{ label: '30일 이내', max: 30 }, { label: '31~90일', max: 90 }, { label: '91~180일', max: 180 }, { label: '181일 이상', max: Infinity }]
/** 접수사유(자유 입력) 키워드 분류 — 참고용. 한 접수가 여러 분류에 걸릴 수 있다 */
export const AS_DASH_SYMPTOM_GROUPS: { key: string; label: string; re: RegExp }[] = [
  { key: 'ALERT', label: '느낌표·경고 표시', re: /느낌표|!|경고/ },
  { key: 'MEASURE', label: '측정 불가·오류', re: /측정|리듬|수치|파형|데이터|신호/ },
  { key: 'POWER', label: '전원·배터리', re: /전원|안\s*켜|켜지지|충전|배터리|방전|부팅/ },
  { key: 'SENSOR', label: '센서·점등', re: /센서|점등|불\s*(이\s*)?안|빨간\s*불|led|light|라이트/i },
  { key: 'CONNECT', label: '접촉·연결·인식', re: /접촉|접지|단선|연결|연동|인식|수신|페어링|블루투스/ },
  { key: 'DAMAGE', label: '파손·부속', re: /파손|깨[짐졌진]|부러|뚜껑|덮개|벨트|케이블|스트랩|헐거/ },
  { key: 'LOST', label: '분실', re: /분실|망실/ },
]
export interface AsDashQuality {
  range: AsDashRange
  byGroup: { group: AsDeviceGroup; faultDevices: number; lostDevices: number; replace: number; repairReturn: number; replaceRate: number | null; deployed: number; per100: number | null }[]
  byProductType: { productType: string; faultDevices: number; replace: number; deployed: number; per100: number | null }[]
  repair: { total: number; byResult: CountItem[]; noFaultRate: number | null; byUser: { name: string; count: number }[] }
  /** 분실만 볼 때는 null (반복 접수는 고장 접수 기준) */
  repeat: null | {
    windowDays: number; base: number; repeat: number; rate: number | null; within: number; withinRate: number | null
    /** 재접수까지 걸린 기간 — 직전 고장 접수일 → 이번 접수일 (재접수 라인만) */
    gaps: { label: string; count: number }[]
    top: { serialNo: string; group: AsDeviceGroup; hospitalCode: string; hospitalName: string; lifeCount: number; periodCount: number; lastReceiptDate: string }[]
  }
  symptoms: { receipts: number; items: (CountItem & { pct: number | null })[]; unmatched: number }
}

export async function buildAsDashQuality(f: AsDashFilter): Promise<AsDashQuality> {
  const range = rangeOf(f)
  const { from, to } = range
  const hospitalCond = f.hospitalCode ? Prisma.sql`AND c.hospital_code = ${f.hospitalCode}` : Prisma.empty
  const [facts, deployedRows, repeatRows, symptomRows] = await Promise.all([
    loadFacts(f, Prisma.sql`
      (r.receipt_date BETWEEN ${from}::date AND ${to}::date)
      OR EXISTS (SELECT 1 FROM as_receipt_items x WHERE x.receipt_id = r.id AND x.repaired_at BETWEEN ${from}::date AND ${to}::date)`),
    loadDeployed(f.hospitalCode),
    f.category === 'LOST' ? Promise.resolve([]) : prisma.$queryRaw<{
      serial_no: string; device_name: string | null; device_kind: string | null; receipt_date: string; hospital_code: string; hospital_name: string
      prior_cnt: number; life_cnt: number; last_repair_ship: string | null; prev_date: string | null
    }[]>(Prisma.sql`
      WITH f AS (
        SELECT i.serial_no, i.outcome, i.shipped_at, i.device_kind, r.id AS rid, r.receipt_date, r.hospital_code, di.device_name
        FROM as_receipt_items i JOIN as_receipts r ON r.id = i.receipt_id LEFT JOIN status_codes s ON s.id = r.status_id
        LEFT JOIN device_units du ON du.id = i.device_id LEFT JOIN device_info di ON di.id = du.device_info_id
        WHERE r.category = 'FAULT' AND coalesce(s.name, '') <> '취소' AND coalesce(i.outcome, '') <> 'CANCELED' AND i.serial_no ~ ${AS_SERIAL_RE.source}
      ), ranked AS (
        SELECT f.*, (row_number() OVER w - 1)::int AS prior_cnt, (count(*) OVER (PARTITION BY serial_no))::int AS life_cnt,
               max(CASE WHEN outcome = 'REPAIR_RETURN' THEN shipped_at END) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS last_repair_ship,
               lag(receipt_date) OVER w AS prev_date
        FROM f WINDOW w AS (PARTITION BY serial_no ORDER BY receipt_date, rid)
      )
      SELECT c.serial_no, c.device_name, c.device_kind, c.receipt_date::text AS receipt_date, c.hospital_code, h.hospital_name,
             c.prior_cnt, c.life_cnt, c.last_repair_ship::text AS last_repair_ship, c.prev_date::text AS prev_date
      FROM ranked c JOIN hospitals h ON h.hospital_code = c.hospital_code
      WHERE c.receipt_date BETWEEN ${from}::date AND ${to}::date ${hospitalCond}`),
    prisma.$queryRaw<{ receipt_id: number; symptom: string | null }[]>(Prisma.sql`
      SELECT DISTINCT i.receipt_id, i.symptom
      FROM as_receipt_items i JOIN as_receipts r ON r.id = i.receipt_id LEFT JOIN status_codes s ON s.id = r.status_id
      WHERE r.receipt_date BETWEEN ${from}::date AND ${to}::date AND coalesce(s.name, '') <> '취소' AND i.symptom IS NOT NULL AND ${filterSql(f)}`),
  ])
  const cohort = facts.filter((r) => !r.canceled && within(r.receiptDate, from, to))

  // 기기군별 · 상품유형별 — 기간 접수 대수와 현재 배치(ACTIVE) 100대당 접수
  const depGroup = new Map<AsDeviceGroup, number>(); const depType = new Map<string, number>()
  for (const d of deployedRows) {
    const g = asDeviceGroupOf(d.device_name, null)
    if (f.group && AS_DEVICE_GROUP_TO_CODE[g] !== f.group) continue
    depGroup.set(g, (depGroup.get(g) ?? 0) + Number(d.n))
    const t = d.product_type === '일반' || d.product_type === '라이트' ? d.product_type : '미지정'
    depType.set(t, (depType.get(t) ?? 0) + Number(d.n))
  }
  const byGroup = AS_DEVICE_GROUPS.filter((g) => !f.group || AS_DEVICE_GROUP_TO_CODE[g] === f.group).map((g) => {
    let faultDevices = 0; let lostDevices = 0; let replace = 0; let repairReturn = 0
    for (const r of cohort) for (const l of liveLines(r)) {
      if (l.group !== g) continue
      if (r.category === 'LOST') { lostDevices++; continue }
      faultDevices++
      if (l.outcome === 'REPLACE') replace++; else if (l.outcome === 'REPAIR_RETURN') repairReturn++
    }
    const dep = depGroup.get(g) ?? 0
    return { group: g, faultDevices, lostDevices, replace, repairReturn, replaceRate: pct1(replace, replace + repairReturn), deployed: dep, per100: pct1(faultDevices, dep) }
  })
  const byProductType = ['일반', '라이트', '미지정'].map((t) => {
    let faultDevices = 0; let replace = 0
    for (const r of cohort) if (r.category === 'FAULT') for (const l of liveLines(r)) {
      const pt = l.productType === '일반' || l.productType === '라이트' ? l.productType : '미지정'
      if (pt !== t) continue
      faultDevices++; if (l.outcome === 'REPLACE') replace++
    }
    const dep = depType.get(t) ?? 0
    return { productType: t, faultDevices, replace, deployed: dep, per100: t === '미지정' ? null : pct1(faultDevices, dep) }
  })

  // 회수기기 처리 — 기간 안에 처리(repaired_at)된 라인
  const repaired = facts.flatMap((r) => r.lines.filter((l) => within(l.repairedAt, from, to)))
  const byResult = AS_REPAIR_RESULTS.map((k) => ({ key: k, label: AS_REPAIR_RESULT_LABELS[k as AsRepairResult], count: repaired.filter((l) => (l.repairResult ?? 'REPAIRED') === k).length }))
  const userMap = new Map<string, number>()
  for (const l of repaired) { const n = l.repairedBy ?? '(기록 없음)'; userMap.set(n, (userMap.get(n) ?? 0) + 1) }
  const judged = byResult.filter((x) => x.key !== 'SCRAPPED').reduce((a, x) => a + x.count, 0)

  // 반복 접수 — 고장 접수 기준, 정상 형식 시리얼만
  let repeat: AsDashQuality['repeat'] = null
  if (f.category !== 'LOST') {
    const rows = repeatRows.map((r) => ({ ...r, group: asDeviceGroupOf(r.device_name, r.device_kind, r.serial_no) })).filter((r) => !f.group || AS_DEVICE_GROUP_TO_CODE[r.group] === f.group)
    const rep = rows.filter((r) => Number(r.prior_cnt) > 0)
    const win = rows.filter((r) => r.last_repair_ship && diffDays(r.receipt_date, r.last_repair_ship) >= 0 && diffDays(r.receipt_date, r.last_repair_ship) <= AS_DASH_REPEAT_WINDOW_DAYS)
    const topMap = new Map<string, NonNullable<AsDashQuality['repeat']>['top'][number]>()
    for (const r of rows) {
      if (Number(r.life_cnt) < 2) continue
      const cur = topMap.get(r.serial_no)
      if (!cur) topMap.set(r.serial_no, { serialNo: r.serial_no, group: r.group, hospitalCode: r.hospital_code, hospitalName: r.hospital_name, lifeCount: Number(r.life_cnt), periodCount: 1, lastReceiptDate: r.receipt_date })
      else { cur.periodCount++; if (r.receipt_date > cur.lastReceiptDate) { cur.lastReceiptDate = r.receipt_date; cur.hospitalCode = r.hospital_code; cur.hospitalName = r.hospital_name } }
    }
    const gapOf = (r: (typeof rep)[number]) => (r.prev_date ? diffDays(r.receipt_date, r.prev_date) : null)
    const gaps = AS_DASH_REPEAT_GAPS.map((b, i) => ({ label: b.label, count: rep.filter((r) => { const d = gapOf(r); return d !== null && d <= b.max && (i === 0 || d > AS_DASH_REPEAT_GAPS[i - 1].max) }).length }))
    repeat = {
      gaps,
      windowDays: AS_DASH_REPEAT_WINDOW_DAYS, base: rows.length, repeat: rep.length, rate: pct1(rep.length, rows.length), within: win.length, withinRate: pct1(win.length, rows.length),
      top: Array.from(topMap.values()).sort((a, b) => b.lifeCount - a.lifeCount || b.periodCount - a.periodCount || b.lastReceiptDate.localeCompare(a.lastReceiptDate) || a.serialNo.localeCompare(b.serialNo)).slice(0, 15),
    }
  }

  // 접수사유 키워드 — 접수 건 단위(한 접수의 라인 사유를 합쳐 판정), 기기군 필터 시 해당 접수만
  const cohortIds = new Set(cohort.map((r) => r.id))
  const textBy = new Map<number, string>()
  for (const s of symptomRows) if (cohortIds.has(s.receipt_id) && s.symptom) textBy.set(s.receipt_id, `${textBy.get(s.receipt_id) ?? ''} ${s.symptom}`)
  const symCount = new Map<string, number>(); let unmatched = 0
  textBy.forEach((text) => {
    let hit = false
    for (const g of AS_DASH_SYMPTOM_GROUPS) if (g.re.test(text)) { symCount.set(g.key, (symCount.get(g.key) ?? 0) + 1); hit = true }
    if (!hit) unmatched++
  })

  return {
    range, byGroup, byProductType,
    repair: {
      total: repaired.length, byResult, noFaultRate: pct1(byResult.find((x) => x.key === 'NO_FAULT')?.count ?? 0, judged),
      byUser: Array.from(userMap.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    },
    repeat,
    symptoms: {
      receipts: textBy.size, unmatched,
      items: AS_DASH_SYMPTOM_GROUPS.map((g) => ({ key: g.key, label: g.label, count: symCount.get(g.key) ?? 0, pct: pct1(symCount.get(g.key) ?? 0, textBy.size) })).sort((a, b) => b.count - a.count),
    },
  }
}
