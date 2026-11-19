/**
 * 사용량 일별 집계 저장 — 전체 병원 화면용 (projects/usage_overview_design.md §5)
 *
 * 병원별 화면(/usage?hospital=)은 열 때마다 원본에서 계산한다. 전체 병원 화면은 병원 수만큼 그 계산을 할 수 없으므로,
 * 같은 계산(lib/usage/metrics.ts)의 일별 값을 본체 DB 표 2개에 저장해 두고 읽는다.
 *   usage_daily_stats         병원 × 날짜 × 판매모델           측정 환자 수 · 신규 측정 수 · 최대 동시측정 수
 *   usage_daily_device_stats  병원 × 날짜 × 판매모델 × 기기 종류   사용 횟수 · 최대 동시사용 수 · 그날의 계약·공급 수량
 *
 * 갱신은 최근 USAGE_STATS_DAYS 일을 통째로 다시 계산해 덮어쓴다 — 늦게 들어오는 데이터(상태 이력 따라잡기·하루 1회 대조),
 * 딜 수정으로 바뀌는 분모, 산정 기준 변경이 과거 값을 바꾸기 때문이다. 그보다 오래된 행은 그대로 둔다.
 * 원본 DB 에는 쓰지 않는다(본체는 원본 DB 조회 전용 — CLAUDE.md 규칙 9). 주기 실행은 lib/usage/stats-scheduler.ts.
 */
import { prisma } from '@/lib/prisma'
import { USAGE_MODELS, getUsageDailyAllModels, listUsageHospitals } from './metrics'

/** 다시 계산하는 범위(일) — 12주 추이(이번 주 월요일 − 11주 ~ 오늘, 최대 84일)와 이전 30일 비교(60일)를 덮는다 */
export const USAGE_STATS_DAYS = 91

/** 마지막 집계 실행 기록 (app_settings 한 행, JSON) */
export const USAGE_STATS_RUN_KEY = 'usage_stats_last_run'

export type UsageStatsRun = {
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

/** 병원 하나의 최근 USAGE_STATS_DAYS 일을 다시 계산해 덮어쓴다 (판매모델 3종) */
export async function rebuildUsageStats(hospitalCode: string, nowMs: number = Date.now()): Promise<{ days: number; from: string; to: string }> {
  const byModel = await getUsageDailyAllModels(hospitalCode, USAGE_STATS_DAYS, nowMs)
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
 */
export async function rebuildAllUsageStats(nowMs: number = Date.now()): Promise<UsageStatsRun> {
  const started = Date.now()
  const hospitals = await listUsageHospitals()
  const failed: UsageStatsRun['failed'] = []
  for (const h of hospitals) {
    try {
      await rebuildUsageStats(h.hospitalCode, nowMs)
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
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    ms: Date.now() - started,
    hospitals: hospitals.length,
    failed,
    removed: a.count + b.count,
  }
  const value = JSON.stringify(run)
  await prisma.appSetting.upsert({ where: { key: USAGE_STATS_RUN_KEY }, update: { value }, create: { key: USAGE_STATS_RUN_KEY, value } })
  return run
}

export async function getUsageStatsRun(): Promise<UsageStatsRun | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: USAGE_STATS_RUN_KEY } })
  if (!row?.value) return null
  try {
    return JSON.parse(row.value) as UsageStatsRun
  } catch {
    return null
  }
}
