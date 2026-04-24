const INTERVAL_MAP: Record<string, number> = {
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '2h': 2 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
}

let timer: ReturnType<typeof setInterval> | null = null
let currentInterval = 'off'

async function callSync(label: string, url: string, headers: Record<string, string>) {
  try {
    const res = await fetch(url, { method: 'POST', headers })
    if (!res.ok) {
      let body = ''
      try { body = await res.text() } catch {}
      console.error(`[mail-scheduler] ${label} HTTP ${res.status}: ${body.slice(0, 500)}`)
      return
    }
    const data = await res.json().catch(() => null)
    const newCount = data?.newCount ?? '?'
    console.log(`[mail-scheduler] ${label} 성공 (newCount=${newCount})`)
  } catch (err) {
    console.error(`[mail-scheduler] ${label} 네트워크 실패:`, err)
  }
}

async function runSync() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'
  const secret = process.env.CRON_SECRET || ''
  const headers = { Authorization: `Bearer ${secret}` }

  await callSync('설치계획 동기화', `${baseUrl}/api/mail-queue/sync`, headers)
  await callSync('답사 동기화', `${baseUrl}/api/site-visit-queue/sync`, headers)

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
