/**
 * 채널톡 AS접수 폴링 스케줄러 (mail-scheduler 패턴 — projects/channeltalk_as_intake_design.md §4)
 * 주기는 AppSetting channeltalk_as_interval (off/1m/5m/10m, 기본 off). 재진입 가드 포함.
 */
import { runChanneltalkAsSync } from '@/lib/channeltalkAsSync'

const INTERVAL_MAP: Record<string, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '10m': 10 * 60 * 1000,
}

let timer: ReturnType<typeof setInterval> | null = null
let currentInterval = 'off'
let running = false

async function tick() {
  if (running) {
    console.warn('[channeltalk-as] 이전 틱 진행 중 — 스킵')
    return
  }
  running = true
  try {
    const r = await runChanneltalkAsSync()
    if (r.registered || r.failed || r.completedBack || r.shipBack || r.pickupBack) {
      console.log(`[channeltalk-as] 틱 완료 (scanned=${r.scanned}, registered=${r.registered}, failed=${r.failed}, completedBack=${r.completedBack}, shipBack=${r.shipBack}, pickupBack=${r.pickupBack})`)
    }
  } catch (err) {
    console.error('[channeltalk-as] 틱 실패:', err)
  } finally {
    running = false
  }
}

export function startChanneltalkAsScheduler(interval: string) {
  stopChanneltalkAsScheduler()
  currentInterval = interval

  if (interval === 'off' || !INTERVAL_MAP[interval]) {
    console.log('[channeltalk-as] 스케줄러 OFF')
    return
  }

  timer = setInterval(tick, INTERVAL_MAP[interval])
  console.log(`[channeltalk-as] 스케줄러 시작: ${interval} 간격`)
}

export function stopChanneltalkAsScheduler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function getChanneltalkAsInterval() {
  return currentInterval
}
