/**
 * 출고업무 P2 — 클라이언트 안전 상수 (stock_out_request_design.md §13)
 * 출고유형 3종 → 인벤토리·전표 유형·기기 용도 매핑 단일 소스. prisma 등 서버 모듈 import 금지.
 */

export const STOCK_OUT_OUT_TYPES = ['DAEWOONG_SALE', 'SELF_SALE', 'DEMO'] as const
export type StockOutOutType = (typeof STOCK_OUT_OUT_TYPES)[number]

export interface OutTypeMeta {
  label: string
  /** 차감 인벤토리 (inventories.name 매칭 — 시드 고정 이름) */
  inventoryName: string
  /** WMS 전표 출고 유형 (status_codes STOCK_OUT_TYPE name) */
  reasonName: string
  /** 기기현황 등록 용도 입력 (DEVICE_USAGE_TYPE 별칭 — registerDevices usageTypeInput) */
  usageInput: string
}

export const OUT_TYPE_META: Record<StockOutOutType, OutTypeMeta> = {
  DAEWOONG_SALE: { label: '판매(대웅)', inventoryName: '대웅제약재고', reasonName: '판매', usageInput: '판매용' },
  SELF_SALE: { label: '판매(자체)', inventoryName: '판매용재고', reasonName: '판매', usageInput: '판매용' },
  DEMO: { label: 'DEMO·PoC', inventoryName: '평가용재고', reasonName: '영업', usageInput: '평가용' },
}

export function isStockOutOutType(v: unknown): v is StockOutOutType {
  return typeof v === 'string' && (STOCK_OUT_OUT_TYPES as readonly string[]).includes(v)
}

/** 처리 라인 모드 — WMS 품목 관리 방식에서 파생 (센서가 시리얼 품목으로 전환되면 자동으로 serial 경로) */
export type FulfillLineMode = 'serial' | 'lot' | 'qty' | 'missing'
