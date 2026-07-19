import { GwPlacementResult, GwPoint, GwRules, GwSpace } from './types'

/**
 * 결정론적 배치 엔진 (AI 미사용 — 규칙 변경 시 재배치만으로 재계산 가능)
 * - 복도: 장축 중심선을 따라 (커버리지 직경 × 중첩계수) 간격 등분 배치 — 통로 중앙 "형광등식"
 * - 병실·기타 실: 면적 기준 1~2개 (스케일 없으면 병실 기본 개수·기타 1개)
 * - 화장실: 고정 개수, 제외 유형·최소면적 미만 실 스킵
 */
export function placeAll(spaces: GwSpace[], mPerPx: number | null, rules: GwRules): GwPlacementResult {
  const points: GwPoint[] = []
  const skipped: Record<string, number> = {}
  const notes: string[] = []
  const skip = (reason: string) => { skipped[reason] = (skipped[reason] || 0) + 1 }

  const hasCorridor = spaces.some((s) => s.type === 'corridor')
  if (!hasCorridor) notes.push('복도가 인식되지 않았습니다 — 실 단위 배치만 수행됨 (개략도·안내도일 가능성)')
  if (mPerPx === null) notes.push('스케일 없음 — 복도는 중앙 1개, 실 면적 판정은 유형 기본값으로 대체됨')

  for (const s of spaces) {
    const [x1, y1, x2, y2] = s.bbox
    const w = x2 - x1
    const h = y2 - y1
    if (w <= 0 || h <= 0) { skip('invalid_bbox'); continue }
    const cx = (x1 + x2) / 2
    const cy = (y1 + y2) / 2
    const areaM2 = mPerPx !== null ? w * h * mPerPx * mPerPx : null

    if (rules.excludedSpaceTypes.includes(s.type)) { skip('excluded'); continue }
    if (s.type === 'other' && !rules.placeUnknownRooms) { skip('unknown_off'); continue }
    if (areaM2 !== null && s.type !== 'corridor' && areaM2 < rules.minRoomAreaM2) { skip('too_small'); continue }

    const push = (x: number, y: number) =>
      points.push({ x, y, spaceId: s.id, spaceType: s.type, spaceLabel: s.label })

    if (s.type === 'corridor') {
      const horizontal = w >= h
      const lengthM = mPerPx !== null ? (horizontal ? w : h) * mPerPx : null
      const spacingM = rules.coverageDiameterM * rules.corridorOverlapFactor
      const n = lengthM !== null ? Math.max(1, Math.round(lengthM / spacingM)) : 1
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n
        if (horizontal) push(x1 + w * t, cy)
        else push(cx, y1 + h * t)
      }
      continue
    }

    if (s.type === 'toilet') {
      for (let i = 0; i < rules.toiletCount; i++) push(cx, cy)
      continue
    }

    // 병실·기타 실 — 면적 기준 개수 판정
    const useDefault = areaM2 !== null ? areaM2 >= rules.wardSmallThresholdM2 : s.type === 'ward'
    const count = useDefault ? rules.wardDefaultCount : rules.wardSmallCount
    if (count <= 0) { skip('count_zero'); continue }
    if (count === 1) { push(cx, cy); continue }
    // N개는 장축을 따라 등분 배치
    const horizontal = w >= h
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count
      if (horizontal) push(x1 + w * t, cy)
      else push(cx, y1 + h * t)
    }
  }

  return { points, skipped, notes }
}
