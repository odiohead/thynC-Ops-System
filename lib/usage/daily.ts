/**
 * 사용량 일별 계산 — 순수 함수 (DB·시각 의존 없음, projects/usage_collection_design.md §14)
 *
 * 구간(Interval)은 "언제부터 언제까지 진행 중이었는가"이고, 시각은 병원 현지 시각을
 * 초 단위 숫자로 바꾼 값이다(현지 벽시계 시각을 UTC인 것처럼 읽은 epoch 초).
 * 하루의 경계는 그 숫자 기준 86,400초 단위 = 병원 현지 자정이다.
 */

export type Interval = { s: number; e: number }

export const DAY_SEC = 86400

/** 끝이 시작보다 이르거나 같은 구간은 1초짜리로 본다 (그날 한 번 쓰인 것으로 센다) */
export function normalize(iv: Interval): Interval {
  return iv.e > iv.s ? iv : { s: iv.s, e: iv.s + 1 }
}

/**
 * 하루(dayStart ~ dayStart+1일) 동안
 *  - count: 그날 한순간이라도 걸쳐 있던 구간의 수
 *  - peak:  그날 어느 한 시점에 동시에 진행 중이던 구간의 최대 수
 * 같은 시각에 하나가 끝나고 다른 하나가 시작하면 동시에 진행한 것으로 세지 않는다.
 */
export function dayStats(intervals: Interval[], dayStart: number): { count: number; peak: number } {
  return spanStats(intervals, dayStart, dayStart + DAY_SEC)
}

/** dayStats 의 일반형 — [start, end) 구간 동안 걸쳐 있던 수와 최대 동시 수 (주간 실측정 수 등) */
export function spanStats(intervals: Interval[], dayStart: number, dayEnd: number): { count: number; peak: number } {
  const events: { t: number; d: number }[] = []
  let count = 0
  for (const raw of intervals) {
    const iv = normalize(raw)
    if (iv.s >= dayEnd || iv.e <= dayStart) continue
    count++
    events.push({ t: Math.max(iv.s, dayStart), d: 1 })
    events.push({ t: Math.min(iv.e, dayEnd), d: -1 })
  }
  events.sort((a, b) => a.t - b.t || a.d - b.d) // 같은 시각이면 끝(-1)을 먼저
  let running = 0
  let peak = 0
  for (const ev of events) {
    running += ev.d
    if (running > peak) peak = running
  }
  return { count, peak }
}

/** epoch 초(현지 기준) → 'YYYY-MM-DD' */
export function dayLabel(dayStart: number): string {
  return new Date(dayStart * 1000).toISOString().slice(0, 10)
}

/** 현지 시각 기준 오늘 자정(epoch 초). offsetHours = 병원 시간대의 UTC 오프셋 */
export function localDayStart(nowMs: number, offsetHours: number): number {
  const local = Math.floor(nowMs / 1000) + offsetHours * 3600
  return Math.floor(local / DAY_SEC) * DAY_SEC
}

/** 그 날이 속한 주의 월요일 자정 (epoch 초, 현지 기준). 1970-01-01 은 목요일 */
export function weekStartOf(dayStart: number): number {
  const day = Math.floor(dayStart / DAY_SEC)
  return (day - ((day + 3) % 7)) * DAY_SEC
}

/** 증감률(%) — 이전 값이 없거나 0이면 null */
export function changeRate(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || prev === 0) return null
  return ((cur - prev) / prev) * 100
}

/** 최댓값 (null 제외). 값이 없으면 null */
export function maxOf(values: (number | null)[]): number | null {
  const xs = values.filter((v): v is number => v !== null)
  return xs.length === 0 ? null : Math.max(...xs)
}

/** 평균 (null 제외). 값이 없으면 null */
export function average(values: (number | null)[]): number | null {
  const xs = values.filter((v): v is number => v !== null)
  if (xs.length === 0) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}
