const INTERVAL_MAP: Record<string, number> = {
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '2h': 2 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
}

let timer: ReturnType<typeof setInterval> | null = null
let currentInterval = 'off'

async function runSync() {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'
    const secret = process.env.CRON_SECRET || ''
    await fetch(`${baseUrl}/api/mail-queue/sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
    })
    console.log(`[mail-scheduler] 동기화 완료 (${new Date().toISOString()})`)
  } catch (err) {
    console.error('[mail-scheduler] 동기화 실패:', err)
  }
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
