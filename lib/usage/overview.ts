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
 * 규칙을 바꾸면 '산정기준' 팝업(app/usage/UsageCriteria.tsx)도 함께 고칠 것.
 */
import { prisma } from '@/lib/prisma'
import { usagePool } from './db'
import { DAY_SEC, average, dayLabel, localDayStart, weekStartOf } from './daily'
import { USAGE_DEVICE_KINDS, USAGE_MODELS, type UsageModel } from './metrics'
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
  /** 주(월~일)별 가동률 평균, 오래된 주부터 12개 */
  weeks: { weekStart: string; rate: number | null }[]
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
    weeks.push({ weekStart: dayLabel(start), rate: window(start, start + 7 * DAY_SEC).rate })
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

export type OverviewRow = OverviewStats & {
  hospitalCode: string
  hospitalName: string
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
  rows: OverviewRow[]
}

export function isOverviewDevice(v: string | null): v is OverviewDeviceKey {
  return USAGE_DEVICE_KINDS.some((k) => k.key === v)
}
export function isUsageModel(v: string | null): v is UsageModel {
  return USAGE_MODELS.some((m) => m.key === v)
}

/** 수집 중인 병원 전체의 가동률 — 일별 집계(본체 DB)와 수신 상태(원본 DB)를 읽는다 */
export async function getUsageOverview(device: OverviewDeviceKey, model: UsageModel, nowMs: number = Date.now()): Promise<UsageOverview> {
  const today = localDayStart(nowMs, TZ_OFFSET_HOURS)
  const recentStart = today - (OVERVIEW_DAYS - 1) * DAY_SEC
  const prevStart = recentStart - OVERVIEW_DAYS * DAY_SEC
  const firstNeeded = Math.min(prevStart, weekStartOf(today) - (OVERVIEW_WEEKS - 1) * 7 * DAY_SEC)
  const deviceType = USAGE_DEVICE_KINDS.find((k) => k.key === device)!.type

  const [servers, stats, run] = await Promise.all([
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
    prisma.usageDailyDeviceStat.findMany({
      where: { model, deviceType, date: { gte: new Date(firstNeeded * 1000) } },
      select: { hospitalCode: true, date: true, peak: true, capacity: true },
      orderBy: { date: 'asc' },
    }),
    getUsageStatsRun(),
  ])
  const codes = servers.rows.map((r) => r.hospital_code as string)
  const names = await prisma.hospital.findMany({ where: { hospitalCode: { in: codes } }, select: { hospitalCode: true, hospitalName: true } })
  const nameOf = new Map(names.map((n) => [n.hospitalCode, n.hospitalName]))
  const daysOf = new Map<string, OverviewDay[]>()
  for (const s of stats) {
    const list = daysOf.get(s.hospitalCode) ?? []
    list.push({ date: s.date.toISOString().slice(0, 10), peak: s.peak, capacity: s.capacity })
    daysOf.set(s.hospitalCode, list)
  }

  const rows: OverviewRow[] = servers.rows.map((r) => {
    const code = r.hospital_code as string
    const last = r.last_success_at ? new Date(r.last_success_at) : null
    const delayed = !last || nowMs - last.getTime() > OVERVIEW_RECEIVE_DELAY_HOURS * 3600 * 1000
    // 수신이 끊긴 병원: 마지막 수신일은 하루가 다 들어오지 않았으므로 그 전날까지만 유효
    const validBefore = !delayed ? today : last ? localDayStart(last.getTime(), TZ_OFFSET_HOURS) : 0
    return {
      hospitalCode: code,
      hospitalName: nameOf.get(code) ?? code,
      receive: {
        servers: Number(r.servers),
        expected: r.expected === null ? null : Number(r.expected),
        collecting: Number(r.collecting),
        lastSuccessAt: last ? last.toISOString() : null,
        delayed,
        behind: !!r.behind,
      },
      ...summarizeOverview(daysOf.get(code) ?? [], today, validBefore, !!r.behind),
    }
  })
  // 기본 순서: 가동률 높은 순, 값이 없는 병원은 아래로 (이름순)
  rows.sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.hospitalName.localeCompare(b.hospitalName, 'ko'))

  return {
    device,
    model,
    today: dayLabel(today),
    recent: { from: dayLabel(recentStart), to: dayLabel(today) },
    prev: { from: dayLabel(prevStart), to: dayLabel(recentStart - DAY_SEC) },
    thresholds: { trendPp: OVERVIEW_TREND_PP, minValidDays: OVERVIEW_MIN_VALID_DAYS, receiveDelayHours: OVERVIEW_RECEIVE_DELAY_HOURS },
    run,
    total: summarizeOverviewTotal(rows),
    rows,
  }
}
