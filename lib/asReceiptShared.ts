/**
 * AS업무(AS접수) 공용 상수 — 클라이언트 안전 (projects/as_work_design.md §3·§4)
 * 서버 헬퍼(코드 발번·권한 판정)는 lib/asReceipt.ts.
 */

export const AS_CATEGORIES = ['FAULT', 'LOST'] as const
export type AsCategory = (typeof AS_CATEGORIES)[number]
export const AS_CATEGORY_LABELS: Record<AsCategory, string> = { FAULT: '고장', LOST: '분실' }

export const AS_METHODS = ['PARCEL', 'VISIT'] as const // 발송방법(라인 ship_method) — 수거방법은 아래 AS_PICKUP_METHODS
export type AsMethod = (typeof AS_METHODS)[number]
// 수거방법 (2026-09-18 NONE 추가): PARCEL 택배수거 / VISIT 방문수거 / NONE 수거없음 — 분실 접수 등록 시 기본값
export const AS_PICKUP_METHODS = ['PARCEL', 'VISIT', 'NONE'] as const
export type AsPickupMethod = (typeof AS_PICKUP_METHODS)[number]
/** 등록 시 수거방법 기본값 — 분실(LOST)은 회수할 기기가 없으므로 '수거없음' */
export function defaultAsPickupMethod(category: string): AsPickupMethod | null {
  return category === 'LOST' ? 'NONE' : null
}
/** 수거방법 라벨 (2026-09-04 확정 — 수거/발송 각자 방법 플래그, 단계 일괄 스킵 없음) */
export const AS_PICKUP_METHOD_LABELS: Record<AsPickupMethod, string> = { PARCEL: '택배수거', VISIT: '방문수거', NONE: '수거없음' }
export const AS_SHIP_METHOD_LABELS: Record<AsMethod, string> = { PARCEL: '택배발송', VISIT: '방문교체' }

export const AS_DEST_TYPES = ['HOSPITAL', 'OTHER'] as const
export type AsDestType = (typeof AS_DEST_TYPES)[number]
export const AS_DEST_TYPE_LABELS: Record<AsDestType, string> = { HOSPITAL: '병원', OTHER: '기타(대웅 등)' }

// ─── 접수 태그 (2026-09-15) — 선교체와 같은 성격의 접수 플래그. 목록 '태그' 열·필터, 상세 2. 접수정보 체크박스 ───
export const AS_TAGS = ['PRE_REPLACE', 'PRIORITY_REPAIR', 'FIRMWARE_UPDATE', 'ACCESSORY', 'COMBINED_PACK'] as const // COMBINED_PACK 합포장 (2026-09-19 — 수동 체크 + 같은 수거 송장번호 접수 발견 시 자동 켬)
export type AsTag = (typeof AS_TAGS)[number]
export const AS_TAG_LABELS: Record<AsTag, string> = {
  PRE_REPLACE: '선교체',
  PRIORITY_REPAIR: '우선수리',
  FIRMWARE_UPDATE: '펌웨어 업데이트',
  ACCESSORY: '부속품 동봉',
  COMBINED_PACK: '합포장',
}
/** 태그 2글자 약어 — 목록 2줄 행 보조 줄 칩 (2026-10-01, 전체 라벨은 툴팁) */
export const AS_TAG_SHORT_LABELS: Record<AsTag, string> = {
  PRE_REPLACE: '선교',
  PRIORITY_REPAIR: '우선',
  FIRMWARE_UPDATE: '펌업',
  ACCESSORY: '부속',
  COMBINED_PACK: '합포',
}
/** 태그 ↔ as_receipts 불리언 컬럼 */
export const AS_TAG_FIELDS: Record<AsTag, 'preReplace' | 'priorityRepair' | 'firmwareUpdate' | 'accessoryIncluded' | 'combinedPack'> = {
  PRE_REPLACE: 'preReplace',
  PRIORITY_REPAIR: 'priorityRepair',
  FIRMWARE_UPDATE: 'firmwareUpdate',
  ACCESSORY: 'accessoryIncluded',
  COMBINED_PACK: 'combinedPack',
}
/** 태그 배지 색 (목록·상세 공용) */
export const AS_TAG_BADGE_CLS: Record<AsTag, string> = {
  PRE_REPLACE: 'bg-amber-100 text-amber-800',
  PRIORITY_REPAIR: 'bg-red-100 text-red-700',
  FIRMWARE_UPDATE: 'bg-violet-100 text-violet-700',
  ACCESSORY: 'bg-teal-100 text-teal-700',
  COMBINED_PACK: 'bg-sky-100 text-sky-700',
}
export type AsTagFlags = { preReplace: boolean; priorityRepair: boolean; firmwareUpdate: boolean; accessoryIncluded: boolean; combinedPack: boolean }
export const AS_TAG_FLAGS_EMPTY: AsTagFlags = { preReplace: false, priorityRepair: false, firmwareUpdate: false, accessoryIncluded: false, combinedPack: false }
/** 접수의 켜진 태그 목록 (AS_TAGS 순서 고정) */
export function asReceiptTags(r: Partial<AsTagFlags>): AsTag[] {
  return AS_TAGS.filter((t) => r[AS_TAG_FIELDS[t]] === true)
}

export const AS_OUTCOMES = ['REPAIR_RETURN', 'REPLACE', 'LOST', 'CANCELED', 'NOT_RECEIVED', 'FOUND'] as const
export type AsOutcome = (typeof AS_OUTCOMES)[number]
export const AS_OUTCOME_LABELS: Record<AsOutcome, string> = {
  REPAIR_RETURN: '수리반환',
  REPLACE: '교체',
  LOST: '분실종결',
  CANCELED: '라인취소',
  NOT_RECEIVED: '미회수', // 입고 대조 예외 — 접수자 확인에서만 확정 (2026-09-11)
  FOUND: '되찾음', // 분실 접수 교체 확정 라인을 되찾음 처리 — 교체기기 회수, 분실 제공 집계 제외 (2026-11-10, as_lost_found_design.md)
}
/** 분실기기 되찾음 처리 가능 라인 — 분실 접수 · 교체 확정 · 교체기기가 원장에 별도 유닛으로 연결(마이그 라인은 라벨 승계라 제외, D1) */
export function canMarkAsLineFound(category: string | null | undefined, item: { outcome: string | null | undefined; deviceId: number | null | undefined; newDeviceId: number | null | undefined }): boolean {
  return category === 'LOST' && item.outcome === 'REPLACE' && !!item.deviceId && !!item.newDeviceId && item.deviceId !== item.newDeviceId
}
/** 라인 처리 패널에서 고를 수 있는 결과 — 미회수는 접수자 확인 절차 전용 */
export const AS_RESOLVE_OUTCOMES = ['REPAIR_RETURN', 'REPLACE', 'LOST', 'CANCELED'] as const
/** 접수 구분별 선택 가능한 처리방법 (2026-10-30): 분실 접수는 기기를 수리해 돌려줄 수 없으므로 '수리반환' 제외 — UI 선택지·서버 검증(초안·확정) 단일 소스 */
export function asResolveOutcomesFor(category: string | null | undefined): readonly AsOutcome[] {
  return category === 'LOST' ? AS_RESOLVE_OUTCOMES.filter((o) => o !== 'REPAIR_RETURN') : AS_RESOLVE_OUTCOMES
}
/** 화면 처리방법 선택지 (2026-11-10 D1 — as_lost_stock_out_link_design.md): 분실 접수는 '교체'(시리얼 직접 입력) 대신 '출고요청'(UI 전용 값)으로 기기 제공. 서버 검증은 `asResolveOutcomesFor`(REPLACE 허용 — 출고 실행 경로·과거 호환) */
export const AS_STOCK_OUT_REQUEST_UI = 'STOCK_OUT_REQUEST' as const
export type AsResolveUiOption = AsOutcome | typeof AS_STOCK_OUT_REQUEST_UI
export function asResolveUiOptionsFor(category: string | null | undefined): readonly AsResolveUiOption[] {
  if (category !== 'LOST') return AS_RESOLVE_OUTCOMES
  return [AS_STOCK_OUT_REQUEST_UI, ...asResolveOutcomesFor(category).filter((o) => o !== 'REPLACE')]
}
export const AS_RESOLVE_UI_LABELS: Record<AsResolveUiOption, string> = { ...AS_OUTCOME_LABELS, [AS_STOCK_OUT_REQUEST_UI]: '출고요청' }
/** 활성(미종결) 출고요청에 묶인 라인인가 — 대기 중 잠금 판정 단일 소스(화면·서버 공용). 요청 상태의 ticketStatus가 종결이 아니면 활성 */
export function isAsLineLockedByStockOut(item: { stockOutRequest?: { status?: { ticketStatus?: string | null } | null } | null } | null | undefined): boolean {
  const r = item?.stockOutRequest
  if (!r) return false
  const ts = r.status?.ticketStatus ?? null
  return ts !== 'RESOLVED' && ts !== 'CLOSED'
}
/** 분실 접수에서 '새 기기 제공'으로 세는 라인 결과 — 분실 한도 집계(`lib/asLostQuota.ts`) 단일 소스. REPAIR_RETURN은 AS이력 마이그(IMPORT) 분류 잔재(라벨 승계 발송)라 제공으로 본다 */
export const AS_LOST_PROVIDED_OUTCOMES = ['REPLACE', 'REPAIR_RETURN'] as const

// ─── 입고 대조 (2026-09-11 — as_work_design.md §14) ───────────────
export const AS_INTAKE_STATES = ['PENDING', 'RECEIVED', 'MISMATCH', 'EXTRA'] as const
export type AsIntakeState = (typeof AS_INTAKE_STATES)[number]
export const AS_INTAKE_STATE_LABELS: Record<AsIntakeState, string> = {
  PENDING: '대기', // 입고처리 전 (방문교체·선교체는 입고 없이 처리될 수 있음)
  RECEIVED: '정상입고', // 접수 시리얼이 입고로 식별됨
  MISMATCH: '미입고', // 접수 시리얼이 입고로 식별되지 않음 — 접수자 확인(치환·정상입고 확정·미회수)
  EXTRA: '미식별입고', // 입고 시리얼이 접수 내역에 없음 — 접수자 확인(치환 대상·신규 편입·삭제)
}
/** 접수자 확인이 필요한 라인인가 (미종결 기준은 호출부) */
export const isAsIntakeIssue = (state: string | null | undefined) => state === 'MISMATCH' || state === 'EXTRA'

// ─── 시리얼 형식 규칙 (2026-09-30 사용자 확정) ──────────────────────────
// 심전계 = 'A' + 숫자 6자리, 산소포화도 = 'P' + 숫자 6자리. 그 외는 전부 비정상 시리얼 —
// 접수 라인은 등록될 수 있지만(시트 자동 인입 보호), **정상 시리얼로 보정되기 전에는 이후 처리(원장 확정·입고·처리방법·최종확정·발송·수리완료·폐기) 불가**.
// AS-202609-0159 사례(시트 'P017426(52W)' 병동 접미어가 시리얼로 들어가 가짜 기기 6대 등록) 재발 방지. 판정은 이 함수 단일 소스
export const AS_SERIAL_RE = /^[AP]\d{6}$/
export const AS_SERIAL_RULE_TEXT = '심전계 A+숫자 6자리 · 산소포화도 P+숫자 6자리'
export function isValidAsSerial(serialNo: string | null | undefined): boolean {
  return AS_SERIAL_RE.test((serialNo ?? '').trim().toUpperCase())
}
/** 비정상 시리얼 안내 문구 — 정상이면 null */
export function asSerialFormatError(serialNo: string | null | undefined): string | null {
  return isValidAsSerial(serialNo) ? null : `${serialNo ?? ''}: 시리얼 형식 오류 — [시리얼 보정]으로 정상 시리얼(${AS_SERIAL_RULE_TEXT})로 고친 뒤 처리할 수 있습니다`
}

// ─── 회수기기 처리 (2026-11-02 — 수리완료 체크박스 → 3택) ───
// 라인 `repair_result` = 회수된 기기를 어떻게 처리했는가(고객에게 무엇을 해줬는지인 outcome과 별개 축). `repaired_at/by`는 세 값 공통의 처리일·처리자.
// DB CHECK: (repair_result IS NULL) = (repaired_at IS NULL) — '처리됨' 판정은 repaired_at 유무로 해도 같다(큐·진행도 기존 판정 유지).
// 기기현황 condition: 수리·문제없음 → REPAIRED(재사용 재고, 문제없음은 이벤트 메모로 구분) / 폐기 → SCRAPPED. 기기 상태를 새로 만들지 않는다.
export const AS_REPAIR_RESULTS = ['REPAIRED', 'NO_FAULT', 'SCRAPPED'] as const
export type AsRepairResult = (typeof AS_REPAIR_RESULTS)[number]
/** 셀·배지용 짧은 표기 */
export const AS_REPAIR_RESULT_LABELS: Record<AsRepairResult, string> = { REPAIRED: '수리', NO_FAULT: '문제없음', SCRAPPED: '폐기' }
/** 툴팁·확인창·비고용 긴 표기 */
export const AS_REPAIR_RESULT_DESC: Record<AsRepairResult, string> = { REPAIRED: '수리완료 (회수기기 수리)', NO_FAULT: '수리완료 (회수기기 문제없음)', SCRAPPED: '폐기' }
export const AS_REPAIR_RESULT_BADGE_CLS: Record<AsRepairResult, string> = {
  REPAIRED: 'bg-emerald-50 text-emerald-700',
  NO_FAULT: 'bg-sky-50 text-sky-700',
  SCRAPPED: 'bg-gray-200 text-gray-600',
}
/** repair-done API·선택지로 고르는 값(폐기는 확인·사유가 필요해 scrap-line 전용 경로) */
export const AS_SETTABLE_REPAIR_RESULTS = ['REPAIRED', 'NO_FAULT'] as const
export type AsSettableRepairResult = (typeof AS_SETTABLE_REPAIR_RESULTS)[number]
export const isAsSettableRepairResult = (v: unknown): v is AsSettableRepairResult => v === 'REPAIRED' || v === 'NO_FAULT'
export const asRepairResultLabel = (v: string | null | undefined): string => (v && v in AS_REPAIR_RESULT_LABELS ? AS_REPAIR_RESULT_LABELS[v as AsRepairResult] : '')

// ─── 수리완료 체크 (2026-09-17 — device_condition_location_design.md §5.6·§7.2) — 2026-11-02부터 '회수기기 처리' 게이트로 그대로 사용 ───
/** 결과가 이 집합이면 수리완료 대상이 아니다(분실·취소·미회수) */
export const AS_REPAIR_EXCLUDED_OUTCOMES: readonly string[] = ['LOST', 'CANCELED', 'NOT_RECEIVED', 'FOUND'] // FOUND: 되찾은 기기는 회수기기가 아니다 (2026-11-10)
/**
 * 라인 수리완료 체크 가능 여부 — 입고된 라인(D5)만, 분실·취소·미회수 라인 제외. 접수 상태(종결 포함, A-2)·outcome NULL/REPAIR_RETURN/REPLACE는 허용.
 * 카드 헤더 `수리완료 n/m`의 m(분모)도 이 판정으로 센다.
 */
export function canMarkAsLineRepaired(item: { intakeState: string | null | undefined; outcome: string | null | undefined }): boolean {
  return item.intakeState === 'RECEIVED' && !AS_REPAIR_EXCLUDED_OUTCOMES.includes(item.outcome ?? '')
}
/** 회수기기 처리 비활성 사유 툴팁(§6.1) — 처리 가능하면 null */
export function asRepairDisabledReason(item: { intakeState: string | null | undefined; outcome: string | null | undefined }): string | null {
  if (canMarkAsLineRepaired(item)) return null
  if (AS_REPAIR_EXCLUDED_OUTCOMES.includes(item.outcome ?? '')) return '분실·취소·미회수 라인'
  return '입고 후 처리할 수 있습니다'
}
/**
 * 회수처리 진행도 `회수처리 n/m` — m = 처리 가능 라인 수(canMarkAsLineRepaired), n = 그중 처리된 라인(repaired_at 있음 — 수리·문제없음·폐기 전부).
 * `byResult`는 처리값별 내역(툴팁). m=0이면 표시하지 않는다(호출부). 필드명 repaired는 호환 유지(= 처리 완료 수)
 */
export function summarizeAsRepairProgress(items: { intakeState: string | null | undefined; outcome: string | null | undefined; repairedAt?: string | Date | null; repairResult?: string | null }[]): { repaired: number; repairable: number; byResult: Record<AsRepairResult, number> } {
  let repaired = 0
  let repairable = 0
  const byResult: Record<AsRepairResult, number> = { REPAIRED: 0, NO_FAULT: 0, SCRAPPED: 0 }
  for (const i of items) {
    if (!canMarkAsLineRepaired(i)) continue
    repairable++
    if (i.repairedAt) {
      repaired++
      const r = (i.repairResult ?? 'REPAIRED') as AsRepairResult // 응답에 repairResult가 없는 구 호출부는 수리로 본다
      if (r in byResult) byResult[r]++
    }
  }
  return { repaired, repairable, byResult }
}
/** 진행도 툴팁 한 줄 — '수리 3 · 문제없음 1 · 폐기 0 / 처리 가능(입고) 라인 5' */
export function asRepairProgressTitle(p: { repairable: number; byResult: Record<AsRepairResult, number> }): string {
  return `${AS_REPAIR_RESULTS.map((r) => `${AS_REPAIR_RESULT_LABELS[r]} ${p.byResult[r]}`).join(' · ')} / 처리 가능(입고) 라인 ${p.repairable}`
}
/** 접수 비고 이력 최대 길이 — 초과 시 앞부분 절단 */
export const AS_NOTE_MAX_LENGTH = 5000
/**
 * 접수 비고 끝에 이력 한 줄 추가(5,000자 초과 시 앞부분 절단) — lib/asReceiptService.ts(라인 처리·입고·수리완료·폐기 등)와
 * 기기현황 라우트의 라인 동기화(app/api/devices/units/[id]/_unitState.ts)가 같은 규칙을 쓴다(2026-09-17 통합 — 복제본 제거).
 */
export function appendAsNote(note: string | null | undefined, line: string): string {
  const next = note?.trim() ? `${note.trimEnd()}\n${line}` : line
  return next.length > AS_NOTE_MAX_LENGTH ? next.slice(next.length - AS_NOTE_MAX_LENGTH) : next
}
/** 라인 기기 상태(condition) 소형 배지 — AS 상세 시리얼 셀에 노출하는 3종만(수리완료·폐기·분실). 나머지(사용중·AS접수)는 배치 배지·입고 배지로 충분 */
export const AS_LINE_CONDITION_BADGE_CLS: Record<'REPAIRED' | 'SCRAPPED' | 'LOST', string> = {
  REPAIRED: 'bg-emerald-50 text-emerald-700',
  SCRAPPED: 'bg-gray-200 text-gray-600',
  LOST: 'bg-red-50 text-red-600',
}
export const isAsLineConditionBadge = (v: string | null | undefined): v is 'REPAIRED' | 'SCRAPPED' | 'LOST' => v === 'REPAIRED' || v === 'SCRAPPED' || v === 'LOST'

/** 미등록 라인 기기종류 선택지 (§13-5 — 통계용 최소 입력. 원장 연결 라인은 모델에서 파생) */
export const AS_DEVICE_KINDS = ['심전도', '산소포화도', '게이트웨이', '기타'] as const

// ─── 기기군 (상세 AS상세내역 카드 분리, 2026-09-11) ────────────────
// 원장 모델명(device_info.device_name: 심전계/산소포화도) 또는 미등록 라인 기기종류(AS_DEVICE_KINDS)를 3군으로 접는다
// ─── 분실 교체 제공 한도 (2026-10-30 — lib/asLostQuota.ts 집계, AS 상세 '구분' 필드 표기) ────
/** 분실 기기 신규 제공 한도 — 구매수량 대비 % */
export const AS_LOST_QUOTA_PCT = 10
export interface AsLostQuotaGroup {
  group: '심전계' | '산소포화도'
  purchased: number | null // 계약완료 딜 기기 수량 합 — null = 구매수량 미등록
  /** 병원 분실 수량(단일 정의, 2026-11-10 as_lost_found_design.md §4) = 취소 아닌 분실 접수의 교체 확정 라인(REPLACE·REPAIR_RETURN) 수 — **이 접수 포함**, 되찾음(FOUND) 제외. 병원 상세 블록과 같은 숫자 */
  before: number
  /** 이 접수의 미종결 라인 수(교체 예정) — 접수 상세의 '처리 시' 보조 표기 전용 */
  thisReceipt: number
  after: number // before + thisReceipt
  pctBefore: number | null
  pctAfter: number | null
  overBefore: boolean // 이미 한도 초과
  overAfter: boolean // 이 접수의 미종결 라인을 교체 처리하면 초과
}
export interface AsLostQuota { thresholdPct: number; hasPurchase: boolean; groups: AsLostQuotaGroup[] }

/** 계약건별 도입 기기수량 · 상품유형(일반/라이트)×기기군 AS 교체 현황 (2026-11-02 — projects/as_deal_quota_design.md). 한도 경고 없음(비율만) */
export const AS_PRODUCT_TYPE_ROWS = ['일반', '라이트', '미지정'] as const
/** 라이트형 교체 한도 — 도입 수량의 100%까지만 교체 허용 (2026-11-02 사용자 정책). 일반형은 한도 없음 */
export const AS_LITE_REPLACE_QUOTA_PCT = 100
export type AsProductTypeRow = (typeof AS_PRODUCT_TYPE_ROWS)[number]
export interface AsDealQuotaCell {
  /** 도입 수량 — 상품유형의 계약완료 딜 기기 수량 합. null = 해당 상품유형 딜은 있으나 기기 수량 행 없음 */
  introduced: number | null
  /** 이 접수 제외 고장 교체 누계 */
  before: number
  /** 이 접수의 미종결 라인 + 교체 확정 라인 (분실 접수는 0 — 분실 교체는 분실 한도가 담당) */
  thisReceipt: number
  after: number
  pctBefore: number | null
  pctAfter: number | null
  /** 라이트 행만 — 교체 누계가 이미 한도(도입 수량×100%)를 넘음 / 이 접수 처리 시 넘음. 그 외 행은 항상 false */
  overBefore: boolean
  overAfter: boolean
}
export interface AsDealQuotaRow { productType: AsProductTypeRow; hasDeal: boolean; cells: Record<Exclude<AsDeviceGroup, '기타'>, AsDealQuotaCell> }
export interface AsDealQuotaDeal { dealCode: string; roundNo: number; contractDate: string | null; productType: AsProductTypeRow; ecg: number | null; spo2: number | null }
export interface AsDealQuota {
  /** 라이트 한도(%) — AS_LITE_REPLACE_QUOTA_PCT */
  liteThresholdPct: number
  /** 라이트 행 중 하나라도 이미 초과 / 이 접수 처리 시 초과 */
  liteOverBefore: boolean
  liteOverAfter: boolean
  /** 계약완료 딜 목록 (도입 수량 출처 — 차수 순) */
  deals: AsDealQuotaDeal[]
  /** 표 행 — 일반·라이트는 딜이 있거나 교체가 있으면, 미지정은 딜·교체가 있을 때만 */
  rows: AsDealQuotaRow[]
}

export const AS_DEVICE_GROUPS = ['심전계', '산소포화도', '기타'] as const
export type AsDeviceGroup = (typeof AS_DEVICE_GROUPS)[number]
export function asDeviceGroupOf(modelName: string | null | undefined, deviceKind: string | null | undefined, serialNo?: string | null): AsDeviceGroup {
  const n = (modelName ?? deviceKind ?? '').replace(/\s+/g, '')
  if (/심전/.test(n) || /ecg/i.test(n)) return '심전계'
  if (/산소포화|spo2|산소/i.test(n)) return '산소포화도'
  if (!n) {
    const k = asDeviceKindFromSerial(serialNo)
    if (k === '심전도') return '심전계'
    if (k === '산소포화도') return '산소포화도'
  }
  return '기타'
}
/** 미등록 시리얼의 기기종류 추정 — 원장 device_info.serial_pattern 접두 규칙(A→심전계, P→산소포화도, B→게이트웨이). 모르면 null */
export function asDeviceKindFromSerial(serialNo: string | null | undefined): (typeof AS_DEVICE_KINDS)[number] | null {
  const s = (serialNo ?? '').trim().toUpperCase()
  if (/^A\d/.test(s)) return '심전도'
  if (/^P\d/.test(s)) return '산소포화도'
  if (/^B\d/.test(s)) return '게이트웨이'
  return null
}

/** 목록 [기기] 아이콘 표기 (2026-09-15) — 기기군 3종을 짧은 코드로: ECG(심전계) · SpO2(산소포화도) · ETC(기타), 각 대수(+종결 수). 2026-09-17: 수리 진행도 `repaired/repairable`(체크 가능 라인 기준, intakeState·repairedAt 있을 때만 집계) 병기 */
export const AS_DEVICE_GROUP_CODES: Record<AsDeviceGroup, string> = { 심전계: 'ECG', 산소포화도: 'SpO2', 기타: 'ETC' }
export function summarizeAsItemsByGroup(
  items: { serialNo?: string | null; outcome: string | null; deviceKind?: string | null; intakeState?: string | null; repairedAt?: string | Date | null; device?: { deviceInfo: { deviceName: string } } | null }[]
): { group: AsDeviceGroup; code: string; count: number; done: number; repaired: number; repairable: number }[] {
  const acc = new Map<AsDeviceGroup, { count: number; done: number; repaired: number; repairable: number }>()
  for (const i of items) {
    const g = asDeviceGroupOf(i.device?.deviceInfo.deviceName, i.deviceKind, i.serialNo)
    const cur = acc.get(g) ?? { count: 0, done: 0, repaired: 0, repairable: 0 }
    cur.count++
    if (i.outcome) cur.done++
    if (i.intakeState !== undefined && canMarkAsLineRepaired({ intakeState: i.intakeState, outcome: i.outcome })) { cur.repairable++; if (i.repairedAt) cur.repaired++ } // intakeState 없는 호출부(알림 등)는 진행도 미집계
    acc.set(g, cur)
  }
  return AS_DEVICE_GROUPS.filter((g) => acc.has(g)).map((g) => ({ group: g, code: AS_DEVICE_GROUP_CODES[g], ...acc.get(g)! }))
}

/** 라인 요약 한 줄 — '기기 3대 (종결 1)' (목록·배너·알림 공용) */
/** 목록 [기기] 기기별 대수 표기 (CX #1) — "산소포화도 2 · 심전도 1 (종결 n)" */
export function summarizeAsItemsByKind(
  items: { outcome: string | null; deviceKind?: string | null; device?: { deviceInfo: { deviceName: string } } | null }[]
): string {
  if (!items.length) return '기기 없음'
  const byKind = new Map<string, number>()
  for (const i of items) {
    const kind = i.device?.deviceInfo.deviceName ?? i.deviceKind ?? '기타'
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1)
  }
  const parts: string[] = []
  byKind.forEach((n, kind) => parts.push(`${kind} ${n}`))
  const done = items.filter((i) => i.outcome != null && i.outcome !== '').length
  return parts.join(' · ') + (done > 0 ? ` (종결 ${done})` : '')
}

/** 접수 라인들의 상품유형(일반/라이트) 집합 — 원장 배치 기준(구기기 배치 → 없으면 교체기 배치). 혼재 시 둘 다, 미등록만이면 빈 배열 (목록 표기용, 2026-09-10) */
export function summarizeAsItemProductTypes(
  items: { device?: { placement?: { productType: string | null } | null } | null; newDevice?: { placement?: { productType: string | null } | null } | null }[]
): string[] {
  const set = new Set<string>()
  for (const i of items) {
    const t = i.device?.placement?.productType ?? i.newDevice?.placement?.productType
    if (t) set.add(t)
  }
  return ['일반', '라이트'].filter((t) => set.has(t))
}

// ─── 목록 검색 항목 (2026-09-18) ──────────────────────────
// 검색어는 ','로 여러 키워드 지정 가능(OR). 항목별 대상: 통합 = 아래 전부 + 고객명(reporterName)
export const AS_SEARCH_FIELDS = ['all', 'hospital', 'serial', 'code', 'tracking', 'owner'] as const
export type AsSearchField = (typeof AS_SEARCH_FIELDS)[number]
export const AS_SEARCH_FIELD_LABELS: Record<AsSearchField, string> = {
  all: '통합검색',
  hospital: '병원명',
  serial: '시리얼번호', // 접수 시리얼 + 교체 발송기기 시리얼(확정·초안) (2026-11-09)
  code: '접수번호',
  tracking: '송장번호', // 수거(접수 헤더)·발송(라인) 모두, 영숫자만 비교
  owner: '담당자', // 연결 티켓 담당자 이름
}
export const AS_SEARCH_FIELD_PLACEHOLDER: Record<AsSearchField, string> = {
  all: '접수번호·병원·시리얼(접수·교체)·송장·담당자 (쉼표로 여러 개)',
  hospital: '병원명 (쉼표로 여러 개)',
  serial: '접수 또는 교체 발송기기 시리얼 (쉼표로 여러 개)',
  code: '접수번호 (쉼표로 여러 개)',
  tracking: '수거·발송 송장번호 (쉼표로 여러 개)',
  owner: '담당자 이름 (쉼표로 여러 개)',
}
export function parseAsSearchField(v: string | null | undefined): AsSearchField {
  return (AS_SEARCH_FIELDS as readonly string[]).includes(v ?? '') ? (v as AsSearchField) : 'all'
}
/** 검색어 → 키워드 배열 (쉼표 분리·trim·빈 값 제거·중복 제거) */
export function splitAsSearchKeywords(q: string): string[] {
  return Array.from(new Set(q.split(',').map((k) => k.trim()).filter(Boolean)))
}

// ─── 목록 원장 정합 태그 (2026-09-10) ──────────────────────────
// 접수 병원과 라인 기기의 현재 원장 배치를 대조 — 미종결 라인만 평가(종결 라인은 교체·분실로 회수되는 게 정상이라 제외)
// 2026-09-18: DUPLICATE(중복접수) 추가 — 원장 배치와 별개 축(같은 시리얼의 미종결 라인이 다른 접수에도 있음). 라인은 배치 태그와 중복접수를 동시에 가질 수 있음
// 2026-09-30: BAD_SERIAL(시리얼 오류) 추가 — 형식 규칙(AS_SERIAL_RE) 위반. 원장 대조보다 우선(비정상 시리얼은 원장에 있을 수 없음), 보정 전 이후 처리 차단
export const AS_REGISTRY_TAGS = ['BAD_SERIAL', 'OTHER_HOSPITAL', 'RECOVERED', 'UNPLACED', 'UNREGISTERED', 'DUPLICATE'] as const
export type AsRegistryTag = (typeof AS_REGISTRY_TAGS)[number]
export const AS_REGISTRY_TAG_LABELS: Record<AsRegistryTag, string> = {
  BAD_SERIAL: '시리얼 오류', // 형식 규칙 위반 — 보정 전 처리 불가
  OTHER_HOSPITAL: '타병원', // 원장상 다른 병원에 ACTIVE 배치
  RECOVERED: '회수', // 원장상 회수(RECOVERED) 상태 — 어느 병원에도 배치 아님
  UNPLACED: '미배치', // 원장 개체는 있으나 배치 이력 없음
  UNREGISTERED: '미등록', // 원장에 시리얼 자체가 없음
  DUPLICATE: '중복접수', // 같은 시리얼의 미종결 라인이 다른 AS접수에도 있음
}
export const AS_REGISTRY_TAG_DESC: Record<AsRegistryTag, string> = {
  BAD_SERIAL: `시리얼 형식 오류 (${AS_SERIAL_RULE_TEXT}) — [시리얼 보정]으로 고치기 전에는 이후 처리를 할 수 없습니다`,
  OTHER_HOSPITAL: '기기현황에 다른 병원 배치로 등록된 기기 — 배치 확인 필요',
  RECOVERED: '기기현황에 회수 상태로 등록된 기기 — 재배치 여부 확인 필요',
  UNPLACED: '기기현황에 개체는 있으나 병원 배치가 없는 기기',
  UNREGISTERED: '기기현황에 등록되지 않은 시리얼',
  DUPLICATE: '같은 시리얼의 미종결 라인이 다른 AS접수에도 있음 — 중복 접수 여부 확인 필요',
}
export interface AsRegistryTagSummary { tag: AsRegistryTag; count: number; detail: string | null } // detail: 타병원명 등

export type AsRegistryUnit = { placement: { status: string; hospitalCode: string | null; hospitalName: string | null } | null } | undefined
export interface AsRegistryLineTag { tag: AsRegistryTag; detail: string | null } // detail: 타병원명

/** 라인 1개의 현재 배치 → 태그 (정상이면 null). unit: 원장 조회 결과(undefined = 미등록). serialNo 지정 시 형식 규칙 위반이 최우선(BAD_SERIAL, 2026-09-30) */
export function classifyAsRegistryLine(hospitalCode: string, unit: AsRegistryUnit, serialNo?: string | null): AsRegistryLineTag | null {
  if (serialNo != null && !isValidAsSerial(serialNo)) return { tag: 'BAD_SERIAL', detail: null }
  if (!unit) return { tag: 'UNREGISTERED', detail: null }
  const p = unit.placement
  if (!p) return { tag: 'UNPLACED', detail: null }
  if (p.status !== 'ACTIVE') return { tag: 'RECOVERED', detail: null }
  if (p.hospitalCode !== hospitalCode) return { tag: 'OTHER_HOSPITAL', detail: p.hospitalName ?? p.hospitalCode }
  return null
}

/** 라인별 현재 배치 → 접수 단위 태그 집계(태그 순서 고정). 미종결 라인만. dupBySerial: 시리얼 → 다른 접수의 접수번호(2026-09-18 중복접수 축, 배치 태그와 별도 집계) */
export function summarizeAsRegistryTags(
  hospitalCode: string,
  items: { serialNo: string; outcome: string | null }[],
  unitBySerial: Map<string, NonNullable<AsRegistryUnit>>,
  dupBySerial?: Map<string, string[]>
): AsRegistryTagSummary[] {
  const acc = new Map<AsRegistryTag, { count: number; details: Set<string> }>()
  const add = (tag: AsRegistryTag, detail: string | null) => {
    const cur = acc.get(tag) ?? { count: 0, details: new Set<string>() }
    cur.count++
    if (detail) cur.details.add(detail)
    acc.set(tag, cur)
  }
  for (const i of items) {
    if (i.outcome) continue
    const r = classifyAsRegistryLine(hospitalCode, unitBySerial.get(i.serialNo), i.serialNo)
    if (r) add(r.tag, r.detail)
    const dups = dupBySerial?.get(i.serialNo)
    if (dups?.length) add('DUPLICATE', dups.join(', '))
  }
  return AS_REGISTRY_TAGS.filter((t) => acc.has(t)).map((t) => {
    const v = acc.get(t)!
    return { tag: t, count: v.count, detail: v.details.size ? Array.from(v.details).join(', ') : null }
  })
}

/** 접수 상태가 '취소'인지 — AS_STATUS 마스터의 '취소' 코드(완료와 같은 CLOSED 매핑이라 ticket_status로는 구분 불가 → 이름 기준, `'수거중'` 자동 전이 선례) (2026-09-21) */
export function isAsCanceledStatus(status: { name: string } | null | undefined): boolean {
  return status?.name === '취소'
}

/** 목록 '접수 기기상태' 표기 — 취소 접수 → '취소'(정합 검토 대상 아님, 2026-09-21) / 미종결 라인 없음 → null(표시 안 함) / 태그 없음 → 정상 / 있음 → 확인필요 */
export function asReceiptDeviceStateLabel(hasOpenLines: boolean, tags: AsRegistryTagSummary[], intakeIssues = 0, canceled = false): '정상' | '확인필요' | '취소' | null {
  if (canceled) return '취소'
  if (!hasOpenLines) return null
  return tags.length || intakeIssues > 0 ? '확인필요' : '정상' // 입고 대조(미입고·미식별입고)는 원장 정합 태그와 별개 축 — 목록 표기만 합류
}

/** 목록 마지막 조회 쿼리스트링 보관 키 — 상세 [목록] 복귀 시 필터·페이지 복원 (2026-09-21, 프로젝트 목록 sessionStorage 선례) */
export const AS_LIST_QS_KEY = 'as_receipts_list_qs'
/** 수리대기 큐 마지막 조회 쿼리스트링 보관 키 (2026-09-28 — as_repair_queue_design.md §4.1) */
export const AS_QUEUE_QS_KEY = 'as_receipts_queue_qs'
/** 상세 [← 목록]이 돌아갈 화면 — 마지막으로 머문 쪽('list' 접수 목록 / 'queue' 수리대기). 각 페이지의 URL 동기화 effect가 기록 */
export const AS_BACK_KEY = 'as_receipts_back'
export type AsBackTarget = 'list' | 'queue'
function readAsQs(key: string): string | null {
  if (typeof window === 'undefined') return null
  try { return window.sessionStorage.getItem(key) } catch { return null }
}
/** 상세 → 목록 복귀 경로 (클라이언트 전용 — 저장된 필터가 있으면 그대로). 마지막 화면이 수리대기 큐면 큐로 (2026-09-28) */
export function asListHref(): string {
  if (readAsQs(AS_BACK_KEY) === 'queue') return asQueueHref()
  const qs = readAsQs(AS_LIST_QS_KEY)
  return qs ? `/as-receipts?${qs}` : '/as-receipts'
}
/** 수리대기 큐 복귀 경로 (클라이언트 전용) */
export function asQueueHref(): string {
  const qs = readAsQs(AS_QUEUE_QS_KEY)
  return qs ? `/as-receipts/queue?${qs}` : '/as-receipts/queue'
}

// ─── 수리대기 큐 (2026-09-28 — as_repair_queue_design.md §3) ──────────────
// 라인 1행 = 기기 1대. 기존 3축(intake_state × outcome × repaired_at)만으로 판정 — 새 컬럼 없음. 서버 where는 lib/asReceiptQueue.ts
export const AS_QUEUE_BUCKETS = ['WAITING', 'INCOMING'] as const
export type AsQueueBucket = (typeof AS_QUEUE_BUCKETS)[number]
export const AS_QUEUE_BUCKET_LABELS: Record<AsQueueBucket, string> = { WAITING: '수리 대기', INCOMING: '입고 예정' }
export const AS_QUEUE_BUCKET_DESC: Record<AsQueueBucket, string> = {
  WAITING: '정상입고됐고 수리완료 체크 전인 기기 (결과 없음 또는 교체 확정된 선교체 구기기 — 접수 종결 여부 무관)',
  INCOMING: '접수됐고 아직 입고되지 않은 기기 (입고 대기·미입고, 접수 미종결, 분실·수거없음 접수 제외)',
}
export function parseAsQueueBucket(v: string | null | undefined): AsQueueBucket {
  return (AS_QUEUE_BUCKETS as readonly string[]).includes(v ?? '') ? (v as AsQueueBucket) : 'WAITING'
}
/** 기기군 코드 (목록 ?group= 과 동일 — ECG 심전계 / SPO2 산소포화도 / ETC 기타) */
export const AS_DEVICE_GROUP_CODE_LIST = ['ECG', 'SPO2', 'ETC'] as const
export type AsDeviceGroupCode = (typeof AS_DEVICE_GROUP_CODE_LIST)[number]
export const AS_DEVICE_GROUP_CODE_LABELS: Record<AsDeviceGroupCode, AsDeviceGroup> = { ECG: '심전계', SPO2: '산소포화도', ETC: '기타' }
/** 기기군 → 큐 코드 (목록 표기 코드 `AS_DEVICE_GROUP_CODES`는 'SpO2' 대소문자 표기라 별도 — 쿼리 파라미터·counts 키는 대문자) */
export const AS_DEVICE_GROUP_TO_CODE: Record<AsDeviceGroup, AsDeviceGroupCode> = { 심전계: 'ECG', 산소포화도: 'SPO2', 기타: 'ETC' }
export function parseAsDeviceGroupCode(v: string | null | undefined): AsDeviceGroupCode {
  return (AS_DEVICE_GROUP_CODE_LIST as readonly string[]).includes(v ?? '') ? (v as AsDeviceGroupCode) : 'ECG'
}
/** 큐 일괄 수리완료 요청 상한 */
export const AS_QUEUE_BULK_MAX = 100

/** 일괄 상태변경 요청 상한 (2026-09-21) */
export const AS_BULK_STATUS_MAX = 100

export function summarizeAsItems(items: { outcome: string | null }[]): string {
  if (!items.length) return '기기 없음'
  const done = items.filter((i) => i.outcome != null && i.outcome !== '').length
  return done > 0 ? `기기 ${items.length}대 (종결 ${done})` : `기기 ${items.length}대`
}

/** 시리얼 여러 줄 입력 → 정규화 토큰 (공백 제거·대문자, 중복 제거·순서 유지) */
export function parseSerialTextarea(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of text.split(/[\r\n,]+/)) {
    const key = line.replace(/\s+/g, '').toUpperCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

/** 접수 병동 요약 (2026-09-29) — 라인 `wardName`(접수 시 입력·시트 C/I열, 원장 배치 병동 아님) 중복 제거·입력 순서 유지. 없으면 [] */
export function summarizeAsReceiptWards(items: { wardName: string | null | undefined }[]): string[] {
  const out: string[] = []
  for (const it of items) {
    const w = it.wardName?.trim()
    if (w && !out.includes(w)) out.push(w)
  }
  return out
}
