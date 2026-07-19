import { prisma } from '@/lib/prisma'
import { DEFAULT_RULES, GwRules, SPACE_TYPES, SpaceType } from './types'

const SETTING_KEY = 'gw_planner_rules'

export async function loadRules(): Promise<GwRules> {
  const row = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } })
  if (!row?.value) return { ...DEFAULT_RULES }
  try {
    return sanitizeRules(JSON.parse(row.value))
  } catch {
    return { ...DEFAULT_RULES }
  }
}

export async function saveRules(input: unknown): Promise<GwRules> {
  const rules = sanitizeRules(input)
  await prisma.appSetting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(rules) },
    create: { key: SETTING_KEY, value: JSON.stringify(rules) },
  })
  return rules
}

const num = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, n))
}

export function sanitizeRules(input: unknown): GwRules {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const excluded = Array.isArray(o.excludedSpaceTypes)
    ? (o.excludedSpaceTypes.filter((t) => SPACE_TYPES.includes(t as SpaceType)) as SpaceType[])
    : DEFAULT_RULES.excludedSpaceTypes
  return {
    coverageDiameterM: num(o.coverageDiameterM, DEFAULT_RULES.coverageDiameterM, 1, 100),
    corridorOverlapFactor: num(o.corridorOverlapFactor, DEFAULT_RULES.corridorOverlapFactor, 0.1, 1),
    wardDefaultCount: Math.round(num(o.wardDefaultCount, DEFAULT_RULES.wardDefaultCount, 1, 10)),
    wardSmallCount: Math.round(num(o.wardSmallCount, DEFAULT_RULES.wardSmallCount, 0, 10)),
    wardSmallThresholdM2: num(o.wardSmallThresholdM2, DEFAULT_RULES.wardSmallThresholdM2, 1, 500),
    toiletCount: Math.round(num(o.toiletCount, DEFAULT_RULES.toiletCount, 0, 10)),
    minRoomAreaM2: num(o.minRoomAreaM2, DEFAULT_RULES.minRoomAreaM2, 0, 100),
    excludedSpaceTypes: excluded.filter((t) => t !== 'corridor'), // 복도는 제외 불가
    placeUnknownRooms: o.placeUnknownRooms !== false,
    dotDiameterCm: num(o.dotDiameterCm, DEFAULT_RULES.dotDiameterCm, 0.05, 2),
    dotColor: typeof o.dotColor === 'string' && /^[0-9A-Fa-f]{6}$/.test(o.dotColor) ? o.dotColor.toUpperCase() : DEFAULT_RULES.dotColor,
  }
}
