import { prisma } from '@/lib/prisma'

/**
 * 영업 연도별 종별 목표 병상수 (영업 대시보드 '목표현황' 탭)
 * 저장: AppSetting `sales_bed_targets_<year>` (JSON — { 종별: 목표병상수 })
 */

export const SALES_TARGET_TYPE_ORDER = ['상급종합', '종합병원', '병원', '요양병원', '정신병원', '치과병원', '한방병원', '의원', '치과의원', '한의원']

export const salesTargetKey = (year: number) => `sales_bed_targets_${year}`

export function parseSalesTargetYear(v: unknown): number | null {
  const n = parseInt(String(v ?? ''), 10)
  return Number.isInteger(n) && n >= 2020 && n <= 2100 ? n : null
}

/** 종별 화이트리스트 + 양의 정수만 유지 (0·빈값은 목표 없음으로 제거). 형식 위반이면 null */
export function sanitizeSalesTargets(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: Record<string, number> = {}
  for (const [type, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!SALES_TARGET_TYPE_ORDER.includes(type)) return null
    if (value === null || value === undefined || value === '') continue
    const n = typeof value === 'number' ? value : parseInt(String(value), 10)
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) return null
    if (n > 0) out[type] = n
  }
  return out
}

export async function getSalesBedTargets(year: number): Promise<Record<string, number>> {
  const row = await prisma.appSetting.findUnique({ where: { key: salesTargetKey(year) } })
  if (!row?.value) return {}
  try {
    return sanitizeSalesTargets(JSON.parse(row.value)) ?? {}
  } catch {
    return {}
  }
}
