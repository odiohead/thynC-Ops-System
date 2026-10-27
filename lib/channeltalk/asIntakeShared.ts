/**
 * AS 인입(채널톡 상담 → AS접수) — 클라이언트 안전 상수·라벨 (projects/as_channeltalk_intake_design.md)
 * 서버 전용 코드(prisma·AI)는 asIntake.ts / lib/ai/asExtract.ts 에만 둔다.
 */

export const CHANNELTALK_AS_INTAKE_KEY = 'channeltalk_as_intake' // off / dry(판정·추출 로그만, 생성·큐 적재 없음) / on
export const CHANNELTALK_AS_INTAKE_CUTOVER_KEY = 'channeltalk_as_intake_cutover' // YYYY-MM-DD(KST) — 이 일자 이후 고객 첫 발화 상담만. on 저장 시 필수
export const CHANNELTALK_AS_SHEET_MODE_KEY = 'channeltalk_as_sheet_mode' // create(현행 — 시트 행으로 접수 생성) / link(연결 전용 — 생성 없이 기존 접수 찾아 AJ 기입)

export const AS_INTAKE_MODES = ['off', 'dry', 'on'] as const
export type AsIntakeMode = (typeof AS_INTAKE_MODES)[number]
export const AS_INTAKE_MODE_LABEL: Record<AsIntakeMode, string> = { off: 'OFF', dry: '그림자(로그만)', on: 'ON' }

export const AS_SHEET_MODES = ['create', 'link'] as const
export type AsSheetMode = (typeof AS_SHEET_MODES)[number]
export const AS_SHEET_MODE_LABEL: Record<AsSheetMode, string> = { create: '생성(현행)', link: '연결 전용' }

/** AS 인입 트리거 태그 — 이 2종만 (사용자 확정 2026-10-27) */
export const AS_INTAKE_TAGS = ['f_AS_고장접수', 'f_AS_분실접수'] as const
export const AS_TAG_FAULT = 'f_AS_고장접수'
export const AS_TAG_LOST = 'f_AS_분실접수'

export const AS_INTAKE_STATES = ['PENDING', 'LINKED', 'IGNORED'] as const
export type AsIntakeState = (typeof AS_INTAKE_STATES)[number]
export const AS_INTAKE_STATE_LABEL: Record<AsIntakeState, string> = { PENDING: '등록대기', LINKED: '연결됨', IGNORED: 'AS 아님' }

/** 자동 생성 실패 분류 (as_intake_links.fail_class) */
export const AS_INTAKE_FAIL_LABEL: Record<string, string> = {
  NO_CONFIRM: '확인문 없음 (자유 상담 — 사람 입력)',
  NO_COMPLETION: '접수 완료 안내 없음 (미확정)',
  PARSE_INCOMPLETE: '확인문 라벨 결손',
  HOSPITAL_UNMATCHED: '병원 미매칭',
  HOSPITAL_CONFLICT: 'OpsCode↔병원명 불일치',
  NO_SERIAL: '시리얼 없음',
  BAD_SERIAL: '시리얼 형식 오류',
  UNKNOWN_DEVICE: '기기 원장에 없는 시리얼',
  MIXED_CATEGORY: '고장+분실 혼합',
  MULTI_DEST: '수령지 2곳 이상 (분할 여부 결정)',
  ALREADY_EXISTS: '동일 접수 존재 (연결 확인)',
  TX_ABORT: '기기 동시 변경 — 재시도 소진',
  ERROR: '생성 오류',
}

export const AS_INTAKE_IGNORE_REASONS = ['PROGRESS', 'ACCESSORY', 'DUPLICATE', 'OTHER'] as const
export type AsIntakeIgnoreReason = (typeof AS_INTAKE_IGNORE_REASONS)[number]
export const AS_INTAKE_IGNORE_LABEL: Record<AsIntakeIgnoreReason, string> = { PROGRESS: '진행 문의', ACCESSORY: '부속품·소모품', DUPLICATE: '중복 접수', OTHER: '기타' }

/** 추출 결과 — as_intake_links.extracted (JSON) · 큐 상세 프리필 · 변경 감지 비교 단위 */
export interface AsExtractLine { serial: string; ward: string | null; symptom: string | null }
export interface AsExtract {
  hospitalNameRaw: string | null
  hospitalCode: string | null
  hospitalMatchSource: 'opscode' | 'name' | 'none' | 'conflict'
  hospitalNameMatchCode: string | null // 병원명 매처 결과(OpsCode와 비교용)
  category: 'FAULT' | 'LOST'
  mixedCategory: boolean
  receiptDate: string // YYYY-MM-DD (KST) — 접수 완료 안내 시각, 없으면 고객 첫 발화
  reporterName: string | null
  wards: string[]
  deviceKindText: string | null
  lines: AsExtractLine[]
  invalidSerials: string[]
  unknownSerials: string[] // 기기 원장에 없음
  destInfo: string | null
  pickupDestInfo: string | null
  pickupDestDiffers: boolean
  destCount: number // 확인문에 적힌 수령지/발송지 구획 수 — 2 이상이면 다병동 분할 판단 필요(MULTI_DEST, 2026-10-27 보완 4)
  preReplace: boolean
  preReplaceSource: 'confirmation' | 'chat' | 'hospital_tag' | null
  hasConfirmation: boolean
  hasCompletion: boolean
  labels: string[]
  confirmationMessageId: string | null
  completionMessageId: string | null
}

/** 접수 생성 후 채널톡 변경 감지 diff 항목 */
export interface AsIntakeDiffItem { field: string; label: string; current: string | null; chat: string | null }
