/**
 * 병원 thynC 시스템 현황 — EMR 연동 선택지 단일 소스 (2026-08-16)
 * 서버·클라이언트 공용 상수 (prisma 등 서버 모듈 import 금지)
 */

/** EMR 연동상태 — 단일 선택 */
export const EMR_LINK_STATUSES = ['ACK연동', 'EMR직접연동', '개발중', '미연동'] as const
export type EmrLinkStatus = (typeof EMR_LINK_STATUSES)[number]

/** 데이터 연동 범위 — 복수 선택 */
export const EMR_DATA_SCOPES = ['환자정보조회', '일일레포트', '이벤트 심전도', '생체신호'] as const

/** 연동 방식 — 복수 선택 */
export const EMR_LINK_METHODS = ['API', 'HL7(TCP/IP)', 'SFTP'] as const

export function isEmrLinkStatus(v: unknown): v is EmrLinkStatus {
  return typeof v === 'string' && (EMR_LINK_STATUSES as readonly string[]).includes(v)
}

/** URL 입력 정제 — http(s)만 허용 (javascript: 등 차단). undefined=미전송 유지, 빈 값·비허용 스킴=null */
export function sanitizeUrl(v: unknown): string | null | undefined {
  if (v === undefined) return undefined
  if (typeof v !== 'string' || !v.trim()) return null
  const url = v.trim()
  if (!/^https?:\/\//i.test(url)) return null
  return url
}

/** 배열 입력을 화이트리스트로 정제 (순서는 화이트리스트 기준 고정) */
export function sanitizeChoices(input: unknown, whitelist: readonly string[]): string[] {
  if (!Array.isArray(input)) return []
  const set = new Set(input.filter((x): x is string => typeof x === 'string'))
  return whitelist.filter((w) => set.has(w))
}
