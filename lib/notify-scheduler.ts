/**
 * 알림 tick 스케줄러 (1.1 P4 재설계 — projects/notification_v1.1_design.md §5.2·§5.3)
 *
 * 1.0은 `notify_delay_interval`(off/1h/6h/24h) 주기마다 지연 **요약**만 보냈다. 두 가지 한계가 있었다.
 *  - 초과된 "그 시점" 알림이 불가능 (주기가 곧 지연 시간)
 *  - "매일 24시간"은 서버 기동 시각 기준이라 재시작하면 발송 시각이 밀린다
 *
 * 1.1은 짧은 tick(기본 5분)으로 바꾸고, 그 안에서
 *  ① SLA 초과 즉시 알림 (`notified_breach_at`으로 1회성 보장)
 *  ② 일 1회 다이제스트 (규칙별 지정 시각 도달 + KST 당일 미발송 판정)
 *  ③ RESOLVED 자동 종결(기존)
 * 을 수행한다. 발송 여부 판정이 전부 DB에 있어 **재시작에 안전**하다.
 *
 * 설정: AppSetting `notify_tick_interval` (off | 1m | 5m | 10m | 15m). 기본 5m.
 *  - 1.0 키(`notify_delay_interval`)는 다이제스트 시각 설정으로 대체됐다(규칙별 `digest_hour`).
 *    호환: 구 키가 'off'였다면 tick도 off로 시작한다(운영 중 갑작스러운 발송 방지).
 */

import { prisma } from '@/lib/prisma'
import { runSlaAlertTick } from '@/lib/sla-alerts'
import { runTicketAutoClose } from '@/lib/ticketDomain'

const INTERVAL_MAP: Record<string, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '10m': 10 * 60 * 1000,
  '15m': 15 * 60 * 1000,
}
export const TICK_OPTIONS = ['off', '1m', '5m', '10m', '15m'] as const
export const DEFAULT_TICK = '5m'

let timer: ReturnType<typeof setInterval> | null = null
let currentInterval = 'off'
let running = false // 중첩 실행 방지 (tick보다 오래 걸리는 경우)

async function tick() {
  if (running) {
    console.log('[notify-tick] 이전 실행 진행 중 — 이번 주기 스킵')
    return
  }
  running = true
  try {
    // 자동 종결 → SLA 판정 순서 (종결분은 초과 대상에서 빠진다)
    await runTicketAutoClose()
    await runSlaAlertTick()
  } catch (err) {
    console.error('[notify-tick] 실패:', err)
  } finally {
    running = false
  }
}

/** 시작 시 사용할 tick 주기 결정 — 신규 키 우선, 없으면 구 키에서 유추 */
export async function resolveTickInterval(): Promise<string> {
  try {
    const rows = await prisma.appSetting.findMany({
      where: { key: { in: ['notify_tick_interval', 'notify_delay_interval'] } },
    })
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    const explicit = map['notify_tick_interval']
    if (explicit && (TICK_OPTIONS as readonly string[]).includes(explicit)) return explicit
    // 1.0에서 지연 감지를 꺼 둔 환경은 tick도 꺼진 상태로 시작(의도치 않은 발송 방지)
    if ((map['notify_delay_interval'] ?? 'off') === 'off') return 'off'
    return DEFAULT_TICK
  } catch {
    return 'off'
  }
}

export function startNotifyScheduler(interval: string) {
  stopNotifyScheduler()
  currentInterval = interval

  if (interval === 'off' || !INTERVAL_MAP[interval]) {
    console.log('[notify-tick] 알림 tick OFF (SLA 초과 즉시 알림·일일 요약 미동작)')
    return
  }

  timer = setInterval(tick, INTERVAL_MAP[interval])
  console.log(`[notify-tick] 알림 tick 시작: ${interval} 간격 (SLA 초과 즉시 + 일일 요약 + 자동 종결)`)
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

/** 설정 변경 즉시 반영 (설정 저장 API에서 호출) */
export function restartNotifyScheduler(interval: string) {
  startNotifyScheduler(interval)
}
