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

export const AS_OUTCOMES = ['REPAIR_RETURN', 'REPLACE', 'LOST', 'CANCELED', 'NOT_RECEIVED'] as const
export type AsOutcome = (typeof AS_OUTCOMES)[number]
export const AS_OUTCOME_LABELS: Record<AsOutcome, string> = {
  REPAIR_RETURN: '수리반환',
  REPLACE: '교체',
  LOST: '분실종결',
  CANCELED: '라인취소',
  NOT_RECEIVED: '미회수', // 입고 대조 예외 — 접수자 확인에서만 확정 (2026-09-11)
}
/** 라인 처리 패널에서 고를 수 있는 결과 — 미회수는 접수자 확인 절차 전용 */
export const AS_RESOLVE_OUTCOMES = ['REPAIR_RETURN', 'REPLACE', 'LOST', 'CANCELED'] as const

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

// ─── 수리완료 체크 (2026-09-17 — device_condition_location_design.md §5.6·§7.2) ───
/** 결과가 이 집합이면 수리완료 대상이 아니다(분실·취소·미회수) */
export const AS_REPAIR_EXCLUDED_OUTCOMES: readonly string[] = ['LOST', 'CANCELED', 'NOT_RECEIVED']
/**
 * 라인 수리완료 체크 가능 여부 — 입고된 라인(D5)만, 분실·취소·미회수 라인 제외. 접수 상태(종결 포함, A-2)·outcome NULL/REPAIR_RETURN/REPLACE는 허용.
 * 카드 헤더 `수리완료 n/m`의 m(분모)도 이 판정으로 센다.
 */
export function canMarkAsLineRepaired(item: { intakeState: string | null | undefined; outcome: string | null | undefined }): boolean {
  return item.intakeState === 'RECEIVED' && !AS_REPAIR_EXCLUDED_OUTCOMES.includes(item.outcome ?? '')
}
/** 체크박스 비활성 사유 툴팁(§6.1) — 체크 가능하면 null */
export function asRepairDisabledReason(item: { intakeState: string | null | undefined; outcome: string | null | undefined }): string | null {
  if (canMarkAsLineRepaired(item)) return null
  if (AS_REPAIR_EXCLUDED_OUTCOMES.includes(item.outcome ?? '')) return '분실·취소·미회수 라인'
  return '입고 후 체크할 수 있습니다'
}
/** 수리 진행도 `수리완료 n/m` — m = 체크 가능 라인 수(canMarkAsLineRepaired), n = 그중 repaired_at 있음. m=0이면 표시하지 않는다(호출부) */
export function summarizeAsRepairProgress(items: { intakeState: string | null | undefined; outcome: string | null | undefined; repairedAt?: string | Date | null }[]): { repaired: number; repairable: number } {
  let repaired = 0
  let repairable = 0
  for (const i of items) {
    if (!canMarkAsLineRepaired(i)) continue
    repairable++
    if (i.repairedAt) repaired++
  }
  return { repaired, repairable }
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
  serial: '시리얼번호',
  code: '접수번호',
  tracking: '송장번호', // 수거(접수 헤더)·발송(라인) 모두, 영숫자만 비교
  owner: '담당자', // 연결 티켓 담당자 이름
}
export const AS_SEARCH_FIELD_PLACEHOLDER: Record<AsSearchField, string> = {
  all: '접수번호·병원·시리얼·송장·담당자 (쉼표로 여러 개)',
  hospital: '병원명 (쉼표로 여러 개)',
  serial: '시리얼번호 (쉼표로 여러 개)',
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
export const AS_REGISTRY_TAGS = ['OTHER_HOSPITAL', 'RECOVERED', 'UNPLACED', 'UNREGISTERED', 'DUPLICATE'] as const
export type AsRegistryTag = (typeof AS_REGISTRY_TAGS)[number]
export const AS_REGISTRY_TAG_LABELS: Record<AsRegistryTag, string> = {
  OTHER_HOSPITAL: '타병원', // 원장상 다른 병원에 ACTIVE 배치
  RECOVERED: '회수', // 원장상 회수(RECOVERED) 상태 — 어느 병원에도 배치 아님
  UNPLACED: '미배치', // 원장 개체는 있으나 배치 이력 없음
  UNREGISTERED: '미등록', // 원장에 시리얼 자체가 없음
  DUPLICATE: '중복접수', // 같은 시리얼의 미종결 라인이 다른 AS접수에도 있음
}
export const AS_REGISTRY_TAG_DESC: Record<AsRegistryTag, string> = {
  OTHER_HOSPITAL: '기기현황에 다른 병원 배치로 등록된 기기 — 배치 확인 필요',
  RECOVERED: '기기현황에 회수 상태로 등록된 기기 — 재배치 여부 확인 필요',
  UNPLACED: '기기현황에 개체는 있으나 병원 배치가 없는 기기',
  UNREGISTERED: '기기현황에 등록되지 않은 시리얼',
  DUPLICATE: '같은 시리얼의 미종결 라인이 다른 AS접수에도 있음 — 중복 접수 여부 확인 필요',
}
export interface AsRegistryTagSummary { tag: AsRegistryTag; count: number; detail: string | null } // detail: 타병원명 등

export type AsRegistryUnit = { placement: { status: string; hospitalCode: string | null; hospitalName: string | null } | null } | undefined
export interface AsRegistryLineTag { tag: AsRegistryTag; detail: string | null } // detail: 타병원명

/** 라인 1개의 현재 배치 → 태그 (정상이면 null). unit: 원장 조회 결과(undefined = 미등록) */
export function classifyAsRegistryLine(hospitalCode: string, unit: AsRegistryUnit): AsRegistryLineTag | null {
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
    const r = classifyAsRegistryLine(hospitalCode, unitBySerial.get(i.serialNo))
    if (r) add(r.tag, r.detail)
    const dups = dupBySerial?.get(i.serialNo)
    if (dups?.length) add('DUPLICATE', dups.join(', '))
  }
  return AS_REGISTRY_TAGS.filter((t) => acc.has(t)).map((t) => {
    const v = acc.get(t)!
    return { tag: t, count: v.count, detail: v.details.size ? Array.from(v.details).join(', ') : null }
  })
}

/** 목록 '접수 기기상태' 표기 — 미종결 라인 없음 → null(표시 안 함), 태그 없음 → 정상, 있음 → 확인필요 */
export function asReceiptDeviceStateLabel(hasOpenLines: boolean, tags: AsRegistryTagSummary[], intakeIssues = 0): '정상' | '확인필요' | null {
  if (!hasOpenLines) return null
  return tags.length || intakeIssues > 0 ? '확인필요' : '정상' // 입고 대조(미입고·미식별입고)는 원장 정합 태그와 별개 축 — 목록 표기만 합류
}

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
