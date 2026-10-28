/**
 * VOC 주간 대시보드 집계 (projects/voc_dashboard_design.md §3 — 지표 정의의 단일 소스)
 *
 * - 주 = ISO 주(월 00:00 KST ~ 다음 월 00:00 KST). 추이는 선택 주 포함 8주
 * - VOC 귀속 = voc_receipts.received_at(고객 첫 발화), AS 귀속 = as_receipts.receipt_date
 * - 1차 대응 = 고객 첫 발화 이후 사람 담당자의 첫 텍스트 메시지(봇·log 액션 제외). 담당자 발신 상담은 분모 제외
 * - 분류 집계는 voc_receipt_types(복수 분류 각 1 계상 — 합계가 VOC 건수보다 클 수 있음)
 * - 응답 시간 대표값은 중앙값·p90(평균은 참고)
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { asDeviceGroupOf, AS_DEVICE_GROUPS, type AsDeviceGroup } from '@/lib/asReceiptShared'

const DAY = 86_400_000
const TREND_WEEKS = 8
const REPEAT_WINDOW_WEEKS = 4
export const REPEAT_THRESHOLDS = [3, 5, 10] as const

// ─── ISO 주 계산 (달력 날짜는 UTC 자정 Date로 산술, 조회 시 KST 인스턴트로 변환) ───
function utcDay(y: number, m: number, d: number) { return new Date(Date.UTC(y, m - 1, d)) }
function isoDow(d: Date) { return ((d.getUTCDay() + 6) % 7) + 1 } // 월=1 … 일=7
function addDays(d: Date, n: number) { return new Date(d.getTime() + n * DAY) }
/** ISO 주 번호의 월요일 (달력 날짜) */
function mondayOfIsoWeek(year: number, week: number) {
  const jan4 = utcDay(year, 1, 4)
  return addDays(addDays(jan4, 1 - isoDow(jan4)), (week - 1) * 7)
}
/** 달력 날짜 → ISO {year, week} */
function isoWeekOf(day: Date) {
  const thu = addDays(day, 4 - isoDow(day))
  const year = thu.getUTCFullYear()
  const week = Math.round((thu.getTime() - mondayOfIsoWeek(year, 1).getTime()) / (7 * DAY)) + 1
  return { year, week }
}
function ymd(d: Date) { return d.toISOString().slice(0, 10) }
/** 달력 날짜 00:00 KST 인스턴트 */
function kst(d: Date) { return new Date(`${ymd(d)}T00:00:00+09:00`) }
function isoLabel(year: number, week: number) { return `${year}-W${String(week).padStart(2, '0')}` }
/** 오늘(KST) 달력 날짜 */
function todayKst() { return utcDay(...(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10).split('-').map(Number) as [number, number, number])) }

export function parseIsoWeek(s: string | null | undefined): { year: number; week: number } | null {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(s ?? '')
  if (!m) return null
  const year = +m[1]; const week = +m[2]
  if (week < 1 || week > 53) return null
  return { year, week }
}
/** 기본 = 지난주(완결 주) */
export function defaultIsoWeek() { return isoWeekOf(addDays(todayKst(), -7)) }

// ─── 응답 타입 ───
export interface Dist { median: number | null; p90: number | null; avg: number | null; n: number } // 초 단위
export interface WeekPoint { week: string; label: string; start: string }
export interface VocDashboard {
  week: { iso: string; start: string; end: string; label: string; inProgress: boolean; prevIso: string; nextIso: string | null }
  generatedAt: string
  volume: {
    count: number; prevCount: number; perDay: number
    majors: string[]
    byMajorWeekly: (WeekPoint & Record<string, number | string>)[]
    topMinor: { name: string; count: number; prev: number }[]
    typedCount: number // 분류 기준 합계(중복 포함)
  }
  responsiveness: {
    total: number; human: number; closed: number; within24h: number
    firstResp: Dist; prevFirstResp: Dist; close: Dist; prevClose: Dist
    weekly: (WeekPoint & { total: number; medianFirst: number | null; p90First: number | null; medianClose: number | null })[]
    backlog: { total: number; over7d: number; byStatus: { name: string; count: number }[] }
  }
  teams: {
    teams: string[]
    weekly: (WeekPoint & Record<string, number | string>)[]
    current: { team: string; count: number }[]
    assignees: { name: string; count: number; medianFirst: number | null }[]
  }
  repeatHospitals: { threshold: number; windowWeeks: number; rows: { hospitalCode: string; name: string; count: number; topType: string | null; lastAt: string }[] }
  as: {
    count: number; prevCount: number; fault: number; lost: number
    byGroup: { group: AsDeviceGroup; count: number }[]
    shipDays: Dist
    backlog: { open: number; over7d: number }
    vocLinked: { n: number; total: number; pct: number | null }
    weekly: (WeekPoint & { fault: number; lost: number })[]
  }
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const dist = (r: { n?: unknown; med?: unknown; p90?: unknown; avg?: unknown } | undefined): Dist =>
  ({ n: Number(r?.n ?? 0), median: num(r?.med), p90: num(r?.p90), avg: num(r?.avg) })

export async function buildVocDashboard(opts: { year: number; week: number; repeatThreshold?: number }): Promise<VocDashboard> {
  const threshold = (REPEAT_THRESHOLDS as readonly number[]).includes(opts.repeatThreshold ?? 0) ? opts.repeatThreshold! : 5
  const monday = mondayOfIsoWeek(opts.year, opts.week)
  const weekEnd = kst(addDays(monday, 7))
  const prevMonday = addDays(monday, -7)
  const seriesMonday = addDays(monday, -7 * (TREND_WEEKS - 1))
  const seriesStart = kst(seriesMonday)
  const repeatStart = kst(addDays(monday, -7 * (REPEAT_WINDOW_WEEKS - 1)))
  const today = todayKst()
  const inProgress = today.getTime() < addDays(monday, 7).getTime()
  const prev = isoWeekOf(prevMonday)
  const next = isoWeekOf(addDays(monday, 7))
  const weekKey = ymd(monday)
  const prevKey = ymd(prevMonday)
  const points: WeekPoint[] = Array.from({ length: TREND_WEEKS }, (_, i) => {
    const d = addDays(seriesMonday, i * 7)
    const w = isoWeekOf(d)
    return { week: ymd(d), label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, start: isoLabel(w.year, w.week) }
  })
  const byWeek = <T>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T[]>()
    for (const r of rows) { const k = key(r); m.set(k, [...(m.get(k) ?? []), r]) }
    return m
  }
  const wk = (r: { wk: Date | string }) => (r.wk instanceof Date ? ymd(r.wk) : String(r.wk).slice(0, 10))

  // ── 주간 공통 CTE: VOC에 연결된 상담(담당자 발신 제외) + 사람 첫 답변
  const chatCte = Prisma.sql`
    chats AS (
      SELECT c.id, c.first_user_message_at AS fu, c.closed_at, c.assignee_id, c.tags,
             date_trunc('week', c.first_user_message_at AT TIME ZONE 'Asia/Seoul')::date AS wk
      FROM channeltalk_user_chats c
      JOIN voc_channeltalk_chats l ON l.chat_id = c.id
      WHERE c.first_user_message_at >= ${seriesStart} AND c.first_user_message_at < ${weekEnd} AND c.manager_initiated = false
    ),
    fr AS (
      SELECT DISTINCT ON (m.chat_id) m.chat_id, m.created_at_ct
      FROM channeltalk_messages m JOIN chats ON chats.id = m.chat_id
      WHERE m.person_type = 'manager' AND coalesce(m.plain_text, '') <> '' AND (m.raw -> 'log') IS NULL AND m.created_at_ct > chats.fu
      ORDER BY m.chat_id, m.created_at_ct
    ),
    joined AS (
      SELECT chats.*, fr.created_at_ct AS first_reply,
             extract(epoch FROM fr.created_at_ct - chats.fu) AS fr_sec,
             extract(epoch FROM chats.closed_at - chats.fu) AS cl_sec
      FROM chats LEFT JOIN fr ON fr.chat_id = chats.id
    )`

  const [vocWeekly, majorWeekly, minorRows, respWeekly, backlogRows, teamWeekly, assigneeRows, repeatRows, asWeekly, asItems, shipRows, asBacklog] = await Promise.all([
    prisma.$queryRaw<{ wk: Date; n: number }[]>`
      SELECT date_trunc('week', received_at AT TIME ZONE 'Asia/Seoul')::date AS wk, count(*)::int AS n
      FROM voc_receipts WHERE received_at >= ${seriesStart} AND received_at < ${weekEnd} GROUP BY 1`,
    prisma.$queryRaw<{ wk: Date; major: string; n: number }[]>`
      SELECT date_trunc('week', v.received_at AT TIME ZONE 'Asia/Seoul')::date AS wk, split_part(sc.name, '/', 1) AS major, count(*)::int AS n
      FROM voc_receipt_types t JOIN voc_receipts v ON v.id = t.voc_id JOIN status_codes sc ON sc.id = t.voc_type_id
      WHERE v.received_at >= ${seriesStart} AND v.received_at < ${weekEnd} GROUP BY 1, 2`,
    prisma.$queryRaw<{ wk: Date; name: string; n: number }[]>`
      SELECT date_trunc('week', v.received_at AT TIME ZONE 'Asia/Seoul')::date AS wk, sc.name, count(*)::int AS n
      FROM voc_receipt_types t JOIN voc_receipts v ON v.id = t.voc_id JOIN status_codes sc ON sc.id = t.voc_type_id
      WHERE v.received_at >= ${kst(prevMonday)} AND v.received_at < ${weekEnd} GROUP BY 1, 2`,
    prisma.$queryRaw<{ wk: Date; total: number; human: number; closed: number; within24: number; med: number | null; p90: number | null; avg: number | null; cmed: number | null; cp90: number | null; cavg: number | null }[]>`
      WITH ${chatCte}
      SELECT wk, count(*)::int AS total, count(first_reply)::int AS human, count(closed_at)::int AS closed,
             count(*) FILTER (WHERE cl_sec IS NOT NULL AND cl_sec <= 86400)::int AS within24,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY fr_sec) AS med, percentile_cont(0.9) WITHIN GROUP (ORDER BY fr_sec) AS p90, avg(fr_sec) AS avg,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY cl_sec) AS cmed, percentile_cont(0.9) WITHIN GROUP (ORDER BY cl_sec) AS cp90, avg(cl_sec) AS cavg
      FROM joined GROUP BY wk`,
    prisma.$queryRaw<{ name: string | null; n: number; over7: number }[]>`
      SELECT s.name, count(*)::int AS n, count(*) FILTER (WHERE v.received_at < now() - interval '7 days')::int AS over7
      FROM voc_receipts v LEFT JOIN status_codes s ON s.id = v.status_id
      WHERE s.id IS NULL OR s.ticket_status NOT IN ('RESOLVED', 'CLOSED') GROUP BY s.name`,
    prisma.$queryRaw<{ wk: Date; team: string; n: number }[]>`
      WITH ${chatCte}
      SELECT wk, coalesce(x.team, '미지정') AS team, count(*)::int AS n
      FROM joined LEFT JOIN LATERAL (SELECT t AS team FROM unnest(joined.tags) t WHERE t LIKE '팀/%') x ON true
      GROUP BY 1, 2`,
    prisma.$queryRaw<{ name: string; n: number; med: number | null }[]>`
      WITH ${chatCte}
      SELECT coalesce(m.name, '미배정') AS name, count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY fr_sec) AS med
      FROM joined LEFT JOIN channeltalk_managers m ON m.id = joined.assignee_id
      WHERE joined.wk = ${weekKey}::date GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw<{ hospital_code: string; name: string; n: number; top_type: string | null; last_at: Date }[]>`
      SELECT v.hospital_code, h.hospital_name AS name, count(*)::int AS n, max(v.received_at) AS last_at,
             (SELECT sc.name FROM voc_receipt_types t JOIN status_codes sc ON sc.id = t.voc_type_id JOIN voc_receipts v2 ON v2.id = t.voc_id
              WHERE v2.hospital_code = v.hospital_code AND v2.received_at >= ${repeatStart} AND v2.received_at < ${weekEnd}
              GROUP BY sc.name ORDER BY count(*) DESC, sc.name LIMIT 1) AS top_type
      FROM voc_receipts v JOIN hospitals h ON h.hospital_code = v.hospital_code
      WHERE v.received_at >= ${repeatStart} AND v.received_at < ${weekEnd}
      GROUP BY v.hospital_code, h.hospital_name HAVING count(*) >= ${threshold} ORDER BY n DESC, name LIMIT 30`,
    prisma.$queryRaw<{ wk: Date; n: number; lost: number; linked: number }[]>`
      SELECT date_trunc('week', r.receipt_date)::date AS wk, count(*)::int AS n, count(*) FILTER (WHERE r.category = 'LOST')::int AS lost,
             count(*) FILTER (WHERE r.voc_id IS NOT NULL)::int AS linked
      FROM as_receipts r LEFT JOIN status_codes s ON s.id = r.status_id
      WHERE r.receipt_date >= ${ymd(seriesMonday)}::date AND r.receipt_date < ${ymd(addDays(monday, 7))}::date AND coalesce(s.name, '') <> '취소'
      GROUP BY 1`,
    prisma.$queryRaw<{ device_name: string | null; device_kind: string | null; serial_no: string }[]>`
      SELECT di.device_name, i.device_kind, i.serial_no
      FROM as_receipt_items i JOIN as_receipts r ON r.id = i.receipt_id
      LEFT JOIN device_units du ON du.id = i.device_id LEFT JOIN device_info di ON di.id = du.device_info_id
      LEFT JOIN status_codes s ON s.id = r.status_id
      WHERE r.receipt_date >= ${weekKey}::date AND r.receipt_date < ${ymd(addDays(monday, 7))}::date AND coalesce(s.name, '') <> '취소'
        AND coalesce(i.outcome, '') <> 'CANCELED'`,
    prisma.$queryRaw<{ n: number; med: number | null; p90: number | null; avg: number | null }[]>`
      SELECT count(*)::int AS n,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY i.shipped_at - r.receipt_date) AS med,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY i.shipped_at - r.receipt_date) AS p90,
             avg(i.shipped_at - r.receipt_date) AS avg
      FROM as_receipt_items i JOIN as_receipts r ON r.id = i.receipt_id
      WHERE i.shipped_at >= ${weekKey}::date AND i.shipped_at < ${ymd(addDays(monday, 7))}::date AND i.outcome IN ('REPAIR_RETURN', 'REPLACE')`,
    prisma.$queryRaw<{ open: number; over7: number }[]>`
      SELECT count(*)::int AS open, count(*) FILTER (WHERE r.receipt_date < current_date - 7)::int AS over7
      FROM as_receipts r LEFT JOIN status_codes s ON s.id = r.status_id
      WHERE s.id IS NULL OR s.ticket_status <> 'CLOSED'`,
  ])

  // ── Volume
  const vocByWeek = new Map(vocWeekly.map((r) => [wk(r), Number(r.n)]))
  const majorsSet = new Set(majorWeekly.map((r) => r.major))
  const MAJOR_ORDER = ['AS', '오류SW', '오류HW', 'EMR', '사용', '운영', '개선', '타사']
  const majors = [...MAJOR_ORDER.filter((m) => majorsSet.has(m)), ...Array.from(majorsSet).filter((m) => !MAJOR_ORDER.includes(m)).sort()]
  const majorMap = byWeek(majorWeekly, wk)
  const byMajorWeekly = points.map((p) => {
    const row: WeekPoint & Record<string, number | string> = { ...p }
    for (const m of majors) row[m] = 0
    for (const r of majorMap.get(p.week) ?? []) row[r.major] = Number(r.n)
    row.total = vocByWeek.get(p.week) ?? 0
    return row
  })
  const minorCur = minorRows.filter((r) => wk(r) === weekKey)
  const minorPrev = new Map(minorRows.filter((r) => wk(r) === prevKey).map((r) => [r.name, Number(r.n)]))
  const topMinor = minorCur.sort((a, b) => Number(b.n) - Number(a.n) || a.name.localeCompare(b.name)).slice(0, 10)
    .map((r) => ({ name: r.name, count: Number(r.n), prev: minorPrev.get(r.name) ?? 0 }))
  const count = vocByWeek.get(weekKey) ?? 0

  // ── Responsiveness
  const respMap = new Map(respWeekly.map((r) => [wk(r), r]))
  const cur = respMap.get(weekKey); const prv = respMap.get(prevKey)
  const backlogTotal = backlogRows.reduce((a, r) => a + Number(r.n), 0)
  const backlogOver7 = backlogRows.reduce((a, r) => a + Number(r.over7), 0)

  // ── Teams
  const teamSet = new Set(teamWeekly.map((r) => r.team))
  const teamTotals = new Map<string, number>()
  for (const r of teamWeekly) teamTotals.set(r.team, (teamTotals.get(r.team) ?? 0) + Number(r.n))
  const teams = Array.from(teamSet).sort((a, b) => (teamTotals.get(b) ?? 0) - (teamTotals.get(a) ?? 0))
  const teamMap = byWeek(teamWeekly, wk)
  const teamsWeekly = points.map((p) => {
    const row: WeekPoint & Record<string, number | string> = { ...p }
    for (const t of teams) row[t] = 0
    for (const r of teamMap.get(p.week) ?? []) row[r.team] = Number(r.n)
    return row
  })
  const currentTeams = (teamMap.get(weekKey) ?? []).map((r) => ({ team: r.team, count: Number(r.n) })).sort((a, b) => b.count - a.count)

  // ── AS
  const asMap = new Map(asWeekly.map((r) => [wk(r), r]))
  const asCur = asMap.get(weekKey); const asPrev = asMap.get(prevKey)
  const groupCount = new Map<AsDeviceGroup, number>()
  for (const i of asItems) { const g = asDeviceGroupOf(i.device_name, i.device_kind, i.serial_no); groupCount.set(g, (groupCount.get(g) ?? 0) + 1) }
  const asCount = Number(asCur?.n ?? 0)
  const asLinkedN = Number(asCur?.linked ?? 0)

  return {
    week: {
      iso: isoLabel(opts.year, opts.week), start: weekKey, end: ymd(addDays(monday, 6)), label: `${monday.getUTCMonth() + 1}/${monday.getUTCDate()}~${addDays(monday, 6).getUTCMonth() + 1}/${addDays(monday, 6).getUTCDate()}`,
      inProgress, prevIso: isoLabel(prev.year, prev.week),
      nextIso: addDays(monday, 7).getTime() <= today.getTime() ? isoLabel(next.year, next.week) : null,
    },
    generatedAt: new Date().toISOString(),
    volume: {
      count, prevCount: vocByWeek.get(prevKey) ?? 0, perDay: Math.round((count / 5) * 10) / 10,
      majors, byMajorWeekly, topMinor, typedCount: minorCur.reduce((a, r) => a + Number(r.n), 0),
    },
    responsiveness: {
      total: Number(cur?.total ?? 0), human: Number(cur?.human ?? 0), closed: Number(cur?.closed ?? 0), within24h: Number(cur?.within24 ?? 0),
      firstResp: dist({ n: cur?.human, med: cur?.med, p90: cur?.p90, avg: cur?.avg }),
      prevFirstResp: dist({ n: prv?.human, med: prv?.med, p90: prv?.p90, avg: prv?.avg }),
      close: dist({ n: cur?.closed, med: cur?.cmed, p90: cur?.cp90, avg: cur?.cavg }),
      prevClose: dist({ n: prv?.closed, med: prv?.cmed, p90: prv?.cp90, avg: prv?.cavg }),
      weekly: points.map((p) => { const r = respMap.get(p.week); return { ...p, total: Number(r?.total ?? 0), medianFirst: num(r?.med), p90First: num(r?.p90), medianClose: num(r?.cmed) } }),
      backlog: { total: backlogTotal, over7d: backlogOver7, byStatus: backlogRows.map((r) => ({ name: r.name ?? '상태 없음', count: Number(r.n) })).sort((a, b) => b.count - a.count) },
    },
    teams: {
      teams, weekly: teamsWeekly, current: currentTeams,
      assignees: assigneeRows.map((r) => ({ name: r.name, count: Number(r.n), medianFirst: num(r.med) })),
    },
    repeatHospitals: {
      threshold, windowWeeks: REPEAT_WINDOW_WEEKS,
      rows: repeatRows.map((r) => ({ hospitalCode: r.hospital_code, name: r.name, count: Number(r.n), topType: r.top_type, lastAt: new Date(r.last_at).toISOString() })),
    },
    as: {
      count: asCount, prevCount: Number(asPrev?.n ?? 0), fault: asCount - Number(asCur?.lost ?? 0), lost: Number(asCur?.lost ?? 0),
      byGroup: AS_DEVICE_GROUPS.map((g) => ({ group: g, count: groupCount.get(g) ?? 0 })),
      shipDays: dist(shipRows[0]),
      backlog: { open: Number(asBacklog[0]?.open ?? 0), over7d: Number(asBacklog[0]?.over7 ?? 0) },
      vocLinked: { n: asLinkedN, total: asCount, pct: asCount ? Math.round((asLinkedN / asCount) * 100) : null },
      weekly: points.map((p) => { const r = asMap.get(p.week); return { ...p, fault: Number(r?.n ?? 0) - Number(r?.lost ?? 0), lost: Number(r?.lost ?? 0) } }),
    },
  }
}
