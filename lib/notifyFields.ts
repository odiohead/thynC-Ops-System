/**
 * Slack 알림 메시지 필드 카탈로그 (function_notification.md Phase 2 추가요구)
 *
 * 업무 타입별로 메시지에 포함할 수 있는 선택 필드 목록 + 추천 기본값.
 * 설정 페이지(/settings/notifications)와 lib/notify.ts가 이 정의를 공유한다.
 * (항상 표시되는 고정 요소 — 업무타입·병원명/제목·상세링크 — 는 여기 대상 아님)
 */

import type { TaskType } from '@/lib/notify'

export interface FieldDef {
  key: string
  label: string
}

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  PROJECT: '프로젝트',
  SITE_VISIT: '답사',
  INSTALL_PLAN: '설치계획',
  MAINTENANCE: '유지보수',
  ETC: '기타업무',
  TICKET: '티켓',
}

/** 타입별 선택 가능한 필드 (순서 = 메시지 표시 순서) */
export const FIELD_CATALOG: Record<TaskType, FieldDef[]> = {
  PROJECT: [
    { key: 'assignees', label: '담당자' },
    { key: 'buildStatus', label: '공사상태' },
    { key: 'contractDate', label: '계약일' },
    { key: 'introType', label: '도입형태' },
    { key: 'startDate', label: '구축시작일' },
    { key: 'endDateExpected', label: '완료예정일' },
    { key: 'constructor', label: '시공사' },
    { key: 'scale', label: '병동/병상/G-W' },
  ],
  SITE_VISIT: [
    { key: 'assignees', label: '담당자' },
    { key: 'requestDate', label: '요청일' },
    { key: 'visitDate', label: '방문일' },
    { key: 'replyDate', label: '회신일' },
    { key: 'status', label: '답사상태' },
    { key: 'daewoong', label: '대웅담당자' },
  ],
  INSTALL_PLAN: [
    { key: 'assignees', label: '담당자' },
    { key: 'requestDate', label: '요청일' },
    { key: 'replyDate', label: '회신일' },
    { key: 'writeStatus', label: '작성완료여부' },
    { key: 'replyStatus', label: '회신여부' },
  ],
  MAINTENANCE: [
    { key: 'assignees', label: '담당자' },
    { key: 'priority', label: '우선순위' },
    { key: 'type', label: '장애유형' },
    { key: 'status', label: '상태' },
    { key: 'reporterName', label: '신고자' },
    { key: 'reportedAt', label: '접수일' },
    { key: 'resolvedAt', label: '완료일' },
    { key: 'isRemote', label: '원격처리' },
    { key: 'visits', label: '방문일정' },
  ],
  ETC: [
    { key: 'assignees', label: '담당자' },
    { key: 'priority', label: '우선순위' },
    { key: 'status', label: '상태' },
    { key: 'reportedAt', label: '접수일' },
    { key: 'resolvedAt', label: '완료일' },
    { key: 'hospitals', label: '관련병원' },
    { key: 'visits', label: '업무기간' },
  ],
  TICKET: [
    { key: 'owner', label: '담당자' },
    { key: 'severity', label: 'Severity' },
    { key: 'status', label: '상태' },
    { key: 'queue', label: '큐' },
    { key: 'cti', label: '분류' },
    { key: 'dueAt', label: '처리기한' },
  ],
}

/** 타입별 추천 기본 노출 필드 (설정 미지정 시 적용) */
export const DEFAULT_FIELDS: Record<TaskType, string[]> = {
  PROJECT: ['assignees', 'buildStatus', 'startDate'],
  SITE_VISIT: ['assignees', 'requestDate', 'visitDate'],
  INSTALL_PLAN: ['assignees', 'requestDate', 'writeStatus', 'replyStatus'],
  MAINTENANCE: ['assignees', 'priority', 'type', 'reportedAt'],
  ETC: ['assignees', 'priority', 'reportedAt'],
  TICKET: ['owner', 'severity', 'queue'],
}

export const TASK_TYPES: TaskType[] = ['PROJECT', 'SITE_VISIT', 'INSTALL_PLAN', 'MAINTENANCE', 'ETC', 'TICKET']
