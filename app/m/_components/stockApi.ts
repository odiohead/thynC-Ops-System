'use client'

import type { ScanParsed } from '@/lib/scanParse'

/** GET /api/inventory/units/lookup 응답 (app/api/inventory/units/lookup/route.ts) */
export interface LookupUnit {
  id: number
  serialNo: string
  lotNo: string | null
  status: 'IN_STOCK' | 'OUT' | 'DISPOSED' | string
  updatedAt: string
  tags: string[]
  item: { id: number; itemCode: string; name: string; modelName: string | null; unit: string; isSerialManaged: boolean; isLotManaged: boolean; udiDi: string | null; isActive: boolean }
  inventory: { id: number; name: string; linkHospital: boolean }
  warehouse: { id: number; name: string } | null
  hospital: { hospitalCode: string; hospitalName: string } | null
}
export interface GtinItem {
  id: number
  itemCode: string
  name: string
  modelName: string | null
  isSerialManaged: boolean
  isLotManaged: boolean
  inventory: { id: number; name: string }
}
export interface LookupResult {
  parsed: ScanParsed
  units: LookupUnit[]
  gtinItems: GtinItem[]
}

export async function lookupCode(raw: string): Promise<LookupResult> {
  const res = await fetch(`/api/inventory/units/lookup?code=${encodeURIComponent(raw)}`, { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || '조회 실패')
  return data as LookupResult
}

export const UNIT_STATUS_LABEL: Record<string, string> = { IN_STOCK: '재고', OUT: '출고', DISPOSED: '폐기' }

/** 개체 위치 한 줄 — 재고면 위치, 출고면 병원 */
export function unitWhere(u: LookupUnit): string {
  if (u.status === 'IN_STOCK') return u.warehouse?.name ?? '위치 미지정'
  if (u.status === 'OUT') return u.hospital?.hospitalName ?? '출고처 미지정'
  return '폐기'
}
