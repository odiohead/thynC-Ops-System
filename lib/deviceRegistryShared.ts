/**
 * 디바이스 원장(Device Registry) 공용 상수·순수 함수 — projects/hospital_device_registry_design.md §5c
 *
 * 클라이언트/서버 공용 — prisma 미의존(`lib/ticket-shared.ts` 패턴). 서버 전용 서비스(유일한 쓰기자)는 `lib/deviceRegistry.ts`,
 * 접근 게이트는 `lib/deviceRegistryAccess.ts`.
 *
 * - 상태·이벤트 타입·전이표·라벨: 여기 + DB CHECK (하드코딩 금지 — `assertTransition`은 이 표만 본다)
 * - source·ref_type(+링크)·device_class·배치 mode·온프렘 코드표·임포트 판정: 여기만 (CHECK 없음 — 상수 1줄로 확장)
 * - normalizeSerial·parseSerialLines·detectOnpremHeader·normalizeWardName·suggestOccurredOnFromMaintenance:
 *   서버(미리보기·실행)·클라이언트(폼 실시간 판별)·후속 유지보수 라우트가 같은 함수를 쓴다
 * - 모델별 시리얼 형식·플래그는 `device_info` 행, 회수 사유는 StatusCode `DEVICE_RECOVERY_REASON`(value가 시스템 의미)
 */

// ─────────────────────────────────────────────────────────────────────────────
// 상태 · 이벤트 타입 · 전이표 (§4.2)
// ─────────────────────────────────────────────────────────────────────────────

export const DEVICE_STATUS = ['ACTIVE', 'RECOVERED'] as const
export type DeviceStatus = (typeof DEVICE_STATUS)[number]

export const DEVICE_STATUS_LABELS: Record<DeviceStatus, string> = {
  ACTIVE: '배치 중',
  RECOVERED: '회수됨',
}

export const DEVICE_STATUS_COLORS: Record<DeviceStatus, string> = {
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  RECOVERED: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

/**
 * 배치(placement) 단위 상태 표시 라벨 (2026-09-02 결정 B-24)
 * - ACTIVE는 개체 단위 표시에서 '사용중'으로 읽고, `as_started_on`이 있으면 'AS진행중'으로 읽는다(제3의 fold 상태가 아니라 ACTIVE의 플래그).
 * - '배치 중'(DEVICE_STATUS_LABELS.ACTIVE)은 집계 수치 문구에만 계속 쓴다.
 */
export const PLACEMENT_STATUS_ACTIVE_LABEL = '사용중'
export const PLACEMENT_STATUS_AS_LABEL = 'AS진행중'

export function placementStatusLabel(row: { status: string; asStartedOn?: string | Date | null }): string {
  if (row.status === 'RECOVERED') return DEVICE_STATUS_LABELS.RECOVERED
  return row.asStartedOn ? PLACEMENT_STATUS_AS_LABEL : PLACEMENT_STATUS_ACTIVE_LABEL
}

export const DEVICE_EVENT_TYPES = ['REGISTER', 'MOVE_WARD', 'RECOVER', 'CORRECT', 'AS_OPEN', 'AS_CLEAR'] as const
export type DeviceEventType = (typeof DEVICE_EVENT_TYPES)[number]

export const DEVICE_EVENT_TYPE_LABELS: Record<DeviceEventType, string> = {
  REGISTER: '등록',
  MOVE_WARD: '병동 이동',
  RECOVER: '회수',
  CORRECT: '정정',
  AS_OPEN: 'AS 접수', // 액션 용어(2026-09-02 개정) — 상태 라벨 'AS진행중'·코드 AS_OPEN은 불변
  AS_CLEAR: 'AS 해제',
}

export const DEVICE_EVENT_TYPE_COLORS: Record<DeviceEventType, string> = {
  REGISTER: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  MOVE_WARD: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  RECOVER: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  CORRECT: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  AS_OPEN: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
  AS_CLEAR: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
}

/**
 * 상태 이벤트(fold 전이·`last_event_type` 대상) — CORRECT는 식별 속성만 바꾸고 전이가 없다.
 * AS_OPEN/AS_CLEAR(B-24)는 **비상태 표시 이벤트**: ACTIVE 배치의 `as_started_on` 플래그만 접고(fold),
 * CORRECT처럼 `last_event_type/on`·stateEventCount·요약 '최근 이벤트'에서 제외한다(마커일 뿐 자리의 이력이 아님).
 */
export const DEVICE_STATE_EVENT_TYPES: readonly DeviceEventType[] = ['REGISTER', 'MOVE_WARD', 'RECOVER']

/**
 * 전이표 행 키 — §4.2 표의 4행.
 * ACTIVE는 "이벤트를 기록하려는 병원"과 현재 배치 병원의 일치 여부로 갈린다(개체 라우트는 항상 SAME — 병원을 개체에서 유도).
 */
export type TransitionFrom = 'NONE' | 'ACTIVE_SAME' | 'ACTIVE_OTHER' | 'RECOVERED'

/**
 * 전이 판정 결과
 * - ok        : 이벤트 기록 진행 (NONE+REGISTER는 행 생성)
 * - skip      : 변경 없음 — 같은 병원 ACTIVE에 REGISTER (§7.3: 단건/전부 skip이면 409, 일부면 201+skipped[], 임포트는 skip 집계)
 * - conflict  : 타 병원 ACTIVE — 409 + conflicts[] (REGISTER는 이관 opt-in으로 RECOVER TRANSFER + REGISTER)
 * - invalid   : 상태상 불가 — 409
 * - not_found : 원장에 없는 기기 — 404
 */
export type TransitionOutcome = 'ok' | 'skip' | 'conflict' | 'invalid' | 'not_found'

export const DEVICE_TRANSITIONS: Record<TransitionFrom, Record<DeviceEventType, TransitionOutcome>> = {
  NONE: { REGISTER: 'ok', MOVE_WARD: 'not_found', RECOVER: 'not_found', CORRECT: 'not_found', AS_OPEN: 'not_found', AS_CLEAR: 'not_found' },
  ACTIVE_SAME: { REGISTER: 'skip', MOVE_WARD: 'ok', RECOVER: 'ok', CORRECT: 'ok', AS_OPEN: 'ok', AS_CLEAR: 'ok' },
  ACTIVE_OTHER: { REGISTER: 'conflict', MOVE_WARD: 'conflict', RECOVER: 'conflict', CORRECT: 'ok', AS_OPEN: 'conflict', AS_CLEAR: 'conflict' },
  RECOVERED: { REGISTER: 'ok', MOVE_WARD: 'invalid', RECOVER: 'invalid', CORRECT: 'ok', AS_OPEN: 'invalid', AS_CLEAR: 'invalid' },
}

/** 판정 → HTTP 상태 (ok·skip은 호출부 규약에 따름 — skip은 단건/전부일 때만 409) */
export const TRANSITION_OUTCOME_STATUS: Record<Exclude<TransitionOutcome, 'ok'>, 404 | 409> = {
  skip: 409,
  conflict: 409,
  invalid: 409,
  not_found: 404,
}

/** 판정별 기본 오류 문구 (서비스 `assertTransition`·폼 인라인 오류 공용) */
export function transitionMessage(from: TransitionFrom, eventType: DeviceEventType): string | null {
  const outcome = DEVICE_TRANSITIONS[from][eventType]
  switch (outcome) {
    case 'ok':
      return null
    case 'skip':
      return '이미 이 병원에 배치 중인 시리얼입니다'
    case 'not_found':
      return '기기 현황에 등록되지 않은 기기입니다'
    case 'conflict':
      return eventType === 'REGISTER'
        ? '다른 병원에 배치 중인 시리얼입니다 — 이관 처리를 지정하거나 그 병원에서 먼저 회수 기록하세요'
        : '다른 병원에 배치 중인 기기입니다 — 그 병원에서 처리하세요'
    case 'invalid':
      if (eventType === 'MOVE_WARD') return '회수된 기기는 병동을 이동할 수 없습니다 — 먼저 재등록하세요'
      if (eventType === 'AS_OPEN' || eventType === 'AS_CLEAR') return '회수된 기기에는 AS 접수·해제를 할 수 없습니다'
      return '이미 회수된 기기입니다'
  }
}

/** 현재 상태(+병원 일치 여부) → 전이표 행 키. `sameHospital` 생략 시 같은 병원으로 본다(개체 라우트 문맥). */
export function resolveTransitionFrom(status: DeviceStatus | null | undefined, sameHospital: boolean = true): TransitionFrom {
  if (!status) return 'NONE'
  if (status === 'RECOVERED') return 'RECOVERED'
  return sameHospital ? 'ACTIVE_SAME' : 'ACTIVE_OTHER'
}

export function transitionOutcome(
  status: DeviceStatus | null | undefined,
  eventType: DeviceEventType,
  opts?: { sameHospital?: boolean }
): TransitionOutcome {
  return DEVICE_TRANSITIONS[resolveTransitionFrom(status, opts?.sameHospital ?? true)][eventType]
}

/** §4.2 표 그대로 — 진행 가능(ok)이면 true. skip·conflict·invalid·not_found는 전부 false (세부는 `transitionOutcome`). */
export function canTransition(
  status: DeviceStatus | null | undefined,
  eventType: DeviceEventType,
  opts?: { sameHospital?: boolean }
): boolean {
  return transitionOutcome(status, eventType, opts) === 'ok'
}

// ─────────────────────────────────────────────────────────────────────────────
// 출처 · 소프트 참조 · 분류 · 배치 · 온프렘 코드 · 임포트 판정 (CHECK 없음 — 상수만)
// ─────────────────────────────────────────────────────────────────────────────

/** 이벤트·유닛 `source` 어휘 — BACKFILL은 유닛 생성 경로(교체 시 구기기 소급 등록)에만 쓴다 */
export const REGISTRY_SOURCES = ['MANUAL', 'IMPORT', 'WMS', 'ONPREM', 'BACKFILL'] as const
export type RegistrySource = (typeof REGISTRY_SOURCES)[number]

export const REGISTRY_SOURCE_LABELS: Record<RegistrySource, string> = {
  MANUAL: '수동',
  IMPORT: '임포트',
  WMS: 'WMS',
  ONPREM: '온프렘',
  BACKFILL: '소급',
}

/** 멱등 부분 UNIQUE(ref_type, ref_code, device_id, event_type)가 적용되는 자동 출처 (§4.1-8 — MANUAL은 제외) */
export const IDEMPOTENT_SOURCES: readonly RegistrySource[] = ['WMS', 'ONPREM']

export const REGISTRY_REF_TYPES = ['MAINTENANCE', 'VOC', 'INVENTORY_TX', 'ONPREM_SYNC', 'AS'] as const // AS: AS접수(as_receipts) — 2026-09-04 AS업무 도메인
export type RegistryRefType = (typeof REGISTRY_REF_TYPES)[number]

export const REGISTRY_REF_TYPE_LABELS: Record<RegistryRefType, string> = {
  MAINTENANCE: '유지보수',
  VOC: 'VOC',
  INVENTORY_TX: '입출고 전표',
  ONPREM_SYNC: '온프렘 동기화',
  AS: 'AS접수',
}

/**
 * 소프트 참조 → 화면 링크. 유지보수·VOC·전표 상세는 숫자 id 라우팅(`lib/ticket-domains/meta.ts` detailHref)이라
 * 코드만 가진 이벤트는 목록 검색 링크로 보낸다. ONPREM_SYNC는 화면이 없어 null.
 */
export function refLink(type: RegistryRefType | string | null | undefined, code: string | null | undefined): string | null {
  if (!type || !code) return null
  const q = encodeURIComponent(code)
  switch (type) {
    case 'MAINTENANCE':
      return `/maintenances?search=${q}`
    case 'VOC':
      return `/voc?q=${q}`
    case 'INVENTORY_TX':
      return `/inventory/transactions?code=${q}`
    case 'AS':
      return `/as-receipts?q=${q}`
    default:
      return null
  }
}

export const DEVICE_CLASSES = ['WEARABLE', 'GATEWAY', 'THIRD_PARTY'] as const
export type DeviceClass = (typeof DEVICE_CLASSES)[number]

export const DEVICE_CLASS_LABELS: Record<DeviceClass, string> = {
  WEARABLE: '웨어러블',
  GATEWAY: '게이트웨이',
  THIRD_PARTY: '제3자 기기',
}

export const IMPORT_BATCH_MODES = ['REGISTER', 'ONPREM_DRAFT'] as const
export type ImportBatchMode = (typeof IMPORT_BATCH_MODES)[number]

export const IMPORT_BATCH_MODE_LABELS: Record<ImportBatchMode, string> = {
  REGISTER: '신규 등록',
  ONPREM_DRAFT: '온프렘 export 초안',
}

/** `hospital_device_import_batches.source_kind` (DB CHECK 있음) */
export const IMPORT_SOURCE_KINDS = ['EXCEL', 'PASTE'] as const
export type ImportSourceKind = (typeof IMPORT_SOURCE_KINDS)[number]

export const IMPORT_SOURCE_KIND_LABELS: Record<ImportSourceKind, string> = {
  EXCEL: 'Excel',
  PASTE: '붙여넣기',
}

/** 온프렘 `deviceType` 코드 → 제품 축약명 (device_info.onprem_device_type — 2·6은 MT100D/MBP100U 미시드) */
export const ONPREM_DEVICE_TYPES: Record<number, string> = {
  1: 'ECG',
  2: 'TEMP',
  3: 'SpO2',
  6: 'BP',
  8: 'TAG',
  10: 'RING',
  11: 'CHARM',
}

export const ONPREM_DEVICE_TYPE_LABELS: Record<number, string> = {
  1: '심전계',
  2: '체온계',
  3: '산소포화도',
  6: '혈압계',
  8: 'RTLS 태그',
  10: '링 혈압계',
  11: '참 혈압계',
}

export const IMPORT_VERDICTS = ['ok', 'reregister', 'skip', 'warn', 'conflict', 'error'] as const
export type ImportVerdict = (typeof IMPORT_VERDICTS)[number]

export const IMPORT_VERDICT_LABELS: Record<ImportVerdict, string> = {
  ok: '정상',
  reregister: '재등록',
  skip: '건너뜀',
  warn: '경고',
  conflict: '충돌',
  error: '오류',
}

export const IMPORT_VERDICT_COLORS: Record<ImportVerdict, string> = {
  ok: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  reregister: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  skip: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  warn: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  conflict: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

/** 임포트 행 액션(§7.2) — TRANSFER는 conflict 전용, UNASSIGN_WARD는 폐쇄·미매칭 병동 error 전용 */
export const IMPORT_ROW_ACTIONS = ['TRANSFER', 'UNASSIGN_WARD'] as const
export type ImportRowAction = (typeof IMPORT_ROW_ACTIONS)[number]

/** 미리보기·붙여넣기·Excel 행 상한 (§7.1 import MAX 2,000) */
export const IMPORT_MAX_ROWS = 2000

/** 회수 사유 StatusCode 카테고리 + 시스템 의미 value 5종 (§5c — value 행·사용 중 행 삭제 불가) */
export const RECOVERY_REASON_CATEGORY = 'DEVICE_RECOVERY_REASON'

export const RECOVERY_REASON_VALUES = ['DEFECT', 'LOST', 'RETURN', 'DISPOSE', 'TRANSFER'] as const
export type RecoveryReasonValue = (typeof RECOVERY_REASON_VALUES)[number]

/** value별 기본 표시명 — 실제 표시는 status_codes.name(설정에서 편집), 마스터 조인 불가 시 폴백용 */
export const RECOVERY_REASON_FALLBACK_LABELS: Record<RecoveryReasonValue, string> = {
  DEFECT: '불량(AS 회수)',
  LOST: '분실',
  RETURN: '반납',
  DISPOSE: '폐기',
  TRANSFER: '이관',
}

// ─────────────────────────────────────────────────────────────────────────────
// 용도(usage type) — StatusCode DEVICE_USAGE_TYPE (2026-09-01 결정: 판매용/평가용 2값, NULL=미지정)
// 유닛(device_units) 속성 — 위치가 아닌 물건의 속성. 계약 대조(§9.1)에서 EVAL은 제외한다. '대웅제약재고'는 판매용 창고이지 제3의 값이 아님
// ─────────────────────────────────────────────────────────────────────────────

export const DEVICE_USAGE_TYPE_CATEGORY = 'DEVICE_USAGE_TYPE'

export const USAGE_TYPE_VALUES = ['SALE', 'EVAL'] as const
export type UsageTypeValue = (typeof USAGE_TYPE_VALUES)[number]

/** value별 기본 표시명 — 실제 표시는 status_codes.name(설정에서 편집), 마스터 조인 불가 시 폴백용 */
export const USAGE_TYPE_LABELS: Record<UsageTypeValue, string> = {
  SALE: '판매용',
  EVAL: '평가용',
}

export const USAGE_TYPE_UNSET_LABEL = '미지정'

/** 임포트·등록 입력 별칭(대소문자·공백 무시) → value. name 정확 일치는 `matchUsageType`이 마스터로 처리 */
export const USAGE_TYPE_INPUT_ALIASES: Record<UsageTypeValue, readonly string[]> = {
  SALE: ['SALE', '판매용', '판매'],
  EVAL: ['EVAL', '평가용', '평가'],
}

export const USAGE_TYPE_INVALID_MESSAGE = '용도 값이 올바르지 않습니다 (판매용/평가용)'

export interface UsageTypeRef {
  id: number
  name: string
  value: string | null
}

/** 목록 필터 `usage=` 어휘 — SALE/EVAL(value) 또는 none(미지정) */
export const USAGE_FILTERS = ['SALE', 'EVAL', 'none'] as const
export type UsageFilter = (typeof USAGE_FILTERS)[number]

function normUsageToken(s: string): string {
  return s.normalize('NFC').replace(/[\s　]+/g, '').toUpperCase()
}

/** 입력 토큰이 용도 별칭인가(붙여넣기 열 판별용 — '평가용'·'EVAL' 등) */
export function isUsageTypeToken(s: string | null | undefined): boolean {
  if (!s) return false
  const t = normUsageToken(s)
  return USAGE_TYPE_VALUES.some((v) => USAGE_TYPE_INPUT_ALIASES[v].some((a) => normUsageToken(a) === t))
}

/** 입력 토큰 → value (별칭 매칭). 미매칭 null */
export function usageValueFromInput(s: string | null | undefined): UsageTypeValue | null {
  if (!s) return null
  const t = normUsageToken(s)
  return USAGE_TYPE_VALUES.find((v) => USAGE_TYPE_INPUT_ALIASES[v].some((a) => normUsageToken(a) === t)) ?? null
}

/**
 * 입력 문자열 → 용도 마스터 행. value 별칭(SALE/EVAL/판매용/평가용…) → 마스터 name 정확 일치(공백 무시) 순.
 * 빈 입력은 null(미지정), 미매칭은 undefined(호출부가 오류 판정 — `USAGE_TYPE_INVALID_MESSAGE`).
 */
export function matchUsageType<T extends UsageTypeRef>(types: readonly T[], input: string | null | undefined): T | null | undefined {
  const raw = (input ?? '').trim()
  if (!raw) return null
  const value = usageValueFromInput(raw)
  if (value) {
    const byValue = types.find((t) => t.value === value)
    if (byValue) return byValue
  }
  const key = normUsageToken(raw)
  return types.find((t) => normUsageToken(t.name) === key || (t.value != null && normUsageToken(t.value) === key))
}

/** 용도 라벨 — 마스터 name 우선, 없으면 value 폴백, 미지정은 '—'(dash=false면 '미지정') */
export function usageTypeLabel(u: UsageTypeRef | null | undefined, opts?: { unset?: string }): string {
  if (!u) return opts?.unset ?? USAGE_TYPE_UNSET_LABEL
  return u.name || (u.value && u.value in USAGE_TYPE_LABELS ? USAGE_TYPE_LABELS[u.value as UsageTypeValue] : u.value) || '—'
}

// ─────────────────────────────────────────────────────────────────────────────
// 상품유형(product type) — 일반/라이트 (2026-09-01 결정 B-22, `sales_deals.product_type`과 같은 어휘, NULL=미지정)
// **자리의 판매 조건 = 배치(hospital_devices) 속성** — 물건(유닛)이 아니라 팔린 자리에 붙는다. 이벤트에 시점 스냅샷.
// 교체 시 신 배치가 구 배치 값을 상속, 회수는 배치 행에 마지막 값을 남기되 재등록 시 새 REGISTER가 다시 정한다.
// 기본값 규칙: 병원 계약완료 딜의 상품유형이 1종이면 그 값 · 0종이면 미지정(경고) · 혼합이면 명시 필수(오류)
// ─────────────────────────────────────────────────────────────────────────────

export const PRODUCT_TYPES = ['일반', '라이트'] as const
export type ProductType = (typeof PRODUCT_TYPES)[number]

export const PRODUCT_TYPE_UNSET_LABEL = '미지정'

/** 배지 톤 — 일반 default · 라이트 info(primary) */
export const PRODUCT_TYPE_COLORS: Record<ProductType, string> = {
  일반: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  라이트: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
}

/** 임포트·등록 입력 별칭(대소문자·공백 무시) */
export const PRODUCT_TYPE_INPUT_ALIASES: Record<ProductType, readonly string[]> = {
  일반: ['일반', 'standard', 'STANDARD', 'std'],
  라이트: ['라이트', 'lite', 'LITE', 'light', 'LIGHT'],
}

export const PRODUCT_TYPE_INVALID_MESSAGE = '상품유형 값이 올바르지 않습니다 (일반/라이트)'
export const PRODUCT_TYPE_REQUIRED_MESSAGE = '상품유형 필수 — 이 병원은 일반·라이트 딜이 함께 있습니다'
export const PRODUCT_TYPE_NO_DEAL_WARNING = '병원 계약완료 딜 없음 — 상품유형 미지정'

/** 목록 필터 `productType=` 어휘 — 일반/라이트 또는 none(미지정) */
export const PRODUCT_TYPE_FILTERS = ['일반', '라이트', 'none'] as const
export type ProductTypeFilter = (typeof PRODUCT_TYPE_FILTERS)[number]

function normProductToken(s: string): string {
  return s.normalize('NFC').replace(/[\s　]+/g, '').toUpperCase()
}

/** 입력 토큰이 상품유형 별칭인가(붙여넣기 열 판별용 — '라이트'·'lite' 등) */
export function isProductTypeToken(s: string | null | undefined): boolean {
  if (!s) return false
  const t = normProductToken(s)
  return PRODUCT_TYPES.some((v) => PRODUCT_TYPE_INPUT_ALIASES[v].some((a) => normProductToken(a) === t))
}

/**
 * 입력 문자열 → 상품유형. 빈 입력은 null(미지정), 미매칭은 undefined(호출부가 오류 판정 — `PRODUCT_TYPE_INVALID_MESSAGE`).
 */
export function matchProductType(input: string | null | undefined): ProductType | null | undefined {
  const raw = (input ?? '').trim()
  if (!raw) return null
  const t = normProductToken(raw)
  return PRODUCT_TYPES.find((v) => PRODUCT_TYPE_INPUT_ALIASES[v].some((a) => normProductToken(a) === t))
}

export function isProductType(v: unknown): v is ProductType {
  return typeof v === 'string' && (PRODUCT_TYPES as readonly string[]).includes(v)
}

/** 상품유형 라벨 — null은 '미지정'(opts.unset으로 '—' 등 대체) */
export function productTypeLabel(v: string | null | undefined, opts?: { unset?: string }): string {
  return v && isProductType(v) ? v : (v ?? opts?.unset ?? PRODUCT_TYPE_UNSET_LABEL)
}

/** 병원 계약완료 딜 기준 상품유형 문맥 — 서비스 `getHospitalProductTypeContext` 반환 형상(클라이언트도 같은 형상을 받는다) */
export interface ProductTypeContext {
  /** 계약완료 딜에 등장하는 상품유형(중복 제거, PRODUCT_TYPES 순) */
  types: ProductType[]
  /** 1종이면 그 값, 0종·혼합이면 null */
  default: ProductType | null
  /** 2종 이상 — 등록 시 명시 필수 */
  mixed: boolean
  /** 계약완료 딜 수(상품유형 무관) */
  deals: number
  /** 상품유형별 계약 수량(Σ daewoong_device_count)·딜 수 */
  byType: { type: ProductType; deals: number; devices: number }[]
}

export interface ProductTypeResolution {
  productType: ProductType | null
  /** 명시 없음 + 혼합 → PRODUCT_TYPE_REQUIRED_MESSAGE */
  error: string | null
  /** 명시 없음 + 딜 0건 → PRODUCT_TYPE_NO_DEAL_WARNING · 명시값이 계약 딜에 없는 유형 → 안내 */
  warning: string | null
  /** 문맥 기본값이 적용됐는지 */
  fromDefault: boolean
}

/**
 * 기본값 규칙(순수 함수 — 서버·클라이언트·스모크 공용).
 * explicit가 있으면 그대로(계약 딜에 없는 유형이면 경고만) / 없으면 문맥: 1종 → 기본값 · 0종 → null+경고 · 혼합 → 오류.
 */
export function resolveProductTypeDefault(ctx: ProductTypeContext | null | undefined, explicit: ProductType | null | undefined): ProductTypeResolution {
  if (explicit) {
    const known = !ctx || ctx.types.length === 0 || ctx.types.includes(explicit)
    return { productType: explicit, error: null, warning: known ? null : `상품유형 ${explicit} — 이 병원 계약완료 딜에 없는 상품유형입니다`, fromDefault: false }
  }
  if (!ctx || ctx.deals === 0 || ctx.types.length === 0) return { productType: null, error: null, warning: PRODUCT_TYPE_NO_DEAL_WARNING, fromDefault: false }
  if (ctx.mixed) return { productType: null, error: PRODUCT_TYPE_REQUIRED_MESSAGE, warning: null, fromDefault: false }
  return { productType: ctx.default, error: null, warning: null, fromDefault: true }
}

/**
 * 계약완료 딜 상태명 — 기대 수량(Σ계약완료 딜 daewoong_device_count) 조인 조건(§9.1).
 * 2026-08-03 도입 병상 동기화 스크립트와 동일 규칙: `status_codes.category='SALES_DEAL_STATUS' AND name='계약완료'`.
 */
export const DEAL_STATUS_CONTRACTED = '계약완료'
export const DEAL_STATUS_CATEGORY = 'SALES_DEAL_STATUS'

// ─────────────────────────────────────────────────────────────────────────────
// 날짜 헬퍼 (업무일자 — KST 기준 YYYY-MM-DD)
// ─────────────────────────────────────────────────────────────────────────────

/** KST 기준 오늘 (YYYY-MM-DD) — `lib/consultation.ts` todayKst와 동일 구현(그쪽은 prisma 의존이라 클라이언트에서 import 불가) */
export function todayKst(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

/** 'YYYY-MM-DD' 형식 + 실제 존재하는 날짜인지 */
export function isYmd(v: unknown): v is string {
  if (typeof v !== 'string' || !YMD_RE.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** 업무일자 미래 여부 (§4.1-3 — 미래는 400). 문자열 비교로 충분(같은 형식). */
export function isFutureYmd(ymd: string, today: string = todayKst()): boolean {
  return ymd > today
}

/** Date | ISO 문자열 | YYYY-MM-DD → YYYY-MM-DD (DB @db.Date는 UTC 자정 인스턴트로 오므로 UTC 기준 절단) */
export function toYmd(v: Date | string | null | undefined): string | null {
  if (!v) return null
  if (typeof v === 'string') return v.length >= 10 && YMD_RE.test(v.slice(0, 10)) ? v.slice(0, 10) : null
  return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
}

// ─────────────────────────────────────────────────────────────────────────────
// 시리얼 정규화 · 접두 추정 (부록 B)
// ─────────────────────────────────────────────────────────────────────────────

export type SerialKind = 'PLAIN' | 'GW_COMPOSITE' | 'BARCODE'

export interface NormalizedSerial {
  /** 저장·조회 키 (대문자·공백 제거, GW 합성은 `B######`, 바코드형은 접미 시리얼) */
  serialNo: string
  /** 키와 다른 원문(대문자·공백 제거 후) — WMS 매칭·표시용. 키와 같으면 null */
  serialRaw: string | null
  kind: SerialKind
}

/** WMS 합성 시리얼 `GW4C11-B008381` → 키 `B008381` */
const GW_COMPOSITE_RE = /^GW[0-9A-Z]{4}-(B\d{6})$/
/** 바코드형 `XXX0000-A000000` → 키 `A000000` (A/P/C/E 웨어러블만) */
const BARCODE_RE = /^[A-Z0-9]+-([APCE]\d{6})$/

/** trim → 공백 제거 → 대문자 → GW 합성/바코드형 분해. 빈 입력은 serialNo '' */
export function normalizeSerial(raw: string | null | undefined): NormalizedSerial {
  const compact = (raw ?? '').replace(/\s+/g, '').toUpperCase()
  if (!compact) return { serialNo: '', serialRaw: null, kind: 'PLAIN' }
  const gw = GW_COMPOSITE_RE.exec(compact)
  if (gw) return { serialNo: gw[1], serialRaw: compact, kind: 'GW_COMPOSITE' }
  const bc = BARCODE_RE.exec(compact)
  if (bc) return { serialNo: bc[1], serialRaw: compact, kind: 'BARCODE' }
  return { serialNo: compact, serialRaw: null, kind: 'PLAIN' }
}

export interface DeviceClassGuess {
  /** device_info.onprem_device_type 매칭 키 (GW는 온프렘 코드가 없어 미지정) */
  onpremDeviceType?: number
  deviceClass?: DeviceClass
  /** 미시드 모델 안내용 힌트 — "MT100D 모델이 등록되어 있지 않습니다" */
  hintModel?: string
}

/**
 * 접두 추정 (부록 B-2): A→ECG(1) · P→SpO2(3) · B/GW→GATEWAY · C→TEMP(2, MT100D 미시드) · E→BP(6, MBP100U 미시드)
 * · H2-BPM-→참BP(11) · ^[FGK]→링BP(10). 그 외 {} (모델 판별 불가 → 사용자가 모델 고정).
 * 입력은 `normalizeSerial` 통과 후 키를 전제로 하되 대소문자는 관대하게 처리한다.
 */
export function guessDeviceClassByPrefix(serialNo: string | null | undefined): DeviceClassGuess {
  const s = (serialNo ?? '').trim().toUpperCase()
  if (!s) return {}
  if (s.startsWith('H2-BPM-')) return { onpremDeviceType: 11, deviceClass: 'THIRD_PARTY', hintModel: 'H2-ABPM' }
  if (s.startsWith('GW') || s.startsWith('B')) return { deviceClass: 'GATEWAY', hintModel: 'MGW1010' }
  switch (s[0]) {
    case 'A':
      return { onpremDeviceType: 1, deviceClass: 'WEARABLE', hintModel: 'MC200M-T' }
    case 'P':
      return { onpremDeviceType: 3, deviceClass: 'WEARABLE', hintModel: 'MP100W' }
    case 'C':
      return { onpremDeviceType: 2, deviceClass: 'WEARABLE', hintModel: 'MT100D' }
    case 'E':
      return { onpremDeviceType: 6, deviceClass: 'WEARABLE', hintModel: 'MBP100U' }
    case 'F':
    case 'G':
    case 'K':
      return { onpremDeviceType: 10, deviceClass: 'THIRD_PARTY', hintModel: 'SL-MPF1K07' }
    default:
      return {}
  }
}

/**
 * device_info.serial_pattern 대조 — 경고용(B-9: 형식은 경고만, 저장은 정규화 키).
 * 패턴 없음/컴파일 실패는 null(판정 불가), 그 외 boolean.
 */
export function matchesSerialPattern(serialNo: string, pattern: string | null | undefined): boolean | null {
  if (!pattern) return null
  try {
    return new RegExp(pattern).test(serialNo)
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 붙여넣기 파서 (부록 B-2)
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedSerialLine {
  /** 원문 줄 번호(1부터) — 빈 줄·주석 줄도 번호를 소모한다. 한 줄에 시리얼이 여럿이면 같은 row를 공유 */
  row: number
  serialInput: string
  wardInput?: string
  memo?: string
  /** 3열 이후 중 용도 별칭(판매용/평가용/SALE/EVAL)인 셀 — 메모에서 분리 */
  usageInput?: string
  /** 3열 이후 중 상품유형 별칭(일반/라이트/lite…)인 셀 — 메모에서 분리 */
  productTypeInput?: string
}

/** 열 구분: 탭 또는 2칸 이상 공백 */
const COLUMN_SPLIT_RE = /\t+|[ 　]{2,}/
/** 시리얼 토큰 구분(열 모드 아님): 쉼표·세미콜론·공백 */
const TOKEN_SPLIT_RE = /[,;\s　]+/

/**
 * 줄당 1건 — `A126861` / `A126862<TAB>6병동` / `A126863, A126864 A126865`(탭 없으면 토큰 전부 시리얼)
 * / `gw4c11-b008381<TAB>6병동<TAB>신관 GW` / `A126866<TAB>6병동<TAB>평가용<TAB>라이트`(3열 이후 용도 별칭 셀은 usageInput, 상품유형 별칭 셀은 productTypeInput으로 분리).
 * `#` 뒤는 주석(줄 시작 또는 공백 뒤), 빈 줄 무시, 줄 번호 보존.
 * 열 모드의 첫 열에 시리얼이 여럿이면 같은 병동·메모·용도로 각각 행이 된다.
 *
 * 반환은 최대 `max + 1`건 — 호출부는 `rows.length > max`이면 'MAX 초과' 오류로 처리한다(대용량 붙여넣기 전량 파싱 방지).
 */
export function parseSerialLines(text: string | null | undefined, max: number = IMPORT_MAX_ROWS): ParsedSerialLine[] {
  const rows: ParsedSerialLine[] = []
  if (!text) return rows
  const lines = text.split(/\r\n|\r|\n/)
  const limit = max + 1
  for (let i = 0; i < lines.length && rows.length < limit; i++) {
    const row = i + 1
    const line = lines[i].replace(/(^|[\s　])#.*$/, '').replace(/[\s　]+$/, '')
    if (!line.trim()) continue
    const columnMode = COLUMN_SPLIT_RE.test(line.trim())
    if (columnMode) {
      const cols = line.trim().split(COLUMN_SPLIT_RE).map((c) => c.trim())
      const wardInput = cols[1] || undefined
      const rest = cols.slice(2).filter(Boolean)
      const usageInput = rest.find((c) => isUsageTypeToken(c))
      const productTypeInput = rest.find((c) => c !== usageInput && isProductTypeToken(c))
      const memo = rest.filter((c) => c !== usageInput && c !== productTypeInput).join(' ') || undefined
      const serials = cols[0].split(TOKEN_SPLIT_RE).filter(Boolean)
      for (const serialInput of serials) {
        if (rows.length >= limit) break
        rows.push({ row, serialInput, ...(wardInput ? { wardInput } : {}), ...(memo ? { memo } : {}), ...(usageInput ? { usageInput } : {}), ...(productTypeInput ? { productTypeInput } : {}) })
      }
    } else {
      const serials = line.trim().split(TOKEN_SPLIT_RE).filter(Boolean)
      for (const serialInput of serials) {
        if (rows.length >= limit) break
        rows.push({ row, serialInput })
      }
    }
  }
  return rows
}

// ─────────────────────────────────────────────────────────────────────────────
// 병동명 정규화 (§5.2 — name_norm 매칭·유니크 키)
// ─────────────────────────────────────────────────────────────────────────────

/** 전각 영숫자·기호(U+FF01–U+FF5E) → 반각, 전각 공백(U+3000) → 반각 공백 */
function toHalfWidth(s: string): string {
  return s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ')
}

/**
 * trim + 내부 공백 제거 + 대소문자 무시(대문자) + 전각/반각 통일(+ 한글 NFC 정규화).
 * '6 병동' == '6병동', 'icu' == 'ICU', '６병동' == '6병동'. 임포트 해석·동명 409·transferAll 병합이 같은 함수.
 */
export function normalizeWardName(name: string | null | undefined): string {
  if (!name) return ''
  return toHalfWidth(name.normalize('NFC')).replace(/\s+/g, '').toUpperCase()
}

// ─────────────────────────────────────────────────────────────────────────────
// 온프렘 export 헤더 감지 (부록 B-3 별칭표 — P0 샘플로 확정)
// ─────────────────────────────────────────────────────────────────────────────

export type OnpremColumn = 'serial' | 'wardCode' | 'deviceType' | 'organizationCode' | 'macAddress' | 'deviceCode'

/** 헤더 셀 인덱스 맵 — `serial`은 필수, 나머지는 있으면 */
export type OnpremHeaderMap = { serial: number } & Partial<Record<Exclude<OnpremColumn, 'serial'>, number>>

/** 별칭은 소문자·공백/밑줄 제거 후 비교 (`serial_number` == `serialNumber` == `Serial Number`) */
export const ONPREM_HEADER_ALIASES: Record<OnpremColumn, readonly string[]> = {
  serial: ['serialnumber', '시리얼', '시리얼번호'],
  wardCode: ['wardcode', '병동코드'],
  deviceType: ['devicetype', '기기유형'],
  organizationCode: ['organizationcode', '기관코드'],
  macAddress: ['macaddress', 'mac'],
  deviceCode: ['devicecode', '장치코드', '닉네임'],
}

/** `deviceRegisterList` JSON 배열 붙여넣기의 응답 키(SelectAllDeviceRegisterPage) — 열 맵과 같은 의미로 매핑 */
export const ONPREM_JSON_KEYS: Record<OnpremColumn, string> = {
  serial: 'serialNumber',
  wardCode: 'wardCode',
  deviceType: 'deviceType',
  organizationCode: 'organizationCode',
  macAddress: 'macAddress',
  deviceCode: 'deviceCode',
}

function normalizeHeaderCell(cell: unknown): string {
  return String(cell ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s　_\-]+/g, '')
}

/**
 * 헤더 행 → 열 맵. 감지 조건(B-3): 시리얼 별칭 + (wardCode 또는 deviceType 별칭)이 있어야 초안 모드 제안 → 그 외 null.
 * 같은 열이 중복되면 첫 번째를 쓴다.
 */
export function detectOnpremHeader(headerCells: readonly unknown[] | null | undefined): OnpremHeaderMap | null {
  if (!headerCells || headerCells.length === 0) return null
  const found: Partial<Record<OnpremColumn, number>> = {}
  headerCells.forEach((cell, idx) => {
    const norm = normalizeHeaderCell(cell)
    if (!norm) return
    for (const col of Object.keys(ONPREM_HEADER_ALIASES) as OnpremColumn[]) {
      if (found[col] === undefined && ONPREM_HEADER_ALIASES[col].includes(norm)) {
        found[col] = idx
        return
      }
    }
  })
  if (found.serial === undefined) return null
  if (found.wardCode === undefined && found.deviceType === undefined) return null
  return found as OnpremHeaderMap
}

// ─────────────────────────────────────────────────────────────────────────────
// 유지보수 연결 시 업무일자 제안 (§5c · D7)
// ─────────────────────────────────────────────────────────────────────────────

export type OccurredOnBasis = 'visit_end' | 'visit_start' | 'resolved_at' | 'reported_at'

export const OCCURRED_ON_BASIS_LABELS: Record<OccurredOnBasis, string> = {
  visit_end: '방문 종료일',
  visit_start: '방문 시작일',
  resolved_at: '조치 완료일',
  reported_at: '접수일',
}

export interface OccurredOnSuggestion {
  date: string
  basis: OccurredOnBasis
}

type DateLike = Date | string | null | undefined

export interface MaintenanceDatesForSuggestion {
  visits?: readonly { startDate: DateLike; endDate: DateLike }[] | null
  resolvedAt?: DateLike
  reportedAt?: DateLike
}

/**
 * 제안 = `max(visits.endDate ≤ 오늘)`(없으면 `max(startDate ≤ 오늘)`) ?? resolvedAt ?? reportedAt ?? null.
 * `MaintenanceVisit`은 startDate/endDate 기간형 — 종료일이 아직 안 온 진행 중 방문은 시작일, 전부 미래인 방문은 제안하지 않는다.
 * 어떤 근거든 오늘보다 미래면 건너뛴다(기본값이 '미래 400'에 걸리지 않게).
 */
export function suggestOccurredOnFromMaintenance(
  m: MaintenanceDatesForSuggestion,
  today: string = todayKst()
): OccurredOnSuggestion | null {
  const visits = m.visits ?? []
  let bestEnd: string | null = null
  let bestStart: string | null = null
  for (const v of visits) {
    const end = toYmd(v.endDate)
    const start = toYmd(v.startDate)
    if (end && end <= today && (!bestEnd || end > bestEnd)) bestEnd = end
    if (start && start <= today && (!bestStart || start > bestStart)) bestStart = start
  }
  if (bestEnd) return { date: bestEnd, basis: 'visit_end' }
  if (bestStart) return { date: bestStart, basis: 'visit_start' }
  const resolved = toYmd(m.resolvedAt)
  if (resolved && resolved <= today) return { date: resolved, basis: 'resolved_at' }
  const reported = toYmd(m.reportedAt)
  if (reported && reported <= today) return { date: reported, basis: 'reported_at' }
  return null
}
