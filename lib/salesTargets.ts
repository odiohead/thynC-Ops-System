import { prisma } from '@/lib/prisma'

/**
 * 영업 연도별 종별 목표 병상수 (영업 대시보드 '목표현황' 탭)
 * 저장: AppSetting `sales_bed_targets_<year>` (JSON — { 종별: 목표병상수 })
 */

export const SALES_TARGET_TYPE_ORDER = ['상급종합', '종합병원', '병원', '요양병원', '정신병원', '치과병원', '한방병원', '의원', '치과의원', '한의원']

/** 목표 기간 — year: 연간 / h2: 하반기 (하반기 목표는 별도 AppSetting 키에 저장) */
export type SalesTargetPeriod = 'year' | 'h2'

export const salesTargetKey = (year: number, period: SalesTargetPeriod = 'year') =>
  period === 'year' ? `sales_bed_targets_${year}` : `sales_bed_targets_${year}_h2`

export function parseSalesTargetPeriod(v: unknown): SalesTargetPeriod {
  return v === 'h2' ? 'h2' : 'year'
}

/** 하반기 실적 집계 시작일 — 2026-08-21 사용자 결정: 8월 1일부터 (통상 하반기 7/1과 다름) */
export const salesH2From = (year: number) => `${year}-08-01`

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

/** 합계 행 그래프 색상 기본값 (설정에서 변경 가능) */
export const DEFAULT_TOTAL_COLOR = '#c026d3'

export type SalesTargetSettings = {
  targets: Record<string, number>
  totalColor: string
  typeColors: Record<string, string> // 종별별 그래프 색 (미지정 종별은 기본 팔레트)
}

export function sanitizeTotalColor(v: unknown): string | null {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null
}

/** 종별 색상 맵 — 화이트리스트 밖 종별·hex 형식 위반 항목은 버린다 */
export function sanitizeTypeColors(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [type, v] of Object.entries(raw as Record<string, unknown>)) {
    const c = sanitizeTotalColor(v)
    if (SALES_TARGET_TYPE_ORDER.includes(type) && c) out[type] = c
  }
  return out
}

/** 저장 형식 호환: 구(flat targets JSON) / 신({ targets, totalColor }) 모두 해석 */
export async function getSalesTargetSettings(year: number, period: SalesTargetPeriod = 'year'): Promise<SalesTargetSettings> {
  const fallback: SalesTargetSettings = { targets: {}, totalColor: DEFAULT_TOTAL_COLOR, typeColors: {} }
  const row = await prisma.appSetting.findUnique({ where: { key: salesTargetKey(year, period) } })
  if (!row?.value) return fallback
  try {
    const raw = JSON.parse(row.value)
    if (raw && typeof raw === 'object' && 'targets' in raw) {
      return {
        targets: sanitizeSalesTargets(raw.targets) ?? {},
        totalColor: sanitizeTotalColor(raw.totalColor) ?? DEFAULT_TOTAL_COLOR,
        typeColors: sanitizeTypeColors(raw.typeColors),
      }
    }
    return { ...fallback, targets: sanitizeSalesTargets(raw) ?? {} }
  } catch {
    return fallback
  }
}
