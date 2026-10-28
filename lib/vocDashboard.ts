/**
 * VOC·AS 주간 대시보드 집계 (projects/voc_dashboard_design.md §3 — 지표 정의의 단일 소스)
 *
 * - 주 = 금 00:00 KST ~ 다음 금 00:00 KST (금~목, 2026-10-28 개정 — 주간보고 리듬). 표기는 목요일이 속한 ISO 주(기존 PDF 'W43' 관행)
 * - 추이는 선택 주 포함 8주, 병원 TOP10은 선택 주 종료일 기준 최근 4주(28일)
 * - VOC 귀속 = voc_receipts.received_at(고객 첫 발화 — naive timestamp(UTC 저장)이라 반드시 `AT TIME ZONE 'UTC'`로 timestamptz화 후 KST 변환.
 *   세션 TZ가 dev2=KST·PROD=UTC로 달라 생략 시 주 경계가 밀린다), AS 귀속 = as_receipts.receipt_date(DATE)
 * - 분류 집계는 voc_receipt_types(복수 분류 각 1 계상 — 합계가 VOC 건수보다 클 수 있음)
 * - AS는 고장(FAULT)/분실(LOST) 분리 집계. 기기군은 lib/asReceiptShared.asDeviceGroupOf 로 접음. '취소' 접수·CANCELED 라인 제외
 * - 처리시간(1차 대응·종료) 지표는 2026-10-28 사용자 결정으로 제외
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { asDeviceGroupOf, AS_DEVICE_GROUPS, type AsDeviceGroup } from '@/lib/asReceiptShared'

const DAY = 86_400_000
const TREND_WEEKS = 8
const TOP_WINDOW_DAYS = 28
const RATIO_MIN_DEPLOYED = 50 // 배치 기기 대비 비율 TOP10 — 소규모 병원 왜곡 방지 하한

// ─── 달력 산술 (UTC 자정 Date로 산술, 조회 시 KST 인스턴트로 변환) ───
function utcDay(y: number, m: number, d: number) { return new Date(Date.UTC(y, m - 1, d)) }
function isoDow(d: Date) { return ((d.getUTCDay() + 6) % 7) + 1 } // 월=1 … 일=7
function addDays(d: Date, n: number) { return new Date(d.getTime() + n * DAY) }
function mondayOfIsoWeek(year: number, week: number) {
  const jan4 = utcDay(year, 1, 4)
  return addDays(addDays(jan4, 1 - isoDow(jan4)), (week - 1) * 7)
}
function isoWeekOf(day: Date) {
  const thu = addDays(day, 4 - isoDow(day))
  const year = thu.getUTCFullYear()
  return { year, week: Math.round((thu.getTime() - mondayOfIsoWeek(year, 1).getTime()) / (7 * DAY)) + 1 }
}
function ymd(d: Date) { return d.toISOString().slice(0, 10) }
function kst(d: Date) { return new Date(`${ymd(d)}T00:00:00+09:00`) }
function md(d: Date) { return `${d.getUTCMonth() + 1}/${d.getUTCDate()}` }
function todayKst() { return utcDay(...(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10).split('-').map(Number) as [number, number, number])) }
/** 목요일이 속한 ISO 주 표기 — 기존 주간보고 PDF 관행(10/16~10/22 = 26W43) */
function weekLabel(fri: Date) { const w = isoWeekOf(addDays(fri, 6)); return `${w.year}-W${String(w.week).padStart(2, '0')}` }

/** `week=` 파라미터 → 금요일(주 시작) 달력 날짜. YYYY-MM-DD(금요일) 또는 YYYY-Www(해당 ISO 주 목요일로 끝나는 창) */
export function parseWeekStart(s: string | null | undefined): Date | null {
  if (!s) return null
  const iso = /^(\d{4})-W(\d{1,2})$/.exec(s)
  if (iso) { const w = +iso[2]; if (w < 1 || w > 53) return null; return addDays(mondayOfIsoWeek(+iso[1], w), 3 - 6) } // 목(월+3) − 6 = 전주 금
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!day) return null
  const d = utcDay(+day[1], +day[2], +day[3])
  return Number.isNaN(d.getTime()) || isoDow(d) !== 5 ? null : d
}
/** 기본 = 마지막으로 완결된 금~목 창의 금요일 */
export function defaultWeekStart() {
  const today = todayKst()
  let back = (isoDow(today) - 4 + 7) % 7 // 오늘 이전의 가장 가까운 목요일(오늘이 목이면 진행 중이라 지난 목)
  if (back === 0) back = 7
  return addDays(addDays(today, -back), -6)
}

// ─── 응답 타입 ───
export interface WeekPoint { week: string; label: string; iso: string }
export interface Dist { median: number | null; p90: number | null; avg: number | null; n: number }
export interface AsCategoryStat {
  receipts: number; prevReceipts: number
  devices: number; prevDevices: number
  byGroup: { group: AsDeviceGroup; count: number }[]
  vocLinked: number
  open: number; openOver7d: number
  stages: { name: string; count: number }[]
  outcomes4w: { outcome: string; count: number }[]
  cumulative: { group: AsDeviceGroup; devices: number; deployed: number }[] // 전 기간 누적 접수 대수 / 현재 배치 기기 수
}
export interface HospitalAsRow { hospitalCode: string; name: string; receipts: number; faultDevices: number; lostDevices: number; deployed: number; ratio: number | null }
export interface VocDashboard {
  week: { start: string; end: string; iso: string; label: string; inProgress: boolean; prevStart: string; nextStart: string | null }
  generatedAt: string
  volume: {
    count: number; prevCount: number; perDay: number
    majors: string[]
    byMajorWeekly: (WeekPoint & Record<string, number | string>)[]
    topMinor: { name: string; count: number; prev: number }[]
    typedCount: number
    backlog: { total: number; over7d: number; byStatus: { name: string; count: number }[] }
    topHospitals4w: { hospitalCode: string; name: string; count: number; topType: string | null; lastAt: string }[]
  }
  teams: {
    teams: string[]
    weekly: (WeekPoint & Record<string, number | string>)[]
    current: { team: string; count: number }[]
    assignees: { name: string; count: number }[]
    chatTotal: number
  }
  as: {
    fault: AsCategoryStat; lost: AsCategoryStat
    preReplace: number
    shipDays: Dist // 고장 — 이번 주 발송(수리반환·교체) 라인의 접수→발송 달력일
    weekly: (WeekPoint & { faultReceipts: number; lostReceipts: number; fault심전계: number; fault산소포화도: number; fault기타: number; lost심전계: number; lost산소포화도: number; lost기타: number })[]
    topHospitalsByDevices: HospitalAsRow[]
    topHospitalsByRatio: HospitalAsRow[]
    ratioMinDeployed: number
    windowDays: number
  }
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const n0 = (v: unknown) => Number(v ?? 0)

export async function buildVocDashboard(opts: { weekStart: Date }): Promise<VocDashboard> {
  const fri = opts.weekStart
  const weekEndDay = addDays(fri, 7)
  const weekEnd = kst(weekEndDay)
  const seriesFri = addDays(fri, -7 * (TREND_WEEKS - 1))
  const seriesStart = kst(seriesFri)
  const topStartDay = addDays(weekEndDay, -TOP_WINDOW_DAYS)
  const topStart = kst(topStartDay)
  const today = todayKst()
  const inProgress = today.getTime() < weekEndDay.getTime()
  const CUR = TREND_WEEKS - 1; const PREV = TREND_WEEKS - 2
  const points: WeekPoint[] = Array.from({ length: TREND_WEEKS }, (_, i) => {
    const d = addDays(seriesFri, i * 7)
    return { week: ymd(d), label: md(d), iso: weekLabel(d) }
  })
  const seriesFriSql = ymd(seriesFri)
  const weekEndSql = ymd(weekEndDay)
  const topStartSql = ymd(topStartDay)

  // 버킷: 창 시작 금요일로부터 7일 단위 (0 = 가장 오래된 주 … 7 = 선택 주)
  const vocBucket = Prisma.sql`((((v.received_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date - ${seriesFriSql}::date) / 7)`
  const vocRange = Prisma.sql`v.received_at >= ${seriesStart}::timestamptz AT TIME ZONE 'UTC' AND v.received_at < ${weekEnd}::timestamptz AT TIME ZONE 'UTC'`
  const asRange = Prisma.sql`r.receipt_date >= ${seriesFriSql}::date AND r.receipt_date < ${weekEndSql}::date AND coalesce(s.name, '') <> '취소'`
  const asTopRange = Prisma.sql`r.receipt_date >= ${topStartSql}::date AND r.receipt_date < ${weekEndSql}::date AND coalesce(s.name, '') <> '취소'`

  const [vocWeekly, majorWeekly, minorRows, backlogRows, vocTopHosp, teamWeekly, assigneeRows, asWeekly, asItems, shipRows, asOpen, asOutcomes, asCumulative, deployedByGroup, asHosp] = await Promise.all([
    prisma.$queryRaw<{ b: number; n: number }[]>`
      SELECT ${vocBucket} AS b, count(*)::int AS n FROM voc_receipts v WHERE ${vocRange} GROUP BY 1`,
    prisma.$queryRaw<{ b: number; major: string; n: number }[]>`
      SELECT ${vocBucket} AS b, split_part(sc.name, '/', 1) AS major, count(*)::int AS n
      FROM voc_receipt_types t JOIN voc_receipts v ON v.id = t.voc_id JOIN status_codes sc ON sc.id = t.voc_type_id
      WHERE ${vocRange} GROUP BY 1, 2`,
    prisma.$queryRaw<{ b: number; name: string; n: number }[]>`
      SELECT ${vocBucket} AS b, sc.name, count(*)::int AS n
      FROM voc_receipt_types t JOIN voc_receipts v ON v.id = t.voc_id JOIN status_codes sc ON sc.id = t.voc_type_id
      WHERE ${vocRange} AND ${vocBucket} >= ${PREV} GROUP BY 1, 2`,
    prisma.$queryRaw<{ name: string | null; n: number; over7: number }[]>`
      SELECT s.name, count(*)::int AS n, count(*) FILTER (WHERE v.received_at < (now() AT TIME ZONE 'UTC') - interval '7 days')::int AS over7
      FROM voc_receipts v LEFT JOIN status_codes s ON s.id = v.status_id
      WHERE s.id IS NULL OR s.ticket_status NOT IN ('RESOLVED', 'CLOSED') GROUP BY s.name`,
    prisma.$queryRaw<{ hospital_code: string; name: string; n: number; top_type: string | null; last_at: Date }[]>`
      SELECT v.hospital_code, h.hospital_name AS name, count(*)::int AS n, max(v.received_at) AS last_at,
             (SELECT sc.name FROM voc_receipt_types t JOIN status_codes sc ON sc.id = t.voc_type_id JOIN voc_receipts v2 ON v2.id = t.voc_id
              WHERE v2.hospital_code = v.hospital_code AND v2.received_at >= ${topStart}::timestamptz AT TIME ZONE 'UTC' AND v2.received_at < ${weekEnd}::timestamptz AT TIME ZONE 'UTC'
              GROUP BY sc.name ORDER BY count(*) DESC, sc.name LIMIT 1) AS top_type
      FROM voc_receipts v JOIN hospitals h ON h.hospital_code = v.hospital_code
      WHERE v.received_at >= ${topStart}::timestamptz AT TIME ZONE 'UTC' AND v.received_at < ${weekEnd}::timestamptz AT TIME ZONE 'UTC'
      GROUP BY v.hospital_code, h.hospital_name ORDER BY n DESC, name LIMIT 10`,
    prisma.$queryRaw<{ b: number; team: string; n: number }[]>`
      SELECT (((c.first_user_message_at AT TIME ZONE 'Asia/Seoul')::date - ${seriesFriSql}::date) / 7) AS b, coalesce(x.team, '미지정') AS team, count(*)::int AS n
      FROM channeltalk_user_chats c JOIN voc_channeltalk_chats l ON l.chat_id = c.id
      LEFT JOIN LATERAL (SELECT t AS team FROM unnest(c.tags) t WHERE t LIKE '팀/%') x ON true
      WHERE c.first_user_message_at >= ${seriesStart} AND c.first_user_message_at < ${weekEnd} AND c.manager_initiated = false
      GROUP BY 1, 2`,
    prisma.$queryRaw<{ name: string; n: number }[]>`
      SELECT coalesce(m.name, '미배정') AS name, count(*)::int AS n
      FROM channeltalk_user_chats c JOIN voc_channeltalk_chats l ON l.chat_id = c.id LEFT JOIN channeltalk_managers m ON m.id = c.assignee_id
      WHERE c.first_user_message_at >= ${kst(fri)} AND c.first_user_message_at < ${weekEnd} AND c.manager_initiated = false
      GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw<{ b: number; category: string; n: number; linked: number; pre_replace: number }[]>`
      SELECT ((r.receipt_date - ${seriesFriSql}::date) / 7) AS b, r.category, count(*)::int AS n,
             count(*) FILTER (WHERE r.voc_id IS NOT NULL)::int AS linked, count(*) FILTER (WHERE r.pre_replace)::int AS pre_replace
      FROM as_receipts r LEFT JOIN status_codes s ON s.id = r.status_id WHERE ${asRange} GROUP BY 1, 2`,
    prisma.$queryRaw<{ b: number; category: string; device_name: string | null; device_kind: string | null; serial_no: string }[]>`
      SELECT ((r.receipt_date - ${seriesFriSql}::date) / 7) AS b, r.category, di.device_name, i.device_kind, i.serial_no
      FROM as_receipt_items i JOIN as_receipts r ON r.id = i.receipt_id
      LEFT JOIN device_units du ON du.id = i.device_id LEFT JOIN device_info di ON di.id = du.device_info_id
      LEFT JOIN status_codes s ON s.id = r.status_id
      WHERE ${asRange} AND coalesce(i.outcome, '') <> 'CANCELED'`,
    prisma.$queryRaw<{ n: number; med: number | null; p90: number | null; avg: number | null }[]>`
      SELECT count(*)::int AS n,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY i.shipped_at - r.receipt_date) AS med,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY i.shipped_at - r.receipt_date) AS p90,
             avg(i.shipped_at - r.receipt_date) AS avg
      FROM as_receipt_items i JOIN as_receipts r ON r.id = i.receipt_id
      WHERE r.category = 'FAULT' AND i.shipped_at >= ${ymd(fri)}::date AND i.shipped_at < ${weekEndSql}::date AND i.outcome IN ('REPAIR_RETURN', 'REPLACE')`,
    prisma.$queryRaw<{ category: string; name: string; ord: number; n: number; over7: number }[]>`
      SELECT r.category, coalesce(s.name, '상태 없음') AS name, coalesce(s."order", 99) AS ord, count(*)::int AS n,
             count(*) FILTER (WHERE r.receipt_date < (now() AT TIME ZONE 'Asia/Seoul')::date - 7)::int AS over7
      FROM as_receipts r LEFT JOIN status_codes s ON s.id = r.status_id
      WHERE s.id IS NULL OR s.ticket_status <> 'CLOSED' GROUP BY 1, 2, 3 ORDER BY 3`,
    prisma.$queryRaw<{ category: string; outcome: string; n: number }[]>`
      SELECT r.category, coalesce(i.outcome, 'IN_PROGRESS') AS outcome, count(*)::int AS n
      FROM as_receipt_items i JOIN as_receipts r ON r.id = i.receipt_id LEFT JOIN status_codes s ON s.id = r.status_id
      WHERE ${asTopRange} GROUP BY 1, 2`,
    prisma.$queryRaw<{ category: string; device_name: string | null; device_kind: string | null; serial_no: string }[]>`
      SELECT r.category, di.device_name, i.device_kind, i.serial_no
      FROM as_receipt_items i JOIN as_receipts r ON r.id = i.receipt_id
      LEFT JOIN device_units du ON du.id = i.device_id LEFT JOIN device_info di ON di.id = du.device_info_id
      LEFT JOIN status_codes s ON s.id = r.status_id
      WHERE coalesce(s.name, '') <> '취소' AND coalesce(i.outcome, '') <> 'CANCELED'`,
    prisma.$queryRaw<{ device_name: string | null; n: number }[]>`
      SELECT di.device_name, count(*)::int AS n
      FROM hospital_devices hd JOIN device_units du ON du.id = hd.device_id JOIN device_info di ON di.id = du.device_info_id
      WHERE hd.status = 'ACTIVE' GROUP BY 1`,
    prisma.$queryRaw<{ hospital_code: string; name: string; receipts: number; fault_devices: number; lost_devices: number; deployed: number }[]>`
      SELECT r.hospital_code, h.hospital_name AS name, count(DISTINCT r.id)::int AS receipts,
             count(i.id) FILTER (WHERE r.category = 'FAULT')::int AS fault_devices,
             count(i.id) FILTER (WHERE r.category = 'LOST')::int AS lost_devices,
             (SELECT count(*) FROM hospital_devices hd WHERE hd.hospital_code = r.hospital_code AND hd.status = 'ACTIVE')::int AS deployed
      FROM as_receipts r JOIN hospitals h ON h.hospital_code = r.hospital_code
      LEFT JOIN as_receipt_items i ON i.receipt_id = r.id AND coalesce(i.outcome, '') <> 'CANCELED'
      LEFT JOIN status_codes s ON s.id = r.status_id
      WHERE ${asTopRange} GROUP BY r.hospital_code, h.hospital_name`,
  ])

  // ── Volume
  const vocByB = new Map(vocWeekly.map((r) => [Number(r.b), n0(r.n)]))
  const MAJOR_ORDER = ['AS', '오류SW', '오류HW', 'EMR', '사용', '운영', '개선', '타사']
  const majorsSet = new Set(majorWeekly.map((r) => r.major))
  const majors = [...MAJOR_ORDER.filter((m) => majorsSet.has(m)), ...Array.from(majorsSet).filter((m) => !MAJOR_ORDER.includes(m)).sort()]
  const byMajorWeekly = points.map((p, i) => {
    const row: WeekPoint & Record<string, number | string> = { ...p }
    for (const m of majors) row[m] = 0
    for (const r of majorWeekly) if (Number(r.b) === i) row[r.major] = n0(r.n)
    row.total = vocByB.get(i) ?? 0
    return row
  })
  const minorCur = minorRows.filter((r) => Number(r.b) === CUR)
  const minorPrev = new Map(minorRows.filter((r) => Number(r.b) === PREV).map((r) => [r.name, n0(r.n)]))
  const topMinor = minorCur.sort((a, b) => n0(b.n) - n0(a.n) || a.name.localeCompare(b.name)).slice(0, 10)
    .map((r) => ({ name: r.name, count: n0(r.n), prev: minorPrev.get(r.name) ?? 0 }))
  const count = vocByB.get(CUR) ?? 0

  // ── Teams
  const teamTotals = new Map<string, number>()
  for (const r of teamWeekly) teamTotals.set(r.team, (teamTotals.get(r.team) ?? 0) + n0(r.n))
  const teams = Array.from(teamTotals.keys()).sort((a, b) => (teamTotals.get(b) ?? 0) - (teamTotals.get(a) ?? 0))
  const teamsWeekly = points.map((p, i) => {
    const row: WeekPoint & Record<string, number | string> = { ...p }
    for (const t of teams) row[t] = 0
    for (const r of teamWeekly) if (Number(r.b) === i) row[r.team] = n0(r.n)
    return row
  })
  const currentTeams = teamWeekly.filter((r) => Number(r.b) === CUR).map((r) => ({ team: r.team, count: n0(r.n) })).sort((a, b) => b.count - a.count)

  // ── AS — 고장/분실 분리
  const group = (r: { device_name: string | null; device_kind: string | null; serial_no: string }) => asDeviceGroupOf(r.device_name, r.device_kind, r.serial_no)
  const deployed = new Map<AsDeviceGroup, number>()
  for (const r of deployedByGroup) { const g = asDeviceGroupOf(r.device_name, null); deployed.set(g, (deployed.get(g) ?? 0) + n0(r.n)) }
  const OUTCOME_LABEL: Record<string, string> = { IN_PROGRESS: '진행 중', REPAIR_RETURN: '수리반환', REPLACE: '교체', LOST: '분실종결', CANCELED: '라인취소', NOT_RECEIVED: '미회수' }
  const catStat = (cat: 'FAULT' | 'LOST'): AsCategoryStat => {
    const wk = (b: number) => asWeekly.find((r) => Number(r.b) === b && r.category === cat)
    const items = (b: number) => asItems.filter((r) => Number(r.b) === b && r.category === cat)
    const grp = new Map<AsDeviceGroup, number>()
    for (const it of items(CUR)) { const g = group(it); grp.set(g, (grp.get(g) ?? 0) + 1) }
    const openRows = asOpen.filter((r) => r.category === cat)
    const cum = new Map<AsDeviceGroup, number>()
    for (const it of asCumulative.filter((r) => r.category === cat)) { const g = group(it); cum.set(g, (cum.get(g) ?? 0) + 1) }
    return {
      receipts: n0(wk(CUR)?.n), prevReceipts: n0(wk(PREV)?.n),
      devices: items(CUR).length, prevDevices: items(PREV).length,
      byGroup: AS_DEVICE_GROUPS.map((g) => ({ group: g, count: grp.get(g) ?? 0 })),
      vocLinked: n0(wk(CUR)?.linked),
      open: openRows.reduce((a, r) => a + n0(r.n), 0), openOver7d: openRows.reduce((a, r) => a + n0(r.over7), 0),
      stages: openRows.map((r) => ({ name: r.name, count: n0(r.n) })),
      outcomes4w: asOutcomes.filter((r) => r.category === cat).map((r) => ({ outcome: OUTCOME_LABEL[r.outcome] ?? r.outcome, count: n0(r.n) })).sort((a, b) => b.count - a.count),
      cumulative: AS_DEVICE_GROUPS.filter((g) => g !== '기타').map((g) => ({ group: g, devices: cum.get(g) ?? 0, deployed: deployed.get(g) ?? 0 })),
    }
  }
  const weeklyAs = points.map((p, i) => {
    const row = { ...p, faultReceipts: 0, lostReceipts: 0, fault심전계: 0, fault산소포화도: 0, fault기타: 0, lost심전계: 0, lost산소포화도: 0, lost기타: 0 }
    for (const r of asWeekly) if (Number(r.b) === i) { if (r.category === 'FAULT') row.faultReceipts = n0(r.n); else row.lostReceipts = n0(r.n) }
    for (const it of asItems) if (Number(it.b) === i) { const k = `${it.category === 'FAULT' ? 'fault' : 'lost'}${group(it)}` as keyof typeof row; (row[k] as number)++ }
    return row
  })
  const hospRows: HospitalAsRow[] = asHosp.map((r) => {
    const devices = n0(r.fault_devices) + n0(r.lost_devices)
    const dep = n0(r.deployed)
    return { hospitalCode: r.hospital_code, name: r.name, receipts: n0(r.receipts), faultDevices: n0(r.fault_devices), lostDevices: n0(r.lost_devices), deployed: dep, ratio: dep ? Math.round((devices / dep) * 1000) / 10 : null }
  })
  const topByDevices = [...hospRows].sort((a, b) => (b.faultDevices + b.lostDevices) - (a.faultDevices + a.lostDevices) || b.receipts - a.receipts).slice(0, 10)
  const topByRatio = hospRows.filter((h) => h.deployed >= RATIO_MIN_DEPLOYED && h.ratio !== null).sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0)).slice(0, 10)

  const backlogTotal = backlogRows.reduce((a, r) => a + n0(r.n), 0)
  return {
    week: {
      start: ymd(fri), end: ymd(addDays(fri, 6)), iso: weekLabel(fri), label: `${md(fri)}~${md(addDays(fri, 6))}`, inProgress,
      prevStart: ymd(addDays(fri, -7)), nextStart: weekEndDay.getTime() <= today.getTime() ? ymd(weekEndDay) : null,
    },
    generatedAt: new Date().toISOString(),
    volume: {
      count, prevCount: vocByB.get(PREV) ?? 0, perDay: Math.round((count / 5) * 10) / 10,
      majors, byMajorWeekly, topMinor, typedCount: minorCur.reduce((a, r) => a + n0(r.n), 0),
      backlog: { total: backlogTotal, over7d: backlogRows.reduce((a, r) => a + n0(r.over7), 0), byStatus: backlogRows.map((r) => ({ name: r.name ?? '상태 없음', count: n0(r.n) })).sort((a, b) => b.count - a.count) },
      topHospitals4w: vocTopHosp.map((r) => ({ hospitalCode: r.hospital_code, name: r.name, count: n0(r.n), topType: r.top_type, lastAt: new Date(r.last_at).toISOString() })),
    },
    teams: {
      teams, weekly: teamsWeekly, current: currentTeams,
      assignees: assigneeRows.map((r) => ({ name: r.name, count: n0(r.n) })),
      chatTotal: assigneeRows.reduce((a, r) => a + n0(r.n), 0),
    },
    as: {
      fault: catStat('FAULT'), lost: catStat('LOST'),
      preReplace: n0(asWeekly.find((r) => Number(r.b) === CUR && r.category === 'FAULT')?.pre_replace),
      shipDays: { n: n0(shipRows[0]?.n), median: num(shipRows[0]?.med), p90: num(shipRows[0]?.p90), avg: num(shipRows[0]?.avg) },
      weekly: weeklyAs,
      topHospitalsByDevices: topByDevices, topHospitalsByRatio: topByRatio,
      ratioMinDeployed: RATIO_MIN_DEPLOYED, windowDays: TOP_WINDOW_DAYS,
    },
  }
}
