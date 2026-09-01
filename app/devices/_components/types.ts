/**
 * 디바이스 원장 UI 타입 — /devices 화면이 소비하는 API 응답·요청 형상 (projects/hospital_device_registry_design.md §6·§7.1)
 *
 * 출처(단일 소스): 라우트 구현(app/api/devices/**, app/api/hospitals/[code]/devices/**, …/wards/**)과
 * lib/deviceRegistry/{read,write,import,admin,wms}.ts 의 반환 타입. 서버 타입을 직접 import하면 prisma가 클라이언트 번들에
 * 끌려오므로 여기서 JSON 직렬화 후 형상(Date → ISO 문자열, @db.Date → 'YYYY-MM-DDT00:00:00.000Z')으로 다시 적는다.
 * 날짜 표시는 lib/deviceRegistryShared 의 `toYmd()`로 절단한다.
 *
 * 이 파일은 P3-0 스켈레톤 소유(orchestrator). 그룹 A~D는 여기 타입을 import만 하고 수정하지 않는다(필요 시 Verify 에이전트 경유).
 */
import type {
  DeviceEventType,
  DeviceStatus,
  ImportBatchMode,
  ImportRowAction,
  ImportSourceKind,
  ImportVerdict,
  OccurredOnBasis,
  OnpremHeaderMap,
  ProductType,
  ProductTypeContext,
  ProductTypeFilter,
  RegistryRefType,
  RegistrySource,
  UsageFilter,
  UsageTypeRef,
} from '@/lib/deviceRegistryShared'

export type { ProductType, ProductTypeContext, ProductTypeFilter, UsageFilter, UsageTypeRef }

/** 상품유형 축 키(요약 매트릭스) — '일반' | '라이트' | '미지정' */
export type ProductTypeKey = ProductType | '미지정'

// ─────────────────────────────────────────────────────────────────────────────
// 권한 · 병원 옵션
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/devices/can-manage */
export interface Capabilities {
  canWrite: boolean
  canAdmin: boolean
}

export const READ_ONLY_CAPABILITIES: Capabilities = { canWrite: false, canAdmin: false }

/** 병원 콤보 옵션 — 커버리지(고객 ∪ 원장 보유) 또는 `/api/hospitals` 검색 결과에서 생성 */
export interface HospitalOption {
  hospitalCode: string
  hospitalName: string
  status: string | null
  /** 원장에 개체가 1건 이상 있는 병원(커버리지 registered). 검색 결과는 undefined */
  registered?: boolean
  /** 커버리지 행의 배치 중 합계 — 콤보 라벨 '배치 중 n대'(검색 결과는 undefined) */
  activeTotal?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// 공용 소형 형상
// ─────────────────────────────────────────────────────────────────────────────

export interface RegistryRef {
  type: RegistryRefType
  code: string
}

export interface HospitalRef {
  hospitalCode: string
  hospitalName: string
}

export interface WardRef {
  id: number
  name: string
}

export interface ReasonRef {
  id: number
  name: string
  /** 시스템 의미(DEFECT·LOST·RETURN·DISPOSE·TRANSFER) — 사용자 추가 사유는 null */
  value: string | null
}

export interface DeviceInfoRef {
  id: number
  deviceModel: string
  deviceName: string
  deviceClass: string
  onpremDeviceType: number | null
  serialPattern: string | null
}

/** 회수 사유 마스터 행 — GET /api/settings/device-recovery-reason → { statusCodes } */
export interface RecoveryReason {
  id: number
  name: string
  value: string | null
  order: number
  color: string | null
  category: string
}

/** 용도 마스터 행 — GET /api/settings/device-usage-type → { statusCodes } (value SALE 판매용 / EVAL 평가용) */
export type UsageType = RecoveryReason

/**
 * WMS 매칭(lib/deviceRegistry/wms.ts WmsMatch) — 표시 전용 일시 계산. 3층 구조(B-20) 이후 원장↔WMS 영속 링크는 없다
 * (`unitId`는 inventory_units.id — 원장 device id가 아님).
 */
export interface WmsMatch {
  unitId: number
  serialNo: string
  inventoryName: string
  status: string
  itemCode: string
  modelName: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// 전역 커버리지 (GET /api/devices/summary)
// ─────────────────────────────────────────────────────────────────────────────

export type CoverageFilter = 'all' | 'unregistered' | 'diff' | 'complete'
export type CoverageSort = 'diff' | 'name' | 'lastEvent'

export interface CoverageRow {
  hospitalCode: string
  hospitalName: string
  status: string
  deals: number
  /** 계약완료 딜 0건이면 null → 계약 열 '— (계약완료 딜 없음)' */
  expected: number | null
  /** 원장 개체 1건 이상 — false면 '미등록' 행(배치 열은 0·'—') */
  registered: boolean
  /** 배치 중 ECG 가운데 계약 대조 대상(평가용 제외) */
  activeEcg: number
  /** 배치 중 ECG 평가용(대조 제외) */
  activeEcgEval: number
  activeSpo2: number
  activeGw: number
  activeThird: number
  activeTotal: number
  /** 배치 중 평가용 합계(전 모델) */
  evalTotal: number
  /** activeEcg(평가용 제외) − expected (expected null 또는 미등록이면 null) */
  diff: number | null
  recovered30d: number
  lastEvent: { type: string; on: string } | null
  lastImport: { id: number; at: string; occurredOn: string | null; rowCount: number; registeredCount: number } | null
  /** 계약완료 딜 상품유형이 일반+라이트 혼합(B-22) → '상품유형 혼합' 배지 */
  productTypeMixed: boolean
  /** 혼합 병원의 상품유형 미지정 ACTIVE 배치 수(혼합 아니면 0) */
  unassignedProductType: number
}

export interface CoverageTotals {
  customerHospitals: number
  registeredHospitals: number
  active: { ecg: number; spo2: number; gw: number; third: number; total: number; eval: number }
  events30d: number
  recovered30d: number
  mixedProductTypeHospitals: number
}

export interface CoverageResponse {
  data: CoverageRow[]
  total: number
  page: number
  limit: number
  totals: CoverageTotals
}

// ─────────────────────────────────────────────────────────────────────────────
// 병원 요약 (GET /api/hospitals/[code]/devices/summary)
// ─────────────────────────────────────────────────────────────────────────────

export interface ContractedDeal {
  dealCode: string
  count: number
  roundNo: number
  contractDate: string | null
}

export interface ModelSummary {
  deviceInfoId: number
  deviceModel: string
  deviceName: string
  deviceClass: string
  onpremDeviceType: number | null
  /** 배치 중 전체(용도 무관) */
  active: number
  /** 배치 중 평가용(EVAL) — 계약 대조 제외 */
  activeEval: number
  /** 계약 대조용 = active − activeEval */
  activeForCompare: number
  recovered30d: number
  /** hard(ECG)·soft(SpO2)는 Σ계약완료 딜, none은 null */
  expected: number | null
  /** hard만 activeForCompare − expected, 그 외 null */
  diff: number | null
  compare: 'hard' | 'soft' | 'none'
  /** 배치 중 유닛의 WMS 일시 매칭 집계(out=OUT · inStock=IN_STOCK · unmatched=매치 없음) */
  wms: { out: number; inStock: number; unmatched: number }
  lastEvent: { type: string; on: string } | null
  /** 상품유형별 소계(B-22) — 키는 계약 딜 유형 ∪ 배치 유형(+'미지정'은 배치가 있을 때). expected는 그 유형 딜 Σ(ECG hard·SpO2 soft) */
  byProductType: Partial<Record<ProductTypeKey, ProductTypeCell>>
}

export interface ProductTypeCell {
  active: number
  activeForCompare: number
  expected: number | null
  diff: number | null
}

export interface SummaryWard {
  id: number
  name: string
  extWardCode: string | null
  isActive: boolean
  sortOrder: number
  /** 배치 중 기기 수 */
  active: number
}

export interface HospitalDeviceSummary {
  hospitalCode: string
  hospitalName: string
  introBeds: number | null
  expectedDeviceCount: number | null
  contractedDeals: ContractedDeal[]
  models: ModelSummary[]
  wards: SummaryWard[]
  /** 배치 중이면서 병동 미지정 */
  unassigned: number
  lastEventOn: string | null
  lastImportAt: string | null
  lastImport: { id: number; createdAt: string; occurredOn: string | null; rowCount: number; registeredCount: number } | null
  activeTotal: number
  /** 배치 중 평가용 합계 */
  evalTotal: number
  recovered30dTotal: number
  /** 서버 KST 오늘(YYYY-MM-DD) — 업무일자 기본값·미래 판정 */
  today: string
  /** 병원 계약완료 딜 기준 상품유형 문맥(등록 기본값·혼합 필수 — B-22) */
  productTypeContext: ProductTypeContext
  /** 계약 딜 2종이거나 배치에 상품유형이 있으면 true → 요약을 매트릭스로 */
  productTypeMixed: boolean
  /** 병원 단위 상품유형 축(ECG 기준) */
  productTypes: { type: ProductTypeKey; active: number; activeForCompare: number; expected: number | null; diff: number | null }[]
  /** 교체 건수(RECOVER 스냅샷 상품유형 기준) — 전체·최근 30일 */
  replacements: { total: number; byType: Record<ProductTypeKey, number>; last30d: { total: number; byType: Record<ProductTypeKey, number> } }
}

// ─────────────────────────────────────────────────────────────────────────────
// 개체 (GET /api/devices/units · /units/[id] · /lookup)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 기기 공개 형상(JSON) — 3층 구조(B-20): 유닛(`device_units`: id·deviceInfoId·serialNo·serialRaw·macAddress·memo·source)
 * + 배치 프로젝션(`hospital_devices`: 상태 컬럼)을 서버가 평탄화. **`id`는 device_units.id(공개 device id)**, `placementId`는 내부 배치 행 id.
 * 프로젝션은 이벤트 fold 파생값이며 UI가 직접 바꾸지 않는다
 */
export interface DeviceRaw {
  id: number
  placementId?: number
  deviceInfoId: number
  serialNo: string
  serialRaw: string | null
  macAddress: string | null
  extDeviceCode: string | null
  memo: string | null
  /** 유닛이 처음 생긴 경로(MANUAL/IMPORT/WMS/ONPREM/BACKFILL) */
  source?: string
  /** 용도(판매용 SALE / 평가용 EVAL) — 유닛 속성, null=미지정 */
  usageTypeId: number | null
  usageType: UsageTypeRef | null
  extLastSeenAt: string | null
  extSyncedAt: string | null
  status: DeviceStatus
  hospitalCode: string | null
  /** 현재 병원명 평탄화(전역 [디바이스] 뷰 표시용, 2026-09-01 추가 — 구 응답엔 없을 수 있어 optional) */
  hospitalName?: string | null
  wardId: number | null
  /** @db.Date → ISO 자정 문자열, `toYmd()`로 표시 */
  placedOn: string | null
  lastHospitalCode: string | null
  /** 마지막 병원명 평탄화(RECOVERED '회수 전 X') */
  lastHospitalName?: string | null
  recoveredOn: string | null
  recoverReasonId: number | null
  lastEventType: DeviceEventType | null
  lastEventOn: string | null
  replacedById: number | null
  /** 상품유형(일반/라이트) — 배치 속성(B-22), null=미지정. RECOVERED 행은 회수 전 마지막 값 */
  productType: ProductType | null
  createdAt: string
  updatedAt: string
}

/** UNITS_INCLUDE 조인 — lookup의 device/candidates 형상(추가 열 없음) */
export interface DeviceRowBase extends DeviceRaw {
  deviceInfo: DeviceInfoRef
  ward: { id: number; name: string; isActive: boolean } | null
  hospital: HospitalRef | null
  lastHospital: HospitalRef | null
  recoverReason: ReasonRef | null
  /** 교체기(유닛 id·시리얼) */
  replacedBy: { id: number; serialNo: string } | null
}

/** GET /api/devices/units 행 */
export interface DeviceListRow extends DeviceRowBase {
  /** 최근 상태 이벤트의 소프트 참조(MNT 링크 등) */
  lastRef: { type: string; code: string } | null
  /** 표시용 WMS 일시 매칭(DB 쓰기 없음) — '창고 개체' 열 */
  wms: WmsMatch | null
  /** = wms (구 필드명 호환) */
  wmsTransient: WmsMatch | null
  /** ACTIVE+IN_STOCK / DISPOSED ⚠ 문구 */
  wmsWarning: string | null
}

/** GET /api/devices/units/[id] → device */
export interface DeviceDetail extends DeviceRowBase {
  /** 이 개체가 대체한 구기기들(유닛 id·시리얼) */
  replaces: { id: number; serialNo: string }[]
  wms: WmsMatch | null
  wmsTransient: WmsMatch | null
  wmsWarning: string | null
}

export type UnitsStatusFilter = 'active' | 'recovered' | 'all'
export type UnitsWmsFilter = 'linked' | 'unlinked' | 'in_stock'
export type UnitsSort = 'ward' | 'serial' | 'placedOn' | 'lastEvent'
export type WardFilter = number | 'unassigned' | null

export interface UnitsQueryParams {
  hospital?: string | null
  model?: number | null
  ward?: WardFilter
  status?: UnitsStatusFilter
  q?: string | null
  wms?: UnitsWmsFilter | null
  /** 용도 — SALE | EVAL | none(미지정) */
  usage?: UsageFilter | null
  /** 상품유형 — 일반 | 라이트 | none(미지정) */
  productType?: ProductTypeFilter | null
  page?: number
  limit?: number
  sort?: UnitsSort
}

export interface UnitsResponse {
  data: DeviceListRow[]
  total: number
  page: number
  limit: number
}

/** `?idsOnly=1` — '검색 결과 전체 선택 N건' (≤2,000) */
export interface UnitIdsResponse {
  ids: number[]
  total: number
  truncated: boolean
  max: number
}

export interface UnitDetailResponse {
  device: DeviceDetail
  /** 병원 경계 무관 전체 이벤트 — 최신순(occurred_on DESC, id DESC) */
  events: DeviceDetailEvent[]
}

/** GET /api/devices/lookup?serial= */
export interface LookupWmsCandidate {
  unitId: number
  serialNo: string
  status: string
  inventoryName: string
  itemCode: string
  modelName: string | null
  linkedDeviceId: number | null
}

export interface LookupResponse {
  input: { serialNo: string; serialRaw: string | null }
  /** 정확 일치(키 또는 원문) */
  device: DeviceRowBase | null
  /** 0건일 때 원장 접두 일치 ≤10 */
  candidates: DeviceRowBase[]
  /** 0건일 때 WMS 정확·접미 일치 ≤10 (`linkedDeviceId`는 영속 링크가 없어 항상 null) */
  wmsCandidates: LookupWmsCandidate[]
}

// ─────────────────────────────────────────────────────────────────────────────
// 이벤트 (GET /api/devices/events · 드로어 events)
// ─────────────────────────────────────────────────────────────────────────────

/** CORRECT 이벤트 changes — { field: { before, after } } */
export type ChangeSet = Record<string, { before: unknown; after: unknown }>

/** hospital_device_events 스칼라(JSON) — move/recover/bulk/patch 응답의 `event` */
export interface DeviceEventRaw {
  id: number
  deviceId: number
  eventType: DeviceEventType
  hospitalCode: string | null
  fromWardId: number | null
  toWardId: number | null
  reasonCodeId: number | null
  /** 업무일자 @db.Date → ISO 자정 문자열 */
  occurredOn: string
  memo: string | null
  refType: RegistryRefType | null
  refCode: string | null
  relatedDeviceId: number | null
  actionGroup: string | null
  source: RegistrySource
  importBatchId: number | null
  changes: ChangeSet | null
  actorId: string | null
  /** 기록자 스냅샷 */
  actorName: string | null
  editedAt: string | null
  editedById: string | null
  /** 이벤트 시점 상품유형 스냅샷(REGISTER=지정값·MOVE/RECOVER=당시 배치 값·CORRECT=변경 후 값) */
  productType: ProductType | null
  /** 기록 시각 — 업무일자와 다르면 회색 병기(D7) */
  createdAt: string
}

/** 드로어(개체 상세) 이벤트 — device 조인 없음 */
export interface DeviceDetailEvent extends DeviceEventRaw {
  hospital: HospitalRef | null
  fromWard: WardRef | null
  toWard: WardRef | null
  reasonCode: ReasonRef | null
  relatedDevice: { id: number; serialNo: string } | null
  importBatch: { id: number; mode: string; fileName: string | null; cancelledAt: string | null } | null
}

/** 이력 탭·전역 최근 이벤트 행 */
export interface DeviceEvent extends DeviceDetailEvent {
  device: {
    id: number
    serialNo: string
    serialRaw: string | null
    status: DeviceStatus
    hospitalCode: string | null
    /** 현재 배치 상품유형(행 스냅샷과 비교용) */
    productType: ProductType | null
    deviceInfo: { id: number; deviceModel: string; deviceName: string; deviceClass: string }
    usageType: UsageTypeRef | null
  }
}

export interface EventsQueryParams {
  hospital?: string | null
  device?: number | null
  type?: DeviceEventType | null
  from?: string | null
  to?: string | null
  refType?: RegistryRefType | null
  refCode?: string | null
  batch?: number | null
  actionGroup?: string | null
  source?: RegistrySource | null
  q?: string | null
  page?: number
  limit?: number
}

export interface EventsResponse {
  data: DeviceEvent[]
  total: number
  page: number
  limit: number
}

// ─────────────────────────────────────────────────────────────────────────────
// 유지보수 자동완성 (GET /api/devices/maintenance-lookup)
// ─────────────────────────────────────────────────────────────────────────────

export interface MaintenanceLookupItem {
  id: number
  maintenanceCode: string
  title: string
  hospitalCode: string
  hospitalName: string
  statusName: string | null
  reportedAt: string | null
  resolvedAt: string | null
  visits: { startDate: string | null; endDate: string | null }[]
  /** 폼의 병원과 다른 병원으로 기록된 건 */
  hospitalMismatch: boolean
  /** §5c 규칙 제안(미래 제외) — null이면 제안 없음 */
  suggestedOccurredOn: string | null
  basis: OccurredOnBasis | null
}

export interface MaintenanceLookupResponse {
  data: MaintenanceLookupItem[]
  /** q가 MNT-YYYYMM-NNNN 정확 형식이었는지 */
  exact: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// 병동 (GET/POST /api/hospitals/[code]/wards · PUT/DELETE …/[id])
// ─────────────────────────────────────────────────────────────────────────────

export interface Ward {
  id: number
  hospitalCode: string
  name: string
  nameNorm: string
  extWardCode: string | null
  isActive: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
  /** 배치 중 기기 수 */
  activeCount: number
  /** 이 병동에서 나간 RECOVER 이벤트 누계 */
  recoveredCount: number
}

export interface WardsResponse {
  data: Ward[]
  total: number
  /** 병동 미지정 배치 중 기기 수 */
  unassigned: number
}

/** POST/PUT 응답의 ward(카운트 없음) */
export type WardRow = Omit<Ward, 'activeCount' | 'recoveredCount'>

export interface WardCreateBody {
  name: string
  extWardCode?: string | null
  sortOrder?: number
}

export interface WardUpdateBody {
  name?: string
  extWardCode?: string | null
  sortOrder?: number
  /** false는 admin + 배치 0대일 때만 */
  isActive?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// 쓰기 요청·응답 (register / replace / move / recover / bulk / patch)
// ─────────────────────────────────────────────────────────────────────────────

/** 모든 이벤트 쓰기 공통 문맥 필드 */
export interface RegistryFields {
  /** YYYY-MM-DD, 기본 오늘(KST), 미래 400 */
  occurredOn?: string | null
  memo?: string | null
  ref?: RegistryRef | null
}

export interface RegisterItemInput {
  /** 원문(정규화는 서버) */
  serialInput: string
  deviceInfoId?: number
  modelInput?: string
  wardId?: number
  wardName?: string
  memo?: string
  macAddress?: string
  extDeviceCode?: string
  /** 항목 용도(id) — 공통값보다 우선 */
  usageTypeId?: number
  /** 항목 용도 입력(문자열 '판매용'·'EVAL' 등 — 붙여넣기 열) */
  usageType?: string
  /** 항목 상품유형('일반'·'라이트'·'lite' 등 — 붙여넣기 열) — 공통값보다 우선 */
  productType?: string
}

export interface RegisterBody extends RegistryFields {
  /** 문자열(시리얼)만 넣어도 됨. 항목 병동/모델/용도가 공통값보다 우선 */
  items: (string | RegisterItemInput)[]
  /** 공통 모델(고정) */
  deviceInfoId?: number
  /** 공통 병동 */
  wardId?: number
  wardName?: string
  /** 공통 용도(폼 기본, 생략=미지정) — 신규 유닛에 부여, 기존 유닛은 비어 있을 때만 */
  usageTypeId?: number
  /** 공통 상품유형(일반/라이트) — 생략 시 서버 기본값 규칙(병원 딜 1종 → 그 값 · 0종 → 미지정 · 혼합 → 400 필수) */
  productType?: ProductType
  /** 타 병원 ACTIVE 시리얼의 이관 opt-in — { [serialNo]: 'TRANSFER' } */
  conflicts?: Record<string, 'TRANSFER'>
  /** 미리보기 행(1부터=items index+1) 액션 */
  rowActions?: Record<number, ImportRowAction>
  excludeRows?: number[]
  wardAliases?: Record<string, number>
}

export interface RegisteredRef {
  id: number
  serialNo: string
  eventId: number
  wardId: number | null
  productType?: ProductType | null
}

export interface TransferredRef extends RegisteredRef {
  fromHospitalCode: string
  recoverEventId: number
}

export interface SkippedItem {
  deviceId: number
  serialNo: string
  reason: string
}

/** 409 conflicts[] 항목 */
export interface Conflict {
  serial: string
  deviceId: number
  hospitalCode: string
  hospitalName: string | null
  wardName: string | null
  placedOn: string | null
}

/** 400/409 rows[] 항목(임포트·등록 미제외 오류·소급 불성립) */
export interface RegistryErrorRow {
  row: number
  serial: string
  message: string
}

/** POST …/devices/register 201 */
export interface RegisterResponse {
  actionGroup: string
  created: RegisteredRef[]
  reregistered: RegisteredRef[]
  transferred: TransferredRef[]
  skipped: SkippedItem[]
  warnings: string[]
  newWards: { id: number; name: string }[]
  eventIds: number[]
  /** deviceId → 매칭(JSON 키는 문자열) */
  wms: Record<string, WmsMatch | null>
}

/** POST …/devices/register?preview=true 200 — 임포트와 같은 판정 엔진 */
export interface RegisterPreviewResponse {
  rows: ImportPreviewRow[]
  summary: ImportPreviewSummary
  /** = summary.productTypeContext (폼 라벨 '계약 딜 기준 기본값: 라이트' / 혼합 → 필수) */
  productTypeContext: ProductTypeContext
}

export interface ReplaceBody extends RegistryFields {
  oldDeviceId?: number
  oldSerial?: string
  /** 구 기기가 원장에 없을 때 소급 등록용 */
  oldDeviceInfoId?: number
  oldWardId?: number
  oldWardName?: string
  newSerial: string
  newDeviceInfoId?: number
  /** 생략 시 구 기기 병동 */
  toWardId?: number
  toWardName?: string
  /** 생략 시 DEFECT */
  reasonCodeId?: number
  /** 신 시리얼이 타 병원 ACTIVE일 때 이관 opt-in */
  newConflict?: 'TRANSFER'
  /** 구 기기 소급 등록 시 용도 */
  oldUsageTypeId?: number
  /** 신 기기 용도 — 생략 시 구 기기 용도 승계 */
  newUsageTypeId?: number
  /** 상품유형 — 구 기기가 원장에 없어 소급 등록할 때만 적용(그 외 구 배치 값 상속, B-22) */
  productType?: ProductType
}

/** POST …/devices/replace 201 */
export interface ReplaceResponse {
  actionGroup: string
  /** 구 기기 소급 REGISTER(원장에 없던 경우) */
  backfilled: DeviceEventRaw | null
  recovered: DeviceEventRaw | null
  /** 신 시리얼 이관 시 상대 병원 RECOVER(TRANSFER) */
  transferRecovered: DeviceEventRaw | null
  registered: DeviceEventRaw | null
  /** 신 기기가 이미 이 병원 배치 중 → MOVE_WARD만 */
  movedNew: DeviceEventRaw | null
  linkedRecoverEventId: number | null
  eventIds: number[]
  oldDevice: DeviceRaw
  newDevice: DeviceRaw
  /** 신 배치에 적용된 상품유형 */
  productType: ProductType | null
  warnings: string[]
  wms: Record<string, WmsMatch | null>
}

export interface MoveBody extends RegistryFields {
  toWardId?: number
  toWardName?: string
}

/** POST /api/devices/units/[id]/move 201 */
export interface MoveResponse {
  event: DeviceEventRaw
  device: DeviceRaw
  fromWardId: number | null
  toWard: { id: number; name: string; isNew: boolean }
  warnings: string[]
}

export interface RecoverBody extends RegistryFields {
  reasonCodeId: number
}

/** POST /api/devices/units/[id]/recover 201 */
export interface RecoverResponse {
  event: DeviceEventRaw
  device: DeviceRaw
  fromWardId: number | null
  reason: ReasonRef
  warnings: string[]
}

export type BulkAction = 'MOVE_WARD' | 'RECOVER' | 'SET_PRODUCT_TYPE'

export interface BulkBody extends RegistryFields {
  action: BulkAction
  /** ≤2,000 */
  deviceIds: number[]
  toWardId?: number
  toWardName?: string
  reasonCodeId?: number
  /** SET_PRODUCT_TYPE — 일반/라이트(null=미지정으로) */
  productType?: ProductType | null
  /** 생략 시 선택 기기의 ACTIVE 병원에서 유도 */
  hospitalCode?: string
}

/** POST /api/devices/units/bulk 201 */
export interface BulkResponse {
  actionGroup: string
  hospitalCode: string
  events: DeviceEventRaw[]
  eventIds: number[]
  affectedDeviceIds: number[]
  /** 이미 대상 병동인 개체 등 */
  skipped: SkippedItem[]
  warnings: string[]
}

/** PATCH /api/devices/units/[id] — memo(write) / usageTypeId(write, CORRECT) / 식별 보정(admin, CORRECT 이벤트) */
export interface DevicePatchBody {
  memo?: string | null
  deviceInfoId?: number
  serialNo?: string
  macAddress?: string | null
  extDeviceCode?: string | null
  /** 용도 id(null=미지정) — USER+ 허용, CORRECT 이벤트 기록 */
  usageTypeId?: number | null
  /** 상품유형(일반/라이트, null=미지정) — USER+ 허용, CORRECT 이벤트 기록(배치 속성 B-22) */
  productType?: ProductType | null
  /** CORRECT 이벤트 문맥(식별 보정 시) */
  occurredOn?: string
  ref?: RegistryRef | null
}

export interface DevicePatchResponse {
  device: DeviceRaw
  event?: DeviceEventRaw
  changes?: ChangeSet
  wms?: WmsMatch | null
  memo?: { before: string | null; after: string | null }
}

/** PATCH /api/devices/events/[id] (admin) — §8.2 허용 필드만 */
export interface EventPatchBody {
  occurredOn?: string
  memo?: string | null
  /** RECOVER만 */
  reasonCodeId?: number
  ref?: RegistryRef | null
  /** REGISTER/MOVE_WARD만 */
  toWardId?: number | null
  /** RECOVER만 */
  fromWardId?: number | null
}

export interface EventPatchResponse {
  event: DeviceEventRaw
  device: DeviceRaw
}

/** DELETE /api/devices/events/[id] (admin) — 마지막 이벤트 취소(LIFO, 쌍 동시 취소) */
export interface EventCancelResponse {
  cancelledEventIds: number[]
  deletedDeviceIds: number[]
  restoredDevices: { id: number; serialNo: string; status: DeviceStatus; hospitalCode: string | null }[]
  affectedDeviceIds: number[]
  batchAdjustments: { batchId: number; serialNo: string; kind: 'new' | 'reregister' | 'transfer' }[]
  /** CORRECT 취소 시 복원된 식별 컬럼 */
  restored: ChangeSet | null
}

// ─────────────────────────────────────────────────────────────────────────────
// 임포트 (POST …/devices/import[?preview=true] · GET …/devices/imports · PATCH/POST …/imports/[id])
// ─────────────────────────────────────────────────────────────────────────────

export interface ImportPreviewExisting {
  deviceId: number
  status: DeviceStatus
  hospitalCode: string | null
  hospitalName: string | null
  wardName: string | null
  placedOn: string | null
  lastHospitalCode: string | null
  lastHospitalName: string | null
  recoveredOn: string | null
  recoverReason: string | null
  recoverReasonValue: string | null
}

/** 서버 판정 행(§7.2) — 등록 폼 실시간 판별도 같은 형상 */
export interface ImportPreviewRow {
  /** 시트 실제 행 번호 / 붙여넣기 줄 번호 / 등록 폼 items index+1 */
  row: number
  serialInput: string
  serialNo: string
  serialRaw: string | null
  deviceInfoId: number | null
  deviceModel: string | null
  /** 해석된 용도(행 입력 > 폼 기본 > 기존 유닛 값), null=미지정 */
  usageTypeId: number | null
  usageTypeName: string | null
  /** 해석된 상품유형(행 입력 > 폼 기본 > 병원 딜 규칙), null=미지정(혼합 병원이면 error 판정) */
  productType: ProductType | null
  wardInput: string | null
  wardId: number | null
  wardName: string | null
  wardNew: boolean
  wardInactive: boolean
  org: string | null
  status: ImportVerdict
  defaultExcluded: boolean
  /** excludeRows가 주어지면 그 기준, 아니면 defaultExcluded */
  excluded: boolean
  messages: string[]
  /** 이 행에 허용되는 액션 */
  actions: ImportRowAction[]
  /** 적용된 액션 */
  action: ImportRowAction | null
  existing: ImportPreviewExisting | null
  wms: WmsMatch | null
  memo: string | null
  macAddress: string | null
  extDeviceCode: string | null
  /** 실행 시 실제로 이벤트를 만드는 행 */
  executable: boolean
  extWardCodeToSet: string | null
}

export interface ImportPreviewSummary {
  total: number
  ok: number
  reregister: number
  skip: number
  warn: number
  conflict: number
  error: number
  excluded: number
  executable: number
  transfer: number
  /** 생성 예정 병동(입력명 기준) — wardAliases로 기존 병동 매핑 가능 */
  newWards: { name: string; nameNorm: string; rows: number; fromCode: boolean }[]
  wardAliases: Record<string, number>
  /** 초안 모드 기관 코드 분포(≥2면 orgs 선택 필수) */
  orgs: { org: string; rows: number; selected: boolean }[]
  occurredOn: string
  mode: ImportBatchMode
  productTypeContext: ProductTypeContext
}

export type ImportInputFormat = 'excel' | 'excel_headerless' | 'onprem_excel' | 'paste' | 'onprem_json' | 'onprem_table'

/** preview 응답 input — 파서가 본 입력 형상 */
export interface ImportInputInfo {
  format: ImportInputFormat
  /** 온프렘 export로 감지 → 초안 모드 제안 */
  onprem: boolean
  header: boolean
  columns: OnpremHeaderMap | null
  overflow: boolean
  sourceKind: ImportSourceKind
  fileName: string | null | undefined
  rowCount: number
  mode: ImportBatchMode
}

export interface ImportPreviewResponse {
  rows: ImportPreviewRow[]
  summary: ImportPreviewSummary
  input: ImportInputInfo
}

export type ImportWardMode = 'column' | 'fixed'
export type ImportEmptyWardCell = 'warn' | 'error'

/** 임포트 옵션 — multipart 필드(문자열/JSON 문자열) 또는 JSON body({ text, …options }) */
export interface ImportOptions {
  mode?: ImportBatchMode
  deviceInfoId?: number
  /** 폼 공통 용도(행 용도 열이 없을 때 적용) */
  usageTypeId?: number
  /** 폼 공통 상품유형(F열/붙여넣기 셀이 없을 때) — 생략 시 병원 딜 기본값 규칙 */
  productType?: ProductType
  wardMode?: ImportWardMode
  wardId?: number
  emptyWardCell?: ImportEmptyWardCell
  occurredOn?: string
  excludeRows?: number[]
  rowActions?: Record<number, ImportRowAction>
  wardAliases?: Record<string, number>
  /** 초안 모드 선택 org(null/생략 = 미지정) */
  orgs?: string[] | null
  memo?: string
  fileName?: string
}

export interface ImportBatchRaw {
  id: number
  hospitalCode: string
  sourceKind: ImportSourceKind
  mode: ImportBatchMode
  fileName: string | null
  occurredOn: string
  note: string | null
  rowCount: number
  registeredCount: number
  reregisteredCount: number
  skippedCount: number
  transferredCount: number
  /** { preview: ImportPreviewSummary, newWards, wardAliases, orgs, excludeRows, rowActions, warnings, cancelledRows } */
  summary: ImportBatchSummaryJson | null
  createdById: string | null
  createdAt: string
  cancelledAt: string | null
  cancelledById: string | null
  cancelSummary: CancelBatchSummary | null
}

export interface ImportBatchSummaryJson {
  preview: ImportPreviewSummary
  newWards: { id: number; name: string }[]
  wardAliases: Record<string, number>
  orgs: string[] | null
  excludeRows: number[]
  rowActions: Record<number, ImportRowAction>
  warnings: string[]
  cancelledRows: unknown[]
}

export interface CancelBatchSummary {
  serials: string[]
  restoredDeviceIds: number[]
  restoredTransfers: { deviceId: number; serialNo: string; hospitalCode: string }[]
  newWardsKept: unknown[]
  correctedSerials: string[]
  deletedDeviceIds: number[]
  eventCount: number
}

/** GET …/devices/imports 행 */
export interface ImportBatch extends ImportBatchRaw {
  createdBy: { id: string; name: string } | null
  cancelledBy: { id: string; name: string } | null
  createdByName: string | null
  cancelledByName: string | null
}

export interface ImportBatchesResponse {
  data: ImportBatch[]
  total: number
  page: number
  limit: number
}

/** POST …/devices/import 201 */
export interface ImportExecuteResponse {
  batch: ImportBatchRaw
  result: RegisterResponse
  /** 서버 재검증 요약 */
  summary: ImportPreviewSummary
  warnings: string[]
}

/** PATCH …/imports/[batchId] 200 */
export interface ImportBatchDateResponse {
  batch: ImportBatchRaw
  before: string
  after: string
  eventCount: number
  deviceCount: number
}

/** POST …/imports/[batchId]/cancel 200 */
export interface ImportBatchCancelResponse {
  batch: ImportBatchRaw
  summary: CancelBatchSummary
}

// ─────────────────────────────────────────────────────────────────────────────
// 화면 상태 (orchestrator ↔ 탭/모달 계약)
// ─────────────────────────────────────────────────────────────────────────────

/** 메인 탭(2026-09-01 v1 단순화) — `?view=hospital|devices`. 병원별 뷰(기본) / 전 기기 평면 목록 */
export type DevicesView = 'hospital' | 'devices'
export const DEVICE_VIEWS: readonly DevicesView[] = ['hospital', 'devices']
export const DEVICE_VIEW_LABELS: Record<DevicesView, string> = {
  hospital: '병원별',
  devices: '디바이스',
}

export type HospitalTab = 'list' | 'history' | 'wards' | 'import'
/** 구 전역 탭(커버리지·최근 이벤트) — v1 UI에서는 노출하지 않음(URL 구 링크는 기본값으로 매핑). 컴포넌트 계약 보존용 */
export type GlobalTab = 'coverage' | 'events'
export type DevicesTab = HospitalTab | GlobalTab

export const HOSPITAL_TABS: readonly HospitalTab[] = ['list', 'history', 'wards', 'import']
export const GLOBAL_TABS: readonly GlobalTab[] = ['coverage', 'events']

export const HOSPITAL_TAB_LABELS: Record<HospitalTab, string> = {
  list: '기기 목록',
  history: '이력',
  wards: '병동',
  import: '임포트',
}

export const GLOBAL_TAB_LABELS: Record<GlobalTab, string> = {
  coverage: '병원 커버리지',
  events: '최근 이벤트',
}

/** 기기 목록 탭 필터 — status/model/ward/q/page는 URL 동기화, sort/wms/usage/limit는 로컬 */
export interface ListFilters {
  status: UnitsStatusFilter
  model: number | null
  ward: WardFilter
  q: string
  page: number
  limit: number
  sort: UnitsSort
  wms: UnitsWmsFilter | null
  usage: UsageFilter | null
  productType: ProductTypeFilter | null
}

/** 전역 [디바이스] 뷰(v1 단순화) 필터 — 전부 URL 동기화(`?view=devices&status=&model=&usage=&productType=&q=&page=`) */
export interface GlobalListFilters {
  status: UnitsStatusFilter
  model: number | null
  usage: UsageFilter | null
  productType: ProductTypeFilter | null
  /** 시리얼(키·원문·닉네임) 또는 병원명 */
  q: string
  page: number
}

/** 이력 탭·전역 최근 이벤트 필터 — q/page는 URL 동기화, 나머지 로컬 */
export interface EventFilters {
  q: string
  page: number
  limit: number
  type: DeviceEventType | null
  /** YYYY-MM-DD */
  from: string | null
  to: string | null
  refType: RegistryRefType | null
  source: RegistrySource | null
}

/** 전역 커버리지 필터 — q/page는 URL 동기화, filter/sort는 로컬 */
export interface CoverageFilters {
  filter: CoverageFilter
  sort: CoverageSort
  q: string
  page: number
  limit: number
}

/** 선택·모달 대상 기기 — 목록 행/드로어/조회 결과 어디서 와도 이 형상으로 축약 */
export interface DeviceRef {
  id: number
  serialNo: string
  deviceInfoId: number | null
  deviceModel: string | null
  deviceName: string | null
  wardId: number | null
  wardName: string | null
  status: DeviceStatus
  hospitalCode: string | null
  /** 용도(모달 기본값용) — 조회 결과에 없으면 undefined */
  usageTypeId?: number | null
  usageTypeName?: string | null
  /** 배치 상품유형(교체 폼 '구 기기와 동일' 표시용) */
  productType?: ProductType | null
}

/**
 * 선택 상태 — id → DeviceRef. '검색 결과 전체 선택'(idsOnly)으로 들어온 id는 행이 없어 null.
 * (Set<number> 대신 Map: 탭 전환 후에도 모달 칩에 시리얼을 보여주기 위함)
 */
export type Selection = Map<number, DeviceRef | null>

/** 행 ⋯·드로어 버튼·모바일 액션바가 orchestrator에 요청하는 동작 */
export type DeviceAction = 'move' | 'recover' | 'replace' | 'correct'

/** 모달/패널이 쓰기 성공 후 orchestrator에 넘기는 결과 — 토스트 + onMutated + 선택 해제 */
export interface MutationDone {
  /** 토스트 문구 — 예: '교체 기록: P018363 회수(불량) · P020418 등록(3병동)' */
  message: string
  /** 있으면 드로어를 이 기기로 연다(교체 후 신 기기 등) */
  openDeviceId?: number | null
  /** 서버 warnings[] — 토스트 아래 보조 문구 */
  warnings?: string[]
}

/** 시리얼 조회 결과로 orchestrator가 이동할 대상 */
export interface LookupNavigateTarget {
  /** ACTIVE → hospitalCode, RECOVERED → lastHospitalCode(없으면 null: 병원 미선택 상태에서 드로어만) */
  hospitalCode: string | null
  deviceId: number
  status: DeviceStatus
}

/** 병동 콤보 값 — 기존 병동(wardId) 또는 새 병동명(wardName). 둘 다 없으면 미지정 */
export interface WardValue {
  wardId?: number | null
  wardName?: string | null
}

/** 병동 콤보 옵션 — Ward(병동 탭)·SummaryWard(요약) 어느 쪽에서도 축약 가능 */
export interface WardOption {
  id: number
  name: string
  isActive: boolean
  extWardCode?: string | null
  activeCount?: number
}

export function toWardOption(w: Ward | SummaryWard): WardOption {
  return {
    id: w.id,
    name: w.name,
    isActive: w.isActive,
    extWardCode: w.extWardCode,
    activeCount: 'activeCount' in w ? w.activeCount : w.active,
  }
}

export function toDeviceRef(d: DeviceRowBase | DeviceListRow | DeviceDetail): DeviceRef {
  return {
    id: d.id,
    serialNo: d.serialNo,
    deviceInfoId: d.deviceInfoId,
    deviceModel: d.deviceInfo?.deviceModel ?? null,
    deviceName: d.deviceInfo?.deviceName ?? null,
    wardId: d.wardId,
    wardName: d.ward?.name ?? null,
    status: d.status,
    hospitalCode: d.hospitalCode,
    usageTypeId: d.usageTypeId ?? null,
    usageTypeName: d.usageType?.name ?? null,
    productType: d.productType ?? null,
  }
}
