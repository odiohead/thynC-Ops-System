/**
 * 사용량 일별 집계 주기 갱신 스케줄러 (projects/usage_overview_design.md §5.3)
 *
 * 수집 Agent 가 1시간마다 보내므로 기본 주기도 1시간이다. 주기는 AppSetting `usage_stats_interval`
 * (30m · 1h · 3h · 6h · off)로 제어하고 instrumentation.ts 에서 기동한다(위키 청크 스케줄러와 같은 패턴).
 * 설정 화면이 없어 기본값이 off 면 아무도 켜지 않으므로 기본 1h. 원본 DB 가 설정되지 않은 환경에서는 돌지 않는다.
 * 수동 실행: npx tsx scripts/usage-stats-rebuild.mts
 */
import { isUsageConfigured } from './db'
import { rebuildAllUsageStats } from './stats'

const INTERVAL_MAP: Record<string, number> = {
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '3h': 3 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
}

/** 앱이 뜬 뒤 첫 실행까지 — 기동 직후의 부하와 겹치지 않게 */
const FIRST_RUN_DELAY_MS = 60 * 1000
/** 한 바퀴가 이보다 오래 걸리면 알린다 — 병원이 늘어 '최근 7일은 매시간, 전체는 하루 1회'로 나눌 때가 된 것 */
const SLOW_RUN_MS = 10 * 60 * 1000

let timer: ReturnType<typeof setInterval> | null = null
let firstRun: ReturnType<typeof setTimeout> | null = null
let running = false

async function run() {
  if (running) return // 앞 주기가 아직 도는 중이면 건너뛴다
  running = true
  try {
    const r = await rebuildAllUsageStats()
    if (r.failed.length > 0) console.error(`[usage-stats] ${r.hospitals}곳 중 ${r.failed.length}곳 실패:`, r.failed)
    if (r.ms > SLOW_RUN_MS) console.warn(`[usage-stats] 집계 한 바퀴가 ${Math.round(r.ms / 1000)}초 걸렸습니다 (병원 ${r.hospitals}곳) — 갱신 범위를 나눌 때입니다`)
  } catch (err) {
    console.error('[usage-stats] 집계 실패:', err)
  } finally {
    running = false
  }
}

export function startUsageStatsScheduler(interval: string) {
  stopUsageStatsScheduler()
  if (interval === 'off' || !INTERVAL_MAP[interval] || !isUsageConfigured()) return
  firstRun = setTimeout(run, FIRST_RUN_DELAY_MS)
  timer = setInterval(run, INTERVAL_MAP[interval])
  console.log(`[usage-stats] 사용량 일별 집계 스케줄러 시작 (${interval})`)
}

export function stopUsageStatsScheduler() {
  if (firstRun) clearTimeout(firstRun)
  if (timer) clearInterval(timer)
  firstRun = null
  timer = null
}
