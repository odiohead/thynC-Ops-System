import { syncInstallPlanMails, syncSiteVisitMails } from '@/lib/mail-sync'

const INTERVAL_MAP: Record<string, number> = {
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '2h': 2 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
}

let timer: ReturnType<typeof setInterval> | null = null
let currentInterval = 'off'

async function runOne(label: string, fn: () => Promise<{ newCount: number; total: number }>) {
  try {
    const { newCount, total } = await fn()
    console.log(`[mail-scheduler] ${label} 성공 (newCount=${newCount}, total=${total})`)
  } catch (err) {
    console.error(`[mail-scheduler] ${label} 실패:`, err)
  }
}

async function runSync() {
  await runOne('설치계획 동기화', syncInstallPlanMails)
  await runOne('답사 동기화', syncSiteVisitMails)
  console.log(`[mail-scheduler] 동기화 루프 완료 (${new Date().toISOString()})`)
}

export function startScheduler(interval: string) {
  stopScheduler()
  currentInterval = interval

  if (interval === 'off' || !INTERVAL_MAP[interval]) {
    console.log('[mail-scheduler] 스케줄러 OFF')
    return
  }

  const ms = INTERVAL_MAP[interval]
  timer = setInterval(runSync, ms)
  console.log(`[mail-scheduler] 스케줄러 시작: ${interval} 간격`)
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function getCurrentInterval() {
  return currentInterval
}
