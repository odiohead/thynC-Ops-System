import { GwDimensionReading, GwScaleCandidate } from './types'

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1])
const median = (arr: number[]) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)]

/**
 * 치수 판독으로부터 스케일(m/px) 산출.
 * Phase 0 검증: 끝점 오차 비율이 큰 짧은 구간(100px 미만) 제외 + ±30% 이상치 반복 제거한 중앙값이 견고
 * (good_1: 면적 표기 교차검증 대비 2% 내 일치)
 */
export function computeScale(readings: GwDimensionReading[]): GwScaleCandidate {
  const cands = readings
    .filter((r) => r.confidence !== 'low')
    .map((r) => ({ mPerPx: r.valueMm / 1000 / dist(r.fromPx, r.toPx), pxLen: dist(r.fromPx, r.toPx) }))
    .filter((c) => Number.isFinite(c.mPerPx) && c.mPerPx > 0 && c.pxLen >= 100)
  if (!cands.length) return { mPerPx: null, spreadPct: null, used: 0, rejected: readings.length }

  let vals = cands.map((c) => c.mPerPx)
  for (let iter = 0; iter < 2; iter++) {
    const med = median(vals)
    const kept = vals.filter((v) => Math.abs(v - med) / med <= 0.3)
    if (kept.length >= 3) vals = kept
  }
  const m = median(vals)
  return {
    mPerPx: m,
    spreadPct: ((Math.max(...vals) - Math.min(...vals)) / m) * 100,
    used: vals.length,
    rejected: cands.length - vals.length,
  }
}
