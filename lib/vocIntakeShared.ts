/**
 * VOC 등록대기 큐 — 클라이언트 안전 상수·타입 (projects/voc_sheet_import_design.md)
 * 서버 전용 코드(prisma)는 lib/vocImport.ts · lib/channeltalk/vocPromote.ts 에만 둔다.
 */

export const VOC_INTAKE_STATES = ['PENDING', 'REGISTERED', 'IGNORED'] as const
export type VocIntakeState = (typeof VOC_INTAKE_STATES)[number]
export const VOC_INTAKE_STATE_LABEL: Record<VocIntakeState, string> = { PENDING: '등록대기', REGISTERED: '등록됨', IGNORED: 'VOC 아님' }

export const VOC_INTAKE_SOURCES = ['SHEET', 'CHANNELTALK'] as const
export type VocIntakeSource = (typeof VOC_INTAKE_SOURCES)[number]
export const VOC_INTAKE_SOURCE_LABEL: Record<VocIntakeSource, string> = { SHEET: 'VOC현황 시트', CHANNELTALK: '채널톡 상담' }

/** 자동 생성 못 한 사유 (voc_intake_items.fail_class) */
export const VOC_INTAKE_FAIL_LABEL: Record<string, string> = {
  HOSPITAL_UNMATCHED: '병원 미매칭 (시트 병원명이 마스터와 일치하지 않음)',
  HOSPITAL_UNKNOWN: '병원 확인불가 (시트에 병원명 없음)',
  NO_TAG: '분류 태그 없음 (종료 24시간 경과)',
  OLD_TAG: '구 태그명만 (현 VOC 분류 마스터에 없음)',
  ERROR: '적재 오류',
}

export const VOC_INTAKE_IGNORE_REASONS = ['NOT_VOC', 'DUPLICATE', 'TEST', 'OTHER'] as const
export type VocIntakeIgnoreReason = (typeof VOC_INTAKE_IGNORE_REASONS)[number]
export const VOC_INTAKE_IGNORE_LABEL: Record<VocIntakeIgnoreReason, string> = { NOT_VOC: 'VOC 아님 (인사·발송 안내 등)', DUPLICATE: '중복', TEST: '테스트', OTHER: '기타' }

/** 시트 원본 열 (VOC현황_NEW) — 큐 상세 우측 원문 패널·VOC 본문 메모 블록 원천 */
export interface VocSheetOrigin {
  row: number
  date: string // YYYY-MM-DD
  hospital: string
  ward: string | null
  phone: boolean // 유선문의체크
  registrant: string | null
  content: string
  resolution: string | null
  dept: string | null
  checker: string | null
  typeL: string | null
  typeM: string | null
  typeS: string | null
  repeat: string | null
  firstDone: string | null
  receivedTime: string | null // 접수시간 'YYYY/MM/DD HH:mm'
  firstDoneAt: string | null
  allDone: string | null
  allDoneAt: string | null
  tag: string | null
  alf: string | null
}

/** 등록대기 프리필 초안 (voc_intake_items.draft) — 등록 폼 초기값 */
export interface VocIntakeDraft {
  hospitalCode: string | null
  hospitalNameRaw: string | null
  title: string
  content: string
  resolution: string | null
  receivedAt: string // ISO
  resolvedAt: string | null // YYYY-MM-DD
  statusName: string | null // VOC_STATUS name
  channelName: string | null // VOC_CHANNEL name
  tag: string | null // VOC_TYPE value (분류 태그) — 마스터에 없으면 null
  tagRaw: string | null // 원 태그명(구 태그 등, 참고 표시)
  registrantName: string | null
  sheet?: VocSheetOrigin
}
