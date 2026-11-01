/**
 * 출고업무 — 클라이언트 안전 상수 (projects/stock_out_v2_design.md §3·§5). prisma 등 서버 모듈 import 금지.
 * v2 (2026-11-01): 품목 소스 = 자재관리 품목(inventory_items). 출고유형 선택(OUT_TYPE_META)은 폐기 —
 * 전표 유형·기기 용도는 품목이 속한 인벤토리명으로 결정(INVENTORY_OUT_META).
 */

/** 업무 구분 — 설정 탭 순서 = 배열 순서 (구축 1순위) */
export const STOCK_OUT_PURPOSES = ['BUILD', 'MAINTENANCE', 'BUSINESS'] as const
export type StockOutPurpose = (typeof STOCK_OUT_PURPOSES)[number]
export const STOCK_OUT_PURPOSE_LABELS: Record<StockOutPurpose, string> = {
  BUILD: '구축',
  MAINTENANCE: '유지보수',
  BUSINESS: '사업업무',
}
export function isStockOutPurpose(v: unknown): v is StockOutPurpose {
  return typeof v === 'string' && (STOCK_OUT_PURPOSES as readonly string[]).includes(v)
}

export interface InventoryOutMeta {
  /** WMS 전표 출고 유형 (status_codes STOCK_OUT_TYPE name) */
  reasonName: string
  /** 기기현황 등록 용도 입력 (DEVICE_USAGE_TYPE 별칭 — registerDevices usageTypeInput) */
  usageInput: string
}

/** 인벤토리명 → 전표 유형·기기 용도 (시드 고정 이름). 미등록 인벤토리는 DEFAULT_OUT_META */
export const INVENTORY_OUT_META: Record<string, InventoryOutMeta> = {
  대웅제약재고: { reasonName: '판매', usageInput: '판매용' },
  판매용재고: { reasonName: '판매', usageInput: '판매용' },
  평가용재고: { reasonName: '영업', usageInput: '평가용' },
  오산영업소: { reasonName: '영업', usageInput: '평가용' },
  thynC운영팀재고: { reasonName: '기타', usageInput: '판매용' },
}
export const DEFAULT_OUT_META: InventoryOutMeta = { reasonName: '기타', usageInput: '판매용' }
export function outMetaForInventory(inventoryName: string): InventoryOutMeta {
  return INVENTORY_OUT_META[inventoryName] ?? DEFAULT_OUT_META
}

/** 처리 라인 모드 — WMS 품목 관리 방식에서 파생 (센서가 시리얼 품목으로 전환되면 자동으로 serial 경로) */
export type FulfillLineMode = 'serial' | 'lot' | 'qty' | 'missing'
