/**
 * 사용량 — 전체 병원 화면의 계산 (projects/usage_overview_design.md §3)
 *
 * 지표를 새로 만들지 않는다. 일별 집계(lib/usage/stats.ts 가 저장한 최대 동시사용 수 · 계약·공급 수량)를 기간으로 묶는 규칙만 있다.
 *  - 가동률 = 동시 가동률(그날 최대 동시사용 수 ÷ 그날의 계약·공급 수량)의 기간 평균. 기기 종류 하나를 골라 본다.
 *  - 최근 30일 = 병원별 화면 '최근 30일'과 같은 날짜 범위(오늘 포함 30일, 평균은 오늘 제외) → 병원별 화면의 '동시 가동률 평균'과 같은 값
 *  - 이전 30일 = 그 바로 앞 30일
 *  - 변화 = 최근 − 이전 (%p). +5%p 이상 증가 · −5%p 이하 감소 · 그 사이 유지
 *  - 유효한 날 = 계약·공급 수량이 있고, 기기별 수치가 있고, 오늘이 아니고, 수신이 끊긴 병원은 마지막 수신일 전
 *  - 판정 보류 = 집계 전 · 수량 없음 · 기기 상태 이력을 따라잡는 중 · 어느 한 기간의 유효한 날이 14일 미만
 *  - 전체 가동률 = Σ(병원별 평균 최대 동시) ÷ Σ(병원별 평균 수량) — 수량이 큰 병원이 더 많이 반영된다
 *  - 전체 12주 추이 = 주마다 Σ(병원별 그 주 평균 최대 동시) ÷ Σ(병원별 그 주 평균 수량) — 전체 가동률과 같은 방식
 *  - 수집 범위 = 운영 중인 병원(병원 상태 '운영') 가운데 최근 24시간 안에 수신한 병원. 수량 기준은 그 병원들의 오늘 계약·공급 수량 합
 *  - 측정 활동 = 일별 집계의 신규 측정 수·측정 환자 수를 전 병원 합산 (최근 30일 vs 이전 30일, 오늘 제외)
 *  - 필터(종별 · 병원 지정, 2026-11-26)는 계산에 들어가는 병원 목록만 바꾼다 — 규칙은 같다. 추이 기간은 추이 영역의 범위만 바꾼다
 *    (26주까지 주 단위, 그보다 길면 월 단위). 가동률 · 순위 · 판정은 언제나 최근 30일 대 이전 30일이다
 * 규칙을 바꾸면 '산정기준' 팝업(app/usage/UsageCriteria.tsx)도 함께 고칠 것.
 */
import { prisma } from '@/lib/prisma'
import { usagePool } from './db'
import { DAY_SEC, average, dayLabel, localDayStart, weekStartOf } from './daily'
import { USAGE_DEVICE_KINDS, USAGE_MODELS, loadCapacityByHospital, type UsageModel } from './metrics'
import { OPERATING_HOSPITAL_STATUS } from './agents'
import { DEFAULT_TREND, NO_TYPE_LABEL, TREND_WEEKLY_MAX_WEEKS, sortTypes, type OverviewFilters, type TrendRange } from './filters'
import { getUsageStatsRun, type UsageStatsRun } from './stats'

/** 최근·이전 기간의 길이(일) — 병원별 화면의 기본 기간과 같다 */
export const OVERVIEW_DAYS = 30
/** 증가·감소로 보는 변화 폭(%p) */
export const OVERVIEW_TREND_PP = 5
/** 판정에 필요한 기간별 최소 유효 일수 */
export const OVERVIEW_MIN_VALID_DAYS = 14
export const OVERVIEW_WEEKS = 12
/** 마지막 수신이 이보다 오래되면 '수신 지연' */
export const OVERVIEW_RECEIVE_DELAY_HOURS = 24
const TZ_OFFSET_HOURS = 9

export type OverviewDeviceKey = (typeof USAGE_DEVICE_KINDS)[number]['key']
export type OverviewVerdict = 'up' | 'down' | 'flat' | 'hold'
/** 판정 보류 사유 — pending 집계 전 · no_capacity 계약·공급 수량 없음 · behind 기기 상태 이력 따라잡는 중 · short 유효한 날 부족 */
export type OverviewHold = 'pending' | 'no_capacity' | 'behind' | 'short'

/** 하루치 입력 — date 는 'YYYY-MM-DD' */
export type OverviewDay = { date: string; peak: number | null; capacity: number | null }

export type OverviewStats = {
  /** 최근 30일 가동률(%) — 유효한 날의 일별 동시 가동률 평균 */
  rate: number | null
  /** 유효한 날의 최대 동시사용 수 평균 · 계약·공급 수량 평균 */
  avgPeak: number | null
  avgCapacity: number | null
  validDays: number
  prevRate: number | null
  prevAvgPeak: number | null
  prevAvgCapacity: number | null
  prevValidDays: number
  /** 최근 − 이전 (%p) */
  change: number | null
  verdict: OverviewVerdict
  hold: OverviewHold | null
  /** 가장 최근 날짜의 계약·공급 수량 */
  capacity: number | null
  /** 두 기간 사이에 수량이 바뀌었으면 (처음 → 지금) */
  capacityChange: { from: number; to: number } | null
  /** 주(월~일)별 가동률 평균(+ 그 주의 평균 최대 동시·평균 수량 — 전체 추이 합산용), 오래된 주부터 12개 */
  weeks: { weekStart: string; rate: number | null; avgPeak: number | null; avgCapacity: number | null }[]
}

const dayStartOf = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000

/**
 * 병원 하나의 일별 값 → 기간 평균 · 변화 · 판정 (순수 함수 — scripts/usage-metrics-test.mts 에서 검증)
 * @param today       오늘 자정 (epoch 초, 현지 기준)
 * @param validBefore 이 시각(자정) 전의 날만 유효 — 보통 today, 수신이 끊긴 병원은 마지막 수신일 자정
 * @param behind      기기 상태 이력을 따라잡는 중인가
 */
export function summarizeOverview(days: OverviewDay[], today: number, validBefore: number, behind: boolean = false): OverviewStats {
  const byDay = new Map(days.map((d) => [dayStartOf(d.date), d]))
  const limit = Math.min(validBefore, today)
  const window = (start: number, end: number) => {
    const rates: number[] = []
    const peaks: number[] = []
    const caps: number[] = []
    for (let t = start; t < Math.min(end, limit); t += DAY_SEC) {
      const d = byDay.get(t)
      if (!d || !d.capacity || d.peak === null) continue
      rates.push((d.peak / d.capacity) * 100)
      peaks.push(d.peak)
      caps.push(d.capacity)
    }
    return { rate: average(rates), avgPeak: average(peaks), avgCapacity: average(caps), validDays: rates.length }
  }
  // 최근 = 오늘 포함 30일(병원별 화면과 같은 범위, 오늘은 limit 로 빠진다), 이전 = 그 앞 30일
  const recentStart = today - (OVERVIEW_DAYS - 1) * DAY_SEC
  const prevStart = recentStart - OVERVIEW_DAYS * DAY_SEC
  const recent = window(recentStart, today + DAY_SEC)
  const prev = window(prevStart, recentStart)
  const change = recent.rate !== null && prev.rate !== null ? recent.rate - prev.rate : null

  // 수량: 두 기간(60일) 안에서 처음 나온 값 → 가장 최근 값
  let firstCap: number | null = null
  let lastCap: number | null = null
  for (let t = prevStart; t <= today; t += DAY_SEC) {
    const c = byDay.get(t)?.capacity
    if (!c) continue
    if (firstCap === null) firstCap = c
    lastCap = c
  }

  let hold: OverviewHold | null = null
  if (days.length === 0) hold = 'pending'
  else if (lastCap === null) hold = 'no_capacity'
  else if (behind) hold = 'behind'
  else if (recent.validDays < OVERVIEW_MIN_VALID_DAYS || prev.validDays < OVERVIEW_MIN_VALID_DAYS || change === null) hold = 'short'
  const verdict: OverviewVerdict = hold ? 'hold' : change! >= OVERVIEW_TREND_PP ? 'up' : change! <= -OVERVIEW_TREND_PP ? 'down' : 'flat'

  const thisMonday = weekStartOf(today)
  const weeks: OverviewStats['weeks'] = []
  for (let w = OVERVIEW_WEEKS - 1; w >= 0; w--) {
    const start = thisMonday - w * 7 * DAY_SEC
    const wk = window(start, start + 7 * DAY_SEC)
    weeks.push({ weekStart: dayLabel(start), rate: wk.rate, avgPeak: wk.avgPeak, avgCapacity: wk.avgCapacity })
  }

  return {
    rate: recent.rate,
    avgPeak: recent.avgPeak,
    avgCapacity: recent.avgCapacity,
    validDays: recent.validDays,
    prevRate: prev.rate,
    prevAvgPeak: prev.avgPeak,
    prevAvgCapacity: prev.avgCapacity,
    prevValidDays: prev.validDays,
    change,
    verdict,
    hold,
    capacity: lastCap,
    capacityChange: firstCap !== null && lastCap !== null && firstCap !== lastCap ? { from: firstCap, to: lastCap } : null,
    weeks,
  }
}

export type OverviewTotal = {
  /** 가동률을 낼 수 있는 병원 수 */
  rated: number
  /** Σ 평균 최대 동시 ÷ Σ 평균 수량 (%) */
  rate: number | null
  peakSum: number | null
  /** Σ 현재 수량 */
  capacitySum: number | null
  /** 두 기간 모두 값이 있는 병원끼리 비교한 변화(%p) */
  change: number | null
  up: number
  down: number
  flat: number
  hold: number
}

/** 병원별 결과 → 서비스 전체 한 줄 (순수 함수) */
export function summarizeOverviewTotal(rows: OverviewStats[]): OverviewTotal {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const weighted = (list: OverviewStats[], peak: (r: OverviewStats) => number | null, cap: (r: OverviewStats) => number | null) => {
    const ok = list.filter((r) => peak(r) !== null && !!cap(r))
    if (ok.length === 0) return null
    return (sum(ok.map((r) => peak(r)!)) / sum(ok.map((r) => cap(r)!))) * 100
  }
  const rated = rows.filter((r) => r.rate !== null && r.avgPeak !== null && !!r.avgCapacity)
  const both = rated.filter((r) => r.prevRate !== null && r.prevAvgPeak !== null && !!r.prevAvgCapacity)
  const cur = weighted(both, (r) => r.avgPeak, (r) => r.avgCapacity)
  const prev = weighted(both, (r) => r.prevAvgPeak, (r) => r.prevAvgCapacity)
  const count = (v: OverviewVerdict) => rows.filter((r) => r.verdict === v).length
  return {
    rated: rated.length,
    rate: weighted(rated, (r) => r.avgPeak, (r) => r.avgCapacity),
    peakSum: rated.length > 0 ? sum(rated.map((r) => r.avgPeak!)) : null,
    capacitySum: rated.length > 0 ? sum(rated.map((r) => r.capacity ?? r.avgCapacity!)) : null,
    change: cur !== null && prev !== null ? cur - prev : null,
    up: count('up'),
    down: count('down'),
    flat: count('flat'),
    hold: count('hold'),
  }
}

/** 서비스 전체의 주별 가동률 — 그 주에 값이 있는 병원끼리 Σ 평균 최대 동시 ÷ Σ 평균 수량 */
export type OverviewTrendWeek = { weekStart: string; rate: number | null; hospitals: number }

/** 병원별 결과 → 전체 12주 추이 (순수 함수) */
export function summarizeOverviewTrend(rows: OverviewStats[]): OverviewTrendWeek[] {
  const n = rows.reduce((a, r) => Math.max(a, r.weeks.length), 0)
  const out: OverviewTrendWeek[] = []
  for (let i = 0; i < n; i++) {
    let peak = 0
    let cap = 0
    let hospitals = 0
    let weekStart = ''
    for (const r of rows) {
      const w = r.weeks[i]
      if (!w) continue
      weekStart = w.weekStart
      if (w.avgPeak === null || !w.avgCapacity) continue
      peak += w.avgPeak
      cap += w.avgCapacity
      hospitals++
    }
    out.push({ weekStart, rate: cap > 0 ? (peak / cap) * 100 : null, hospitals })
  }
  return out
}

/** 추이의 한 구간 — [start, end) (epoch 초, 현지 자정 기준). label 은 주의 월요일 'MM-DD' 또는 달 'YYYY-MM' */
export type TrendBucket = { start: number; end: number; label: string }
export type TrendPlan = { unit: 'week' | 'month'; from: number; to: number; buckets: TrendBucket[] }

/**
 * 추이 기간 → 구간 목록 (순수 함수).
 *  - N주: 이번 주 월요일에서 N−1주 전부터 오늘까지. 전체: 집계 첫 날부터. 직접 지정: from ~ to (집계 첫 날 · 오늘을 넘지 않게)
 *  - 길이가 26주 이하면 주(월~일) 단위, 그보다 길면 달 단위. 범위에 일부만 걸친 첫 · 마지막 구간은 걸친 날만 센다
 * @param firstDay 일별 집계가 있는 첫 날 자정 (없으면 null — 그때 '전체'는 12주와 같다)
 */
export function planTrend(trend: TrendRange, today: number, firstDay: number | null): TrendPlan {
  const thisMonday = weekStartOf(today)
  const end = today + DAY_SEC
  let from: number
  let to = end
  if (trend.kind === 'weeks') from = thisMonday - (trend.weeks - 1) * 7 * DAY_SEC
  else if (trend.kind === 'all') from = firstDay ?? thisMonday - (OVERVIEW_WEEKS - 1) * 7 * DAY_SEC
  else {
    from = dayStartOf(trend.from)
    to = Math.min(dayStartOf(trend.to) + DAY_SEC, end)
    if (firstDay !== null && from < firstDay) from = firstDay
  }
  const buckets: TrendBucket[] = []
  if (from >= to) return { unit: 'week', from, to, buckets }
  const unit: TrendPlan['unit'] = (to - from) / DAY_SEC <= TREND_WEEKLY_MAX_WEEKS * 7 ? 'week' : 'month'
  if (unit === 'week') {
    for (let ws = weekStartOf(from); ws < to; ws += 7 * DAY_SEC) {
      buckets.push({ start: Math.max(ws, from), end: Math.min(ws + 7 * DAY_SEC, to), label: dayLabel(ws).slice(5) })
    }
  } else {
    const d = new Date(from * 1000)
    let y = d.getUTCFullYear()
    let m = d.getUTCMonth()
    for (;;) {
      const ms = Date.UTC(y, m, 1) / 1000
      if (ms >= to) break
      const next = Date.UTC(y, m + 1, 1) / 1000
      buckets.push({ start: Math.max(ms, from), end: Math.min(next, to), label: `${y}-${String(m + 1).padStart(2, '0')}` })
      m += 1
      if (m === 12) {
        m = 0
        y += 1
      }
    }
  }
  return { unit, from, to, buckets }
}

export type OverviewTrendPoint = { start: string; label: string; rate: number | null; hospitals: number }
/** 전체 가동률의 추이 — 고른 기간, 주 또는 달 단위 */
export type OverviewTrend = { unit: 'week' | 'month'; from: string; to: string; points: OverviewTrendPoint[] }

/**
 * 병원별 일별 값 → 구간별 전체 가동률 (순수 함수). 구간마다 그 구간에 유효한 날이 있는 병원끼리
 * Σ(병원별 평균 최대 동시) ÷ Σ(병원별 평균 수량) — summarizeOverviewTrend 와 같은 규칙을 임의의 구간에 적용한 것이다.
 * 유효한 날의 조건도 summarizeOverview 와 같다(수량과 수치가 있고, 오늘이 아니고, 수신이 끊긴 병원은 validBefore 전).
 */
export function summarizeOverviewBuckets(hospitals: { days: OverviewDay[]; validBefore: number }[], today: number, buckets: TrendBucket[]): OverviewTrendPoint[] {
  const maps = hospitals.map((h) => ({ byDay: new Map(h.days.map((d) => [dayStartOf(d.date), d])), limit: Math.min(h.validBefore, today) }))
  return buckets.map((b) => {
    let peak = 0
    let cap = 0
    let n = 0
    for (const h of maps) {
      let ps = 0
      let cs = 0
      let k = 0
      for (let t = b.start; t < Math.min(b.end, h.limit); t += DAY_SEC) {
        const d = h.byDay.get(t)
        if (!d || !d.capacity || d.peak === null) continue
        ps += d.peak
        cs += d.capacity
        k++
      }
      if (k === 0) continue
      peak += ps / k
      cap += cs / k
      n++
    }
    return { start: dayLabel(b.start), label: b.label, rate: cap > 0 ? (peak / cap) * 100 : null, hospitals: n }
  })
}

/** 수집 범위 — 운영 중인 병원 가운데 얼마나 수집하고 있는가 */
export type OverviewCoverage = {
  /** 운영 중인 병원 수(병원 상태 '운영') · 그중 최근 24시간 안에 수신한 병원 수 */
  operating: number
  collecting: number
  /** 수집 서버가 등록된 병원 수(운영 상태가 아닌 병원 포함 — 표의 행 수) */
  registered: number
  /** 수신이 24시간 넘게 끊긴 병원 수 · 등록한 서버 중 일부만 수집 중인 병원 수 */
  delayed: number
  partial: number
  /** 고른 기기·판매모델의 오늘 계약·공급 수량 — 운영 병원 전체 / 그중 수집 중인 병원 (수량이 하나도 없으면 null) */
  capacityOperating: number | null
  capacityCollecting: number | null
}

/** 측정 활동 — 전 병원 합산 (오늘 제외) */
export type OverviewActivity = {
  /** 최근 30일 · 이전 30일의 신규 측정 수 합, 증감률(%) */
  started: number
  prevStarted: number
  startedChange: number | null
  /** 최근 30일 하루 평균 측정 환자 수(전 병원 합) */
  avgMeasured: number | null
  /** 최근 30일 일별 값 (오늘 제외) */
  days: { date: string; started: number; measured: number }[]
}

/** 일별 합계 → 측정 활동 (순수 함수). days 는 날짜별 전 병원 합 */
export function summarizeOverviewActivity(days: { date: string; started: number; measured: number }[], today: number): OverviewActivity {
  const recentStart = today - (OVERVIEW_DAYS - 1) * DAY_SEC
  const prevStart = recentStart - OVERVIEW_DAYS * DAY_SEC
  const recent = days.filter((d) => dayStartOf(d.date) >= recentStart && dayStartOf(d.date) < today).sort((a, b) => a.date.localeCompare(b.date))
  const prev = days.filter((d) => dayStartOf(d.date) >= prevStart && dayStartOf(d.date) < recentStart)
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const started = sum(recent.map((d) => d.started))
  const prevStarted = sum(prev.map((d) => d.started))
  return {
    started,
    prevStarted,
    startedChange: prevStarted > 0 && prev.length > 0 && recent.length > 0 ? ((started - prevStarted) / prevStarted) * 100 : null,
    avgMeasured: average(recent.map((d) => d.measured)),
    days: recent,
  }
}

export type OverviewRow = OverviewStats & {
  hospitalCode: string
  hospitalName: string
  /** 종별 (병원 정보의 종별 — 비어 있으면 '종별 없음') */
  hospitalType: string
  /**
   * servers = 차단되지 않은 서버 수, collecting = 그중 최근 24시간 안에 수신한 서버 수,
   * expected = 에이전트 관리에 등록한 서버 대수(등록 없으면 null). collecting < expected 면 일부 서버만 수집 중
   */
  receive: { servers: number; expected: number | null; collecting: number; lastSuccessAt: string | null; delayed: boolean; behind: boolean }
}

export type UsageOverview = {
  device: OverviewDeviceKey
  model: UsageModel
  today: string
  /** 최근·이전 기간의 날짜 범위 (끝 포함) */
  recent: { from: string; to: string }
  prev: { from: string; to: string }
  thresholds: { trendPp: number; minValidDays: number; receiveDelayHours: number }
  /** 마지막 집계 실행 (한 번도 돌지 않았으면 null) */
  run: UsageStatsRun | null
  total: OverviewTotal
  /** 같은 기기의 판매모델별 전체 한 줄 (합산·일반형·사용량비례형) — total 은 byModel[model] 과 같다 */
  byModel: Record<UsageModel, OverviewTotal>
  /** 종별별 전체 한 줄 — 병원 지정 안에서, 종별 필터와 무관하게 전부(비교용). 고른 종별은 filters.types */
  byType: { type: string; hospitals: number; total: OverviewTotal }[]
  /** 전체 가동률의 추이 — 고른 기간 (기본 12주, 오래된 구간부터) */
  trend: OverviewTrend
  coverage: OverviewCoverage
  activity: OverviewActivity
  /** 적용된 필터 */
  filters: OverviewFilters
  /** 고를 수 있는 값 — 종별(수집 중인 병원 기준 병원 수) · 일별 집계가 있는 첫 날 */
  options: { types: { type: string; count: number }[]; firstDate: string | null }
  rows: OverviewRow[]
}

export function isOverviewDevice(v: string | null): v is OverviewDeviceKey {
  return USAGE_DEVICE_KINDS.some((k) => k.key === v)
}
export function isUsageModel(v: string | null): v is UsageModel {
  return USAGE_MODELS.some((m) => m.key === v)
}

/**
 * 수집 중인 병원의 가동률 — 일별 집계(본체 DB)와 수신 상태(원본 DB)를 읽는다.
 * filters 로 병원을 좁히면(종별 · 병원 지정) 모든 값이 그 병원들만으로 계산된다.
 */
export async function getUsageOverview(
  device: OverviewDeviceKey,
  model: UsageModel,
  filters: OverviewFilters = { types: [], hospitals: [], trend: DEFAULT_TREND },
  nowMs: number = Date.now(),
): Promise<UsageOverview> {
  const today = localDayStart(nowMs, TZ_OFFSET_HOURS)
  const recentStart = today - (OVERVIEW_DAYS - 1) * DAY_SEC
  const prevStart = recentStart - OVERVIEW_DAYS * DAY_SEC
  const firstNeeded = Math.min(prevStart, weekStartOf(today) - (OVERVIEW_WEEKS - 1) * 7 * DAY_SEC)
  const deviceType = USAGE_DEVICE_KINDS.find((k) => k.key === device)!.type
  const pickedHospitals = filters.hospitals.length > 0 ? new Set(filters.hospitals) : null
  const pickedTypes = filters.types.length > 0 ? new Set(filters.types) : null

  const [servers, run, operatingRows, capacityNow, firstStat] = await Promise.all([
    usagePool().query(
      `SELECT s.hospital_code, count(*) FILTER (WHERE s.blocked_at IS NULL)::int AS servers, max(s.last_success_at) AS last_success_at,
              count(*) FILTER (WHERE s.blocked_at IS NULL AND s.last_success_at > now() - make_interval(hours => $1))::int AS collecting,
              (SELECT e.expected_servers FROM agent_enrollments e WHERE e.hospital_code = s.hospital_code) AS expected,
              bool_or(COALESCE((r.stats->>'status_behind')::boolean, false)) AS behind
         FROM agent_servers s
         LEFT JOIN LATERAL (SELECT stats FROM agent_runs WHERE server = s.id AND status = 'ok' ORDER BY id DESC LIMIT 1) r ON true
        GROUP BY s.hospital_code`,
      [OVERVIEW_RECEIVE_DELAY_HOURS],
    ),
    getUsageStatsRun(),
    prisma.hospital.findMany({ where: { status: OPERATING_HOSPITAL_STATUS }, select: { hospitalCode: true, type: true } }),
    loadCapacityByHospital(deviceType, model, dayLabel(today)),
    prisma.usageDailyDeviceStat.aggregate({ _min: { date: true } }),
  ])
  const codes = servers.rows.map((r) => r.hospital_code as string)
  const meta = await prisma.hospital.findMany({ where: { hospitalCode: { in: codes } }, select: { hospitalCode: true, hospitalName: true, type: true } })
  const nameOf = new Map(meta.map((n) => [n.hospitalCode, n.hospitalName]))
  const typeLabel = (t: string | null | undefined) => (t && t.trim() ? t.trim() : NO_TYPE_LABEL)
  const typeOf = new Map(meta.map((n) => [n.hospitalCode, typeLabel(n.type)]))
  const typeOfCode = (code: string) => typeOf.get(code) ?? NO_TYPE_LABEL

  // 고를 수 있는 종별 — 수집 중인 병원 전체 기준 (필터와 무관)
  const typeCounts = new Map<string, number>()
  for (const c of codes) typeCounts.set(typeOfCode(c), (typeCounts.get(typeOfCode(c)) ?? 0) + 1)
  const firstDay = firstStat._min.date ? firstStat._min.date.getTime() / 1000 : null

  // 대상 병원: 병원 지정(scope) → 종별(selected). 종별 비교(byType)는 scope 전체로 낸다
  const scopeServers = servers.rows.filter((r) => !pickedHospitals || pickedHospitals.has(r.hospital_code as string))
  const inTypes = (code: string) => !pickedTypes || pickedTypes.has(typeOfCode(code))
  const scopeCodes = scopeServers.map((r) => r.hospital_code as string)

  // 추이 범위가 기본 창(이전 30일 · 12주)보다 앞에서 시작하면 고른 판매모델만 그만큼 더 읽는다
  const plan = planTrend(filters.trend, today, firstDay)
  const loadFrom = Math.min(firstNeeded, plan.buckets.length > 0 ? plan.from : firstNeeded)
  const [stats, activityRows] = await Promise.all([
    prisma.usageDailyDeviceStat.findMany({
      where: {
        deviceType,
        ...(pickedHospitals ? { hospitalCode: { in: scopeCodes } } : {}),
        OR: [{ date: { gte: new Date(firstNeeded * 1000) } }, { model, date: { gte: new Date(loadFrom * 1000) } }],
      },
      select: { hospitalCode: true, date: true, model: true, peak: true, capacity: true },
      orderBy: { date: 'asc' },
    }),
    prisma.usageDailyStat.groupBy({
      by: ['date'],
      where: {
        model,
        date: { gte: new Date(prevStart * 1000), lt: new Date(today * 1000) },
        ...(pickedHospitals || pickedTypes ? { hospitalCode: { in: scopeCodes.filter(inTypes) } } : {}),
      },
      _sum: { started: true, measured: true },
    }),
  ])
  const daysOf = new Map<string, OverviewDay[]>() // `${판매모델}|${병원코드}` → 일별 값
  for (const s of stats) {
    const k = `${s.model}|${s.hospitalCode}`
    const list = daysOf.get(k) ?? []
    list.push({ date: s.date.toISOString().slice(0, 10), peak: s.peak, capacity: s.capacity })
    daysOf.set(k, list)
  }

  const validBeforeOf = new Map<string, number>()
  const rowsFor = (m: UsageModel): OverviewRow[] => scopeServers.map((r) => {
    const code = r.hospital_code as string
    const last = r.last_success_at ? new Date(r.last_success_at) : null
    const delayed = !last || nowMs - last.getTime() > OVERVIEW_RECEIVE_DELAY_HOURS * 3600 * 1000
    // 수신이 끊긴 병원: 마지막 수신일은 하루가 다 들어오지 않았으므로 그 전날까지만 유효
    const validBefore = !delayed ? today : last ? localDayStart(last.getTime(), TZ_OFFSET_HOURS) : 0
    validBeforeOf.set(code, validBefore)
    return {
      hospitalCode: code,
      hospitalName: nameOf.get(code) ?? code,
      hospitalType: typeOfCode(code),
      receive: {
        servers: Number(r.servers),
        expected: r.expected === null ? null : Number(r.expected),
        collecting: Number(r.collecting),
        lastSuccessAt: last ? last.toISOString() : null,
        delayed,
        behind: !!r.behind,
      },
      ...summarizeOverview(daysOf.get(`${m}|${code}`) ?? [], today, validBefore, !!r.behind),
    }
  })
  const scopeRows = rowsFor(model) // 병원 지정까지만 적용 — 종별 비교용
  const rows = scopeRows.filter((r) => inTypes(r.hospitalCode))
  // 기본 순서: 가동률 높은 순, 값이 없는 병원은 아래로 (이름순)
  rows.sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.hospitalName.localeCompare(b.hospitalName, 'ko'))
  const total = summarizeOverviewTotal(rows)
  const byModel = Object.fromEntries(
    USAGE_MODELS.map((x) => [x.key, x.key === model ? total : summarizeOverviewTotal(rowsFor(x.key).filter((r) => inTypes(r.hospitalCode)))]),
  ) as Record<UsageModel, OverviewTotal>
  const byTypeMap = new Map<string, OverviewRow[]>()
  for (const r of scopeRows) byTypeMap.set(r.hospitalType, [...(byTypeMap.get(r.hospitalType) ?? []), r])
  const byType = sortTypes(Array.from(byTypeMap.entries()).map(([type, list]) => ({ type, hospitals: list.length, total: summarizeOverviewTotal(list) })))

  // 수집 범위: 같은 조건의 운영 병원 가운데 최근 24시간 안에 수신한 병원 (병원 수 · 계약·공급 수량)
  const operating = new Set(
    operatingRows.filter((h) => (!pickedHospitals || pickedHospitals.has(h.hospitalCode)) && (!pickedTypes || pickedTypes.has(typeLabel(h.type)))).map((h) => h.hospitalCode),
  )
  const collectingCodes = new Set(rows.filter((r) => r.receive.collecting > 0).map((r) => r.hospitalCode))
  let capacityOperating = 0
  let capacityCollecting = 0
  for (const [code, qty] of Array.from(capacityNow.entries())) {
    if (!operating.has(code)) continue
    capacityOperating += qty
    if (collectingCodes.has(code)) capacityCollecting += qty
  }
  const coverage: OverviewCoverage = {
    operating: operating.size,
    collecting: Array.from(collectingCodes).filter((c) => operating.has(c)).length,
    registered: rows.length,
    delayed: rows.filter((r) => r.receive.delayed).length,
    partial: rows.filter((r) => r.receive.expected !== null && r.receive.collecting < r.receive.expected).length,
    capacityOperating: capacityOperating > 0 ? capacityOperating : null,
    capacityCollecting: capacityOperating > 0 ? capacityCollecting : null,
  }
  const activity = summarizeOverviewActivity(
    activityRows.map((a) => ({ date: a.date.toISOString().slice(0, 10), started: a._sum.started ?? 0, measured: a._sum.measured ?? 0 })),
    today,
  )
  const trend: OverviewTrend = {
    unit: plan.unit,
    from: dayLabel(plan.from),
    to: dayLabel(Math.max(plan.from, plan.to - DAY_SEC)),
    points: summarizeOverviewBuckets(
      rows.map((r) => ({ days: daysOf.get(`${model}|${r.hospitalCode}`) ?? [], validBefore: validBeforeOf.get(r.hospitalCode) ?? today })),
      today,
      plan.buckets,
    ),
  }

  return {
    device,
    model,
    today: dayLabel(today),
    recent: { from: dayLabel(recentStart), to: dayLabel(today) },
    prev: { from: dayLabel(prevStart), to: dayLabel(recentStart - DAY_SEC) },
    thresholds: { trendPp: OVERVIEW_TREND_PP, minValidDays: OVERVIEW_MIN_VALID_DAYS, receiveDelayHours: OVERVIEW_RECEIVE_DELAY_HOURS },
    run,
    total,
    byModel,
    byType,
    trend,
    coverage,
    activity,
    filters: { types: filters.types, hospitals: filters.hospitals, trend: filters.trend },
    options: {
      types: sortTypes(Array.from(typeCounts.entries()).map(([type, count]) => ({ type, count }))),
      firstDate: firstDay === null ? null : dayLabel(firstDay),
    },
    rows,
  }
}
