/**
 * 지연 감지 스케줄러 (function_notification.md Phase 3)
 * lib/mail-scheduler.ts와 동일 패턴. AppSetting `notify_delay_interval`로 주기 제어,
 * instrumentation.ts에서 기동. 첫 실행은 인터벌 경과 후(재배포 즉시 발송 방지).
 */

import { runDelayNotifications } from '@/lib/notify'

const INTERVAL_MAP: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
}

let timer: ReturnType<typeof setInterval> | null = null
let currentInterval = 'off'

async function run() {
  try {
    await runDelayNotifications()
    console.log(`[notify-scheduler] 지연 감지 실행 완료 (${new Date().toISOString()})`)
  } catch (err) {
    console.error('[notify-scheduler] 지연 감지 실패:', err)
  }
}

export function startNotifyScheduler(interval: string) {
  stopNotifyScheduler()
  currentInterval = interval

  if (interval === 'off' || !INTERVAL_MAP[interval]) {
    console.log('[notify-scheduler] 지연 감지 OFF')
    return
  }

  timer = setInterval(run, INTERVAL_MAP[interval])
  console.log(`[notify-scheduler] 지연 감지 시작: ${interval} 간격`)
}

export function stopNotifyScheduler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function getNotifyInterval() {
  return currentInterval
}
