/**
 * 병원 태그 — 시스템 키 단일 소스 (2026-09-28)
 * 마스터(hospital_tags)는 엄격 정의(시드 scripts/seed-hospital-tags.sql), 사용자는 병원 상세에서 체크만.
 * 코드가 동작을 바꿀 때는 이름이 아니라 아래 키로 참조한다 (is_system 태그는 삭제·키 변경 금지).
 */
export const HOSPITAL_TAG_KEYS = {
  /** AS 접수 시 선교체가 기본인 병원 — AS접수 등록 preReplace 기본값 (연동 예정) */
  PRE_REPLACE_DEFAULT: 'PRE_REPLACE_DEFAULT',
  /** 원격 접속·원격 지원 불가 — 유지보수·VOC 화면 경고 (연동 예정) */
  NO_REMOTE_ACCESS: 'NO_REMOTE_ACCESS',
  /** 주요 고객사 — 표시용 */
  KEY_ACCOUNT: 'KEY_ACCOUNT',
} as const
export type HospitalTagKey = (typeof HOSPITAL_TAG_KEYS)[keyof typeof HOSPITAL_TAG_KEYS]

export interface HospitalTagDto {
  id: number
  key: string
  name: string
  description: string | null
  effectNote: string | null
  color: string
  isSystem: boolean
  sortOrder: number
}

export interface HospitalTagAssignmentDto {
  tag: HospitalTagDto
  assignedAt: string
  assignedBy: { id: string; name: string } | null
}

/** 병원이 해당 시스템 키 태그를 가졌는지 (서버·클라이언트 공용 판정) */
export function hasHospitalTag(tags: { key: string }[] | undefined | null, key: HospitalTagKey) {
  return !!tags?.some((t) => t.key === key)
}
