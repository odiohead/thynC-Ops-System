/**
 * 사용량 일별 집계 주기 갱신 스케줄러 (projects/usage_overview_design.md §5.3)
 *
 * 주기마다 최근 3일을 다시 계산하고(recent), 날마다 새벽 3시 이후 첫 주기에 91일 전체를 다시 계산한다(full) —
 * 2026-11-26, 병원 188곳에서 전체를 매시간 돌리면 14분이 걸려 나눔 (lib/usage/stats.ts statsRunMode).
 * 수집 Agent 가 1시간마다 보내므로 기본 주기도 1시간이다. 주기는 AppSetting `usage_stats_interval`
 * (30m · 1h · 3h · 6h · off)로 제어하고 instrumentation.ts 에서 기동한다(위키 청크 스케줄러와 같은 패턴).
 * 설정 화면이 없어 기본값이 off 면 아무도 켜지 않으므로 기본 1h. 원본 DB 가 설정되지 않은 환경에서는 돌지 않는다.
 * 수동 실행: npx tsx scripts/usage-stats-rebuild.mts
 */
import { isUsageConfigured } from './db'
import { getUsageStatsFullRun, rebuildAllUsageStats, statsRunMode } from './stats'

const INTERVAL_MAP: Record<string, number> = {
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '3h': 3 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
}

/** 앱이 뜬 뒤 첫 실행까지 — 기동 직후의 부하와 겹치지 않게 */
const FIRST_RUN_DELAY_MS = 60 * 1000
/** 매 주기(recent) 한 바퀴가 이보다 오래 걸리면 알린다 — 주기의 절반을 넘보기 전에 구조를 바꿀 때다 */
const SLOW_RUN_MS = 10 * 60 * 1000

let timer: ReturnType<typeof setInterval> | null = null
let firstRun: ReturnType<typeof setTimeout> | null = null
let running = false

async function run() {
  if (running) return // 앞 주기가 아직 도는 중이면 건너뛴다
  running = true
  try {
    const lastFull = await getUsageStatsFullRun()
    const mode = statsRunMode(Date.now(), lastFull ? Date.parse(lastFull.startedAt) : null)
    const r = await rebuildAllUsageStats(Date.now(), mode)
    const label = mode === 'full' ? '전체(91일)' : '최근(3일)'
    console.log(`[usage-stats] ${label} 집계 ${Math.round(r.ms / 1000)}초 · 병원 ${r.hospitals}곳${r.failed.length ? ` · 실패 ${r.failed.length}곳` : ''}`)
    if (r.failed.length > 0) console.error(`[usage-stats] ${label} ${r.hospitals}곳 중 ${r.failed.length}곳 실패:`, r.failed)
    if (mode === 'recent' && r.ms > SLOW_RUN_MS) console.warn(`[usage-stats] 최근(3일) 집계 한 바퀴가 ${Math.round(r.ms / 1000)}초 걸렸습니다 (병원 ${r.hospitals}곳) — 집계 구조를 바꿀 때입니다`)
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
