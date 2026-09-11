/**
 * AS업무(AS접수) 공용 상수 — 클라이언트 안전 (projects/as_work_design.md §3·§4)
 * 서버 헬퍼(코드 발번·권한 판정)는 lib/asReceipt.ts.
 */

export const AS_CATEGORIES = ['FAULT', 'LOST'] as const
export type AsCategory = (typeof AS_CATEGORIES)[number]
export const AS_CATEGORY_LABELS: Record<AsCategory, string> = { FAULT: '고장', LOST: '분실' }

export const AS_METHODS = ['PARCEL', 'VISIT'] as const
export type AsMethod = (typeof AS_METHODS)[number]
/** 수거방법 라벨 (2026-09-04 확정 — 수거/발송 각자 방법 플래그, 단계 일괄 스킵 없음) */
export const AS_PICKUP_METHOD_LABELS: Record<AsMethod, string> = { PARCEL: '택배수거', VISIT: '방문수거' }
export const AS_SHIP_METHOD_LABELS: Record<AsMethod, string> = { PARCEL: '택배발송', VISIT: '방문교체' }

export const AS_DEST_TYPES = ['HOSPITAL', 'OTHER'] as const
export type AsDestType = (typeof AS_DEST_TYPES)[number]
export const AS_DEST_TYPE_LABELS: Record<AsDestType, string> = { HOSPITAL: '병원', OTHER: '기타(대웅 등)' }

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

// ─── 목록 원장 정합 태그 (2026-09-10) ──────────────────────────
// 접수 병원과 라인 기기의 현재 원장 배치를 대조 — 미종결 라인만 평가(종결 라인은 교체·분실로 회수되는 게 정상이라 제외)
export const AS_REGISTRY_TAGS = ['OTHER_HOSPITAL', 'RECOVERED', 'UNPLACED', 'UNREGISTERED'] as const
export type AsRegistryTag = (typeof AS_REGISTRY_TAGS)[number]
export const AS_REGISTRY_TAG_LABELS: Record<AsRegistryTag, string> = {
  OTHER_HOSPITAL: '타병원', // 원장상 다른 병원에 ACTIVE 배치
  RECOVERED: '회수', // 원장상 회수(RECOVERED) 상태 — 어느 병원에도 배치 아님
  UNPLACED: '미배치', // 원장 개체는 있으나 배치 이력 없음
  UNREGISTERED: '미등록', // 원장에 시리얼 자체가 없음
}
export const AS_REGISTRY_TAG_DESC: Record<AsRegistryTag, string> = {
  OTHER_HOSPITAL: '기기현황에 다른 병원 배치로 등록된 기기 — 배치 확인 필요',
  RECOVERED: '기기현황에 회수 상태로 등록된 기기 — 재배치 여부 확인 필요',
  UNPLACED: '기기현황에 개체는 있으나 병원 배치가 없는 기기',
  UNREGISTERED: '기기현황에 등록되지 않은 시리얼',
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

/** 라인별 현재 배치 → 접수 단위 태그 집계(태그 순서 고정). 미종결 라인만 */
export function summarizeAsRegistryTags(
  hospitalCode: string,
  items: { serialNo: string; outcome: string | null }[],
  unitBySerial: Map<string, NonNullable<AsRegistryUnit>>
): AsRegistryTagSummary[] {
  const acc = new Map<AsRegistryTag, { count: number; details: Set<string> }>()
  for (const i of items) {
    if (i.outcome) continue
    const r = classifyAsRegistryLine(hospitalCode, unitBySerial.get(i.serialNo))
    if (!r) continue
    const cur = acc.get(r.tag) ?? { count: 0, details: new Set<string>() }
    cur.count++
    if (r.detail) cur.details.add(r.detail)
    acc.set(r.tag, cur)
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
