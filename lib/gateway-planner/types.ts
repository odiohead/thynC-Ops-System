// 게이트웨이 배치 플래너 — 공용 타입 (function_gateway_planner.html)

export const SPACE_TYPES = [
  'corridor', 'ward', 'toilet', 'nurse_station', 'stairs', 'elevator', 'outdoor', 'storage', 'machine', 'other',
] as const
export type SpaceType = (typeof SPACE_TYPES)[number]

export const SPACE_TYPE_LABELS: Record<SpaceType, string> = {
  corridor: '복도', ward: '병실', toilet: '화장실', nurse_station: '간호사실',
  stairs: '계단실', elevator: 'EV', outdoor: '야외', storage: '창고', machine: '설비', other: '기타',
}

export interface GwSpace {
  id: string
  type: SpaceType
  label: string
  bbox: [number, number, number, number] // vision px
  confidence: 'high' | 'mid' | 'low'
}

export interface GwDimensionReading {
  valueMm: number
  fromPx: [number, number]
  toPx: [number, number]
  confidence: 'high' | 'mid' | 'low'
}

export interface GwAnalysis {
  spaces: GwSpace[]
  dimensionReadings: GwDimensionReading[] // 스케일용 (전체 뷰 우선)
}

export interface GwPoint {
  x: number // vision px
  y: number
  spaceId: string
  spaceType: SpaceType
  spaceLabel: string
}

export interface GwPlacementResult {
  points: GwPoint[]
  skipped: Record<string, number>
  notes: string[]
}

export interface GwScaleCandidate {
  mPerPx: number | null
  spreadPct: number | null
  used: number
  rejected: number
}

export interface GwRules {
  coverageDiameterM: number // 게이트웨이 커버리지 직경 (m)
  corridorOverlapFactor: number // 복도 점 간격 = 직경 × 계수
  wardDefaultCount: number
  wardSmallCount: number
  wardSmallThresholdM2: number
  toiletCount: number
  minRoomAreaM2: number // 이보다 작은 실 스킵 (PS 샤프트 등)
  excludedSpaceTypes: SpaceType[]
  placeUnknownRooms: boolean
  dotDiameterCm: number
  dotColor: string // hex without #
}

export const DEFAULT_RULES: GwRules = {
  coverageDiameterM: 10,
  corridorOverlapFactor: 0.8,
  wardDefaultCount: 2,
  wardSmallCount: 1,
  wardSmallThresholdM2: 20,
  toiletCount: 1,
  minRoomAreaM2: 2,
  excludedSpaceTypes: ['stairs', 'elevator', 'outdoor'],
  placeUnknownRooms: true,
  dotDiameterCm: 0.2,
  dotColor: 'FF0000',
}
