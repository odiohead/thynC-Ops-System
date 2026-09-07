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

export const AS_OUTCOMES = ['REPAIR_RETURN', 'REPLACE', 'LOST', 'CANCELED'] as const
export type AsOutcome = (typeof AS_OUTCOMES)[number]
export const AS_OUTCOME_LABELS: Record<AsOutcome, string> = {
  REPAIR_RETURN: '수리반환',
  REPLACE: '교체',
  LOST: '분실종결',
  CANCELED: '라인취소',
}

/** 미등록 라인 기기종류 선택지 (§13-5 — 통계용 최소 입력. 원장 연결 라인은 모델에서 파생) */
export const AS_DEVICE_KINDS = ['심전도', '산소포화도', '게이트웨이', '기타'] as const

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
