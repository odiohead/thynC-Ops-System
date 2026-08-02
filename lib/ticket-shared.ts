// 클라이언트/서버 공용 — prisma 미의존. 서버 전용 헬퍼는 lib/ticket.ts
import type { TicketStatus, TicketSeverity } from '@prisma/client'

// 상태 전이표 — ticket_dev_schedule.md P2 상세 설계. 여기 없는 전이는 전부 거부.
export const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['ASSIGNED', 'CLOSED'],
  ASSIGNED: ['IN_PROGRESS', 'OPEN', 'CLOSED'],
  IN_PROGRESS: ['PENDING', 'RESOLVED', 'ASSIGNED'],
  PENDING: ['IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: [],
}

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[from]?.includes(to) ?? false
}

// 상태 표기는 영문 (2026-07-24 사용자 지시 — AWS SIM 스타일)
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: 'Open',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  PENDING: 'Pending',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
}

export const TICKET_STATUS_COLORS: Record<TicketStatus, string> = {
  OPEN: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  ASSIGNED: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  IN_PROGRESS: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  PENDING: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  RESOLVED: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  CLOSED: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

// 도메인 상태코드에 매핑 가능한 티켓 상태 — ASSIGNED는 OPEN 계열에서 owner 유무로 엔진이 자동 판정
// (ticket_status_map_design.md §3 — status_codes.ticket_status / build_statuses.ticket_status)
export const MAPPABLE_TICKET_STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED']

// 개인 업무 Assignment Group 이름 (2026-08-03 방안 2 — 단일 소스)
// 생성 폼 '개인 업무' 토글의 CTI 탐색 키이자 티켓 대시보드 집계 제외 기준.
// seed-ticket-masters.sql §5와 일치해야 함 (그룹명 변경 시 동반 수정).
export const PERSONAL_QUEUE_NAME = '개인 업무'

export const TICKET_SEVERITY_LABELS: Record<TicketSeverity, string> = {
  SEV1: 'Sev1 · Critical',
  SEV2: 'Sev2 · Urgent',
  SEV3: 'Sev3 · Standard',
  SEV4: 'Sev4 · Low',
  SEV5: 'Sev5 · Backlog',
}

export const TICKET_SEVERITY_COLORS: Record<TicketSeverity, string> = {
  SEV1: 'bg-red-600 text-white dark:bg-red-700',
  SEV2: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  SEV3: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  SEV4: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  SEV5: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

export type TicketLogType =
  | 'comment'
  | 'created'
  | 'status_change'
  | 'assign'
  | 'queue_transfer'
  | 'sev_change'
  | 'cti_change'
  | 'link'
  | 'system'
