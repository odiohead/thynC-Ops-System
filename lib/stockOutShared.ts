/**
 * 출고업무 — 클라이언트 안전 상수 (projects/stock_out_v2_design.md §3·§5). prisma 등 서버 모듈 import 금지.
 * v2 (2026-11-01): 품목 소스 = 자재관리 품목(inventory_items). 출고유형 선택(OUT_TYPE_META)은 폐기 —
 * 전표 유형·기기 용도는 품목이 속한 인벤토리명으로 결정(INVENTORY_OUT_META).
 */

/**
 * 업무 구분 — 설정 탭 순서 = 배열 순서 (구축 1순위).
 * 영업 유형 3종(평가용·판매용·오산영업소, 2026-11-05 — projects/stock_out_sales_request_design.md)은
 * 프로젝트 없이 납품처·수령지·수취인으로 요청하며, 설정 탭에서 유형별로 노출 품목(= 출고 인벤토리)을 지정한다.
 */
export const STOCK_OUT_PURPOSES = ['BUILD', 'MAINTENANCE', 'BUSINESS', 'EVALUATION', 'SALES', 'OSAN_OFFICE'] as const
export type StockOutPurpose = (typeof STOCK_OUT_PURPOSES)[number]
export const STOCK_OUT_PURPOSE_LABELS: Record<StockOutPurpose, string> = {
  BUILD: '구축',
  MAINTENANCE: '유지보수',
  BUSINESS: '사업업무',
  EVALUATION: '평가용',
  SALES: '판매용',
  OSAN_OFFICE: '오산영업소',
}
export function isStockOutPurpose(v: unknown): v is StockOutPurpose {
  return typeof v === 'string' && (STOCK_OUT_PURPOSES as readonly string[]).includes(v)
}

/** 영업 유형 — 프로젝트 없는 출고요청 (모바일 출고요청 등록) */
export const STOCK_OUT_SALES_TYPES = ['EVALUATION', 'SALES', 'OSAN_OFFICE'] as const
export type StockOutSalesType = (typeof STOCK_OUT_SALES_TYPES)[number]
export function isStockOutSalesType(v: unknown): v is StockOutSalesType {
  return typeof v === 'string' && (STOCK_OUT_SALES_TYPES as readonly string[]).includes(v)
}

/** 영업 유형별 목적 — 1개뿐이면 자동 선택 (오산영업소) */
export const STOCK_OUT_SUB_PURPOSES: Record<StockOutSalesType, { code: string; label: string }[]> = {
  EVALUATION: [
    { code: 'DEMO', label: '데모' },
    { code: 'SYMPOSIUM', label: '심포지엄' },
    { code: 'OTHER', label: '기타' },
  ],
  SALES: [
    { code: 'SALES_SUPPLY', label: '영업용 제공' },
    { code: 'LOST_REPLACE', label: '분실기기 제공' },
  ],
  OSAN_OFFICE: [{ code: 'SHOWCASE', label: '시연용(심포지엄 등)' }],
}
export function subPurposeLabel(type: string, code: string | null | undefined): string | null {
  if (!code) return null
  if (type === 'BUILD') return STOCK_OUT_BUILD_TYPE_LABELS[code as StockOutBuildType] ?? code
  return STOCK_OUT_SUB_PURPOSES[type as StockOutSalesType]?.find((s) => s.code === code)?.label ?? code
}

/**
 * 구축(프로젝트) 출고요청의 유형 (2026-11-18) — 요청 작성 때 고른다. `stock_out_requests.sub_purpose`에 저장(영업 유형의 '목적'과 같은 칸).
 *  - GENERAL 구축(일반) / LITE 구축(라이트): 출고되는 심전계·산소포화도가 병원 기기현황에 그 **상품유형**으로 등록된다(계약 매핑이 아니라 유형 기준 — 사용자 결정)
 *  - POC 데모(PoC): 대웅제약재고에서 나가지 않는다 — 요청 폼에서 그 재고 영역을 숨기고 서버도 거부한다
 * 2026-11-18 이전 구축 요청은 값이 없다(null) — 출고 처리는 병원 계약이 한 종류면 그 유형으로, 일반·라이트가 섞였으면 처리 화면에서 고르게 한다.
 */
export const STOCK_OUT_BUILD_TYPES = ['GENERAL', 'LITE', 'POC'] as const
export type StockOutBuildType = (typeof STOCK_OUT_BUILD_TYPES)[number]
export const STOCK_OUT_BUILD_TYPE_LABELS: Record<StockOutBuildType, string> = { GENERAL: '구축(일반)', LITE: '구축(라이트)', POC: '데모(PoC)' }
export function isStockOutBuildType(v: unknown): v is StockOutBuildType {
  return typeof v === 'string' && (STOCK_OUT_BUILD_TYPES as readonly string[]).includes(v)
}
/** 데모(PoC) 요청에서 쓸 수 없는 재고 */
export const STOCK_OUT_POC_EXCLUDED_INVENTORY = '대웅제약재고'
/** 요청 유형이 정하는 기기 상품유형 — 구축(일반)=일반 · 구축(라이트)=라이트 · 그 외(데모·미지정·영업 유형)=정해지지 않음(null) */
export function stockOutProductTypeOf(purpose: string, subPurpose: string | null | undefined): '일반' | '라이트' | null {
  if (purpose !== 'BUILD') return null
  return subPurpose === 'GENERAL' ? '일반' : subPurpose === 'LITE' ? '라이트' : null
}
/** 업무 구분 표시 — 구축 요청은 유형이 있으면 그 이름('구축(라이트)' 등), 없으면 '구축' */
export function stockOutKindLabel(purpose: string, subPurpose: string | null | undefined): string {
  if (purpose === 'BUILD' && isStockOutBuildType(subPurpose)) return STOCK_OUT_BUILD_TYPE_LABELS[subPurpose]
  return STOCK_OUT_PURPOSE_LABELS[purpose as StockOutPurpose] ?? purpose
}

/** 납품처 구분 */
export const STOCK_OUT_DEST_TYPES = ['HOSPITAL', 'OTHER'] as const
export type StockOutDestType = (typeof STOCK_OUT_DEST_TYPES)[number]
export const STOCK_OUT_DEST_LABELS: Record<StockOutDestType, string> = { HOSPITAL: '병원', OTHER: '기타' }

/** 납품처 표시명 — 병원명 또는 기타 텍스트 */
export function stockOutDestName(r: { destType?: string | null; destText?: string | null; destHospital?: { hospitalName: string } | null }): string | null {
  if (r.destType === 'HOSPITAL') return r.destHospital?.hospitalName ?? null
  if (r.destType === 'OTHER') return r.destText ?? null
  return null
}

/**
 * 출고요청 표시 제목 — 프로젝트 요청은 프로젝트명, 영업 유형은 "유형·목적 납품처".
 * 티켓 제목·알림·목록이 공유 (단일 소스).
 */
export function stockOutTitle(r: {
  purpose: string
  subPurpose?: string | null
  project?: { projectName: string } | null
  destType?: string | null
  destText?: string | null
  destHospital?: { hospitalName: string } | null
}): string {
  if (r.project) return r.project.projectName
  const head = [STOCK_OUT_PURPOSE_LABELS[r.purpose as StockOutPurpose] ?? r.purpose, subPurposeLabel(r.purpose, r.subPurpose)].filter(Boolean).join('·')
  const dest = stockOutDestName(r)
  return dest ? `${head} ${dest}` : head
}

/** 출고요청(영업 유형) 입력 가이드 — 모바일·PC 공용 항목 키·기본 문구 (설정 > 출고 품목 관리 > 입력 가이드, app_settings JSON) */
export const STOCK_OUT_GUIDE_SETTING_KEY = 'stock_out_request_guides'
export const STOCK_OUT_GUIDE_FIELDS = [
  { key: 'type', label: '유형', fallback: '어느 재고에서 출고할지 정합니다. 평가용·판매용·오산영업소 재고에서 각각 처리됩니다.' },
  { key: 'subPurpose', label: '목적', fallback: '출고 목적을 선택하세요.' },
  { key: 'dest', label: '납품처', fallback: '병원이면 검색해서 선택하고, 그 외에는 기타를 골라 직접 입력하세요.' },
  { key: 'shipAddress', label: '수령지', fallback: '택배·퀵을 받을 주소를 입력하세요.' },
  { key: 'recipient', label: '수취인', fallback: '받는 분 이름과 연락처를 입력하세요.' },
  { key: 'requestDate', label: '희망 출고일', fallback: '자재 담당자가 이 날짜 기준으로 출고합니다.' },
  { key: 'items', label: '품목·수량', fallback: '필요한 품목만 수량을 입력하세요. 배터리·에바폼은 운영팀 재고에서 함께 나갑니다.' },
  { key: 'note', label: '비고', fallback: '전달할 내용이 있으면 적어 주세요.' },
] as const
export type StockOutGuideKey = (typeof STOCK_OUT_GUIDE_FIELDS)[number]['key']
export type StockOutGuides = Partial<Record<StockOutGuideKey, string>>

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

/**
 * 라이트용 품목인지 — 품목명이 'L' + 한글로 시작(예: 'L심전계(L-MC200M-T)', 'L산소포화도본체(L-MP100W)'). 2026-11-18
 * 출고 처리에서 계약 상품유형과 어긋날 때 **경고**하는 데만 쓴다(판정·차단 근거 아님 — 상품유형은 계약 기준).
 */
export function isLiteItemName(name: string | null | undefined): boolean {
  return /^L[가-힣]/.test((name ?? '').trim())
}

