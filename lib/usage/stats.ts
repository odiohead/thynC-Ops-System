/**
 * 사용량 일별 집계 저장 — 전체 병원 화면용 (projects/usage_overview_design.md §5)
 *
 * 병원별 화면(/usage?hospital=)은 열 때마다 원본에서 계산한다. 전체 병원 화면은 병원 수만큼 그 계산을 할 수 없으므로,
 * 같은 계산(lib/usage/metrics.ts)의 일별 값을 본체 DB 표 2개에 저장해 두고 읽는다.
 *   usage_daily_stats         병원 × 날짜 × 판매모델           측정 환자 수 · 신규 측정 수 · 최대 동시측정 수
 *   usage_daily_device_stats  병원 × 날짜 × 판매모델 × 기기 종류   사용 횟수 · 최대 동시사용 수 · 그날의 계약·공급 수량
 *
 * 갱신은 두 가지다 (2026-11-26 — 병원 188곳에서 91일 전체를 매시간 다시 계산하는 데 14분이 걸려 나눔):
 *   recent  매 주기(기본 1시간) — 최근 USAGE_STATS_RECENT_DAYS 일만 다시 계산해 덮어쓴다. Agent 가 매시간 보내는 것은 진행 중인 측정과
 *           최근 2일 안에 바뀐 측정이므로, 평소에 값이 달라지는 날은 오늘과 그 앞 이틀이다.
 *   full    하루 한 번(새벽 3시 이후 첫 주기) — 최근 USAGE_STATS_DAYS 일을 통째로 다시 계산한다. 늦게 들어오는 데이터(상태 이력
 *           따라잡기·하루 1회 대조), 딜 수정으로 바뀌는 분모, 산정 기준 변경이 과거 값을 바꾸기 때문이다. 그보다 오래된 행은 그대로 둔다.
 * 그날의 값은 어느 쪽으로 계산해도 같다(계산은 그날에 걸친 측정만 본다). 저장된 행이 아직 없는 병원(새로 수집을 시작한 병원)은
 * recent 주기에서도 전체를 채운다.
 * 원본 DB 에는 쓰지 않는다(본체는 원본 DB 조회 전용 — CLAUDE.md 규칙 9). 주기 실행은 lib/usage/stats-scheduler.ts.
 */
import { prisma } from '@/lib/prisma'
import { USAGE_MODELS, getUsageDailyAllModels, listUsageHospitals } from './metrics'

/** 다시 계산하는 범위(일) — 12주 추이(이번 주 월요일 − 11주 ~ 오늘, 최대 84일)와 이전 30일 비교(60일)를 덮는다 */
export const USAGE_STATS_DAYS = 91

/** 매 주기에 다시 계산하는 범위(일) — 오늘 + 그 앞 이틀 (Agent 의 측정 변동분 기준 '최근 2일'과 맞춘다) */
export const USAGE_STATS_RECENT_DAYS = 3
/** 하루 한 번의 전체 집계가 시작되는 시각(현지 시) — 이 시각 이후 첫 주기에 돈다 */
export const USAGE_STATS_FULL_HOUR = 3
const TZ_OFFSET_HOURS = 9

/** 마지막 집계 실행 기록 (app_settings 한 행, JSON) — 종류와 무관하게 가장 최근 실행 */
export const USAGE_STATS_RUN_KEY = 'usage_stats_last_run'
/** 마지막 전체(full) 집계 실행 기록 */
export const USAGE_STATS_FULL_KEY = 'usage_stats_last_full'

export type UsageStatsMode = 'full' | 'recent'

export type UsageStatsRun = {
  /** 전체(91일) / 최근(3일). 2026-11-26 이전 기록에는 없다(= 전체) */
  mode?: UsageStatsMode
  startedAt: string
  finishedAt: string
  ms: number
  /** 집계한 병원 수 (실패 포함) */
  hospitals: number
  failed: { hospitalCode: string; error: string }[]
  /** 원본 DB 에 없는 병원이라 지운 행 수 */
  removed: number
}

const dateOf = (label: string) => new Date(`${label}T00:00:00.000Z`)

/**
 * 이번 주기에 무엇을 돌릴까 (순수 함수 — scripts/usage-metrics-test.mts 에서 검증).
 * 전체 집계를 한 번도 하지 않았거나, 마지막 전체 집계가 가장 최근의 '새벽 3시'(현지)보다 앞이면 full, 아니면 recent.
 * 즉 날마다 3시 이후 첫 주기가 full 이다. 그 시간에 앱이 내려가 있었다면 다시 뜬 뒤 첫 주기가 full 이 된다.
 */
export function statsRunMode(nowMs: number, lastFullStartedMs: number | null): UsageStatsMode {
  if (lastFullStartedMs === null) return 'full'
  const local = nowMs + TZ_OFFSET_HOURS * 3600_000
  const dayStart = Math.floor(local / 86_400_000) * 86_400_000
  let boundary = dayStart + USAGE_STATS_FULL_HOUR * 3600_000
  if (boundary > local) boundary -= 86_400_000
  return lastFullStartedMs + TZ_OFFSET_HOURS * 3600_000 < boundary ? 'full' : 'recent'
}

/** 병원 하나의 최근 days 일(기본 USAGE_STATS_DAYS)을 다시 계산해 덮어쓴다 (판매모델 3종). 그 범위 밖의 행은 건드리지 않는다 */
export async function rebuildUsageStats(hospitalCode: string, nowMs: number = Date.now(), days: number = USAGE_STATS_DAYS): Promise<{ days: number; from: string; to: string }> {
  const byModel = await getUsageDailyAllModels(hospitalCode, days, nowMs, { batch: true })
  const { from, to } = byModel.all.range
  const stats: { hospitalCode: string; date: Date; model: string; measured: number; started: number; peak: number }[] = []
  const devices: { hospitalCode: string; date: Date; model: string; deviceType: number; uses: number | null; peak: number | null; capacity: number | null }[] = []
  for (const m of USAGE_MODELS) {
    const daily = byModel[m.key]
    for (const r of daily.days) stats.push({ hospitalCode, date: dateOf(r.date), model: m.key, measured: r.measured, started: r.started, peak: r.peak })
    for (const dv of daily.devices) {
      for (const r of dv.days) devices.push({ hospitalCode, date: dateOf(r.date), model: m.key, deviceType: dv.type, uses: r.uses, peak: r.peak, capacity: r.capacity })
    }
  }
  const range = { gte: dateOf(from), lte: dateOf(to) }
  await prisma.$transaction([
    prisma.usageDailyStat.deleteMany({ where: { hospitalCode, date: range } }),
    prisma.usageDailyDeviceStat.deleteMany({ where: { hospitalCode, date: range } }),
    prisma.usageDailyStat.createMany({ data: stats }),
    prisma.usageDailyDeviceStat.createMany({ data: devices }),
  ])
  return { days: byModel.all.days.length, from, to }
}

/**
 * 수집 중인 병원 전체를 하나씩 다시 계산한다. 한 병원이 실패해도 나머지는 계속하고, 실패는 실행 기록에 남긴다.
 * 원본 DB 에 없는 병원의 행은 지운다(개발 환경으로 운영 데이터를 동기화한 직후 등).
 * mode recent 는 최근 USAGE_STATS_RECENT_DAYS 일만 — 단, 그보다 앞선 날의 행이 하나도 없는 병원(새로 수집을 시작한 병원)은 전체를 채운다.
 */
export async function rebuildAllUsageStats(nowMs: number = Date.now(), mode: UsageStatsMode = 'full'): Promise<UsageStatsRun> {
  const started = Date.now()
  const hospitals = await listUsageHospitals()
  const failed: UsageStatsRun['failed'] = []
  let seeded = new Set<string>()
  if (mode === 'recent') {
    // 오늘에서 RECENT_DAYS 일 이전의 행이 있는 병원 = 이미 전체가 채워진 병원
    const before = new Date(nowMs + TZ_OFFSET_HOURS * 3600_000)
    before.setUTCHours(0, 0, 0, 0)
    before.setUTCDate(before.getUTCDate() - USAGE_STATS_RECENT_DAYS)
    const rows = await prisma.usageDailyStat.groupBy({ by: ['hospitalCode'], where: { date: { lt: before } } })
    seeded = new Set(rows.map((r) => r.hospitalCode))
  }
  for (const h of hospitals) {
    try {
      await rebuildUsageStats(h.hospitalCode, nowMs, mode === 'recent' && seeded.has(h.hospitalCode) ? USAGE_STATS_RECENT_DAYS : USAGE_STATS_DAYS)
    } catch (e) {
      failed.push({ hospitalCode: h.hospitalCode, error: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300) })
    }
  }
  const codes = hospitals.map((h) => h.hospitalCode)
  const [a, b] = await prisma.$transaction([
    prisma.usageDailyStat.deleteMany({ where: { hospitalCode: { notIn: codes } } }),
    prisma.usageDailyDeviceStat.deleteMany({ where: { hospitalCode: { notIn: codes } } }),
  ])
  const run: UsageStatsRun = {
    mode,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    ms: Date.now() - started,
    hospitals: hospitals.length,
    failed,
    removed: a.count + b.count,
  }
  const value = JSON.stringify(run)
  const keys = mode === 'full' ? [USAGE_STATS_RUN_KEY, USAGE_STATS_FULL_KEY] : [USAGE_STATS_RUN_KEY]
  for (const key of keys) await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
  return run
}

async function readRun(key: string): Promise<UsageStatsRun | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } })
  if (!row?.value) return null
  try {
    return JSON.parse(row.value) as UsageStatsRun
  } catch {
    return null
  }
}

/** 가장 최근 집계 실행 (전체·최근 무관) — 화면의 '집계 시각' */
export async function getUsageStatsRun(): Promise<UsageStatsRun | null> {
  return readRun(USAGE_STATS_RUN_KEY)
}

/**
 * 마지막 전체 집계 실행. 전체 기록이 따로 없으면(2026-11-26 이전에 남긴 기록뿐이면) 가장 최근 실행이 전체였는지 본다 —
 * 그때는 모든 실행이 전체였다(mode 없음).
 */
export async function getUsageStatsFullRun(): Promise<UsageStatsRun | null> {
  const full = await readRun(USAGE_STATS_FULL_KEY)
  if (full) return full
  const last = await readRun(USAGE_STATS_RUN_KEY)
  return last && (last.mode === undefined || last.mode === 'full') ? last : null
}
