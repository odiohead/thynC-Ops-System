const INTERVAL_MAP: Record<string, number> = {
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '2h': 2 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
}

let timer: ReturnType<typeof setInterval> | null = null
let currentInterval = 'off'

async function runSync() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'
  const secret = process.env.CRON_SECRET || ''
  const headers = { Authorization: `Bearer ${secret}` }

  // 설치계획 메일 동기화
  try {
    await fetch(`${baseUrl}/api/mail-queue/sync`, { method: 'POST', headers })
  } catch (err) {
    console.error('[mail-scheduler] 설치계획 동기화 실패:', err)
  }

  // 답사 메일 동기화
  try {
    await fetch(`${baseUrl}/api/site-visit-queue/sync`, { method: 'POST', headers })
  } catch (err) {
    console.error('[mail-scheduler] 답사 동기화 실패:', err)
  }

  console.log(`[mail-scheduler] 동기화 완료 (${new Date().toISOString()})`)
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
