/**
 * Slack 알림 이벤트 카탈로그 — 단일 소스 (projects/domain_event_notify_design.md, 2026-10-27)
 *
 * "무슨 일이 생기면 어디로 알림이 가는가"를 이벤트 축으로 관리한다.
 *  - 이벤트 사용 여부: AppSetting `notify_event_enabled` (JSON {key: boolean}, 기본 true) — 구 `notify_event_toggles`·`notify_types_enabled` 대체
 *  - 채널·조건·멘션: `notify_routes.event_type` = 이 카탈로그의 key
 *  - 새 알림 = 여기에 항목 1개 + 발생 지점에 `notifyDomainEvent()` 1줄 (전용 테이블·설정 키 신설 금지)
 * 클라이언트 안전(상수만). 서버 발송 로직은 lib/notify.ts.
 */

export const NOTIFY_EVENT_GROUPS = [
  { key: 'TICKET', label: '티켓 공통', description: '모든 업무 티켓(AS·VOC·유지보수·출고…)에 공통으로 일어나는 이벤트' },
  { key: 'SLA', label: 'SLA', description: 'SLA 시계가 판정하는 지연 이벤트 (기준값은 SLA 기준 탭)' },
  { key: 'AS', label: 'AS업무', description: 'AS접수 처리 단계별 이벤트' },
  { key: 'VOC', label: 'VOC', description: '채널톡 승격·변경 이벤트' },
  { key: 'OPS', label: '운영', description: '연동·배치 장애 등 운영자용 이벤트' },
] as const
export type NotifyEventGroup = (typeof NOTIFY_EVENT_GROUPS)[number]['key']

/** 라우팅 규칙에서 쓸 수 있는 조건 축 */
export type NotifyCondition = 'refTypes' | 'queues' | 'severities' | 'statusTo' | 'metrics'

export interface NotifyEventDef {
  key: string
  label: string
  group: NotifyEventGroup
  description: string
  /** ticket = 티켓 파이프라인(notifyTicketCreated/Changed) · sla = SLA 엔진 · digest = 전역 요약 · domain = 도메인 이벤트(notifyDomainEvent) */
  kind: 'ticket' | 'sla' | 'digest' | 'domain'
  /** false = 키만 예약, 발생 지점 미구현 (화면에 표시만, 규칙 추가 불가) */
  implemented: boolean
  /** 도메인 이벤트의 고정 업무 유형 */
  refType?: string
  conditions: NotifyCondition[]
  /** 구 notify_event_toggles 키 — 마이그레이션 매핑용 */
  legacyToggle?: 'created' | 'statusChanged' | 'queueTransferred' | 'sevEscalated' | 'assigned'
}

const TICKET_CONDS: NotifyCondition[] = ['refTypes', 'queues', 'severities']

export const NOTIFY_EVENTS: readonly NotifyEventDef[] = [
  // ── 티켓 공통 ──
  { key: 'TICKET_CREATED', label: '티켓 등록', group: 'TICKET', kind: 'ticket', implemented: true, conditions: TICKET_CONDS, legacyToggle: 'created', description: '업무(티켓)가 새로 등록됐을 때 — 수동 등록·자동 인입 모두' },
  { key: 'TICKET_STATUS_CHANGED', label: '상태 변경', group: 'TICKET', kind: 'ticket', implemented: true, conditions: [...TICKET_CONDS, 'statusTo'], legacyToggle: 'statusChanged', description: '티켓 상태가 바뀌었을 때 (조건으로 "이 상태로 바뀔 때만" 지정 가능)' },
  { key: 'TICKET_ASSIGNED', label: '담당자 배정', group: 'TICKET', kind: 'ticket', implemented: true, conditions: TICKET_CONDS, legacyToggle: 'assigned', description: '담당자가 새로 배정됐을 때 (채널에 담당자 @멘션)' },
  { key: 'TICKET_QUEUE_TRANSFERRED', label: 'Assignment Group 이관', group: 'TICKET', kind: 'ticket', implemented: true, conditions: TICKET_CONDS, legacyToggle: 'queueTransferred', description: '티켓이 다른 Assignment Group으로 옮겨졌을 때' },
  { key: 'SEV_ESCALATED', label: 'Sev 상향 (1·2)', group: 'TICKET', kind: 'ticket', implemented: true, conditions: TICKET_CONDS, legacyToggle: 'sevEscalated', description: 'Sev3·4에서 Sev1·2로 올라갔을 때' },
  // ── SLA ──
  { key: 'SLA_WARNING', label: 'SLA 임박', group: 'SLA', kind: 'sla', implemented: true, conditions: [...TICKET_CONDS, 'metrics'], description: '기한 대비 경고 비율(기본 80%)에 도달한 시계' },
  { key: 'SLA_BREACH', label: 'SLA 초과 (즉시)', group: 'SLA', kind: 'sla', implemented: true, conditions: [...TICKET_CONDS, 'metrics'], description: '기한을 넘긴 시계 — 다음 점검 주기에 1회 발송' },
  { key: 'DAILY_DIGEST', label: 'SLA 일일 요약', group: 'SLA', kind: 'digest', implemented: true, conditions: [], description: '지정 시각에 초과·임박 전체를 한 채널로 요약. 시각·채널은 공통 탭의 전역 요약 설정' },
  // ── AS업무 ──
  { key: 'AS_INTAKE_CONFIRMED', label: 'AS 입고확인', group: 'AS', kind: 'domain', implemented: true, refType: 'AS', conditions: ['queues', 'severities'], description: '담당자가 입고확인을 실행했을 때 (부분 입고 포함, 실행 1회 = 알림 1건 — 입고 기기·입고일·불일치 포함)' },
  { key: 'AS_SHIPPED', label: 'AS 발송정보 입력', group: 'AS', kind: 'domain', implemented: false, refType: 'AS', conditions: ['queues', 'severities'], description: '수리품·교체기 발송정보(송장·발송일)가 입력됐을 때' },
  { key: 'AS_REGISTRY_CONFIRMED', label: 'AS 원장확정', group: 'AS', kind: 'domain', implemented: false, refType: 'AS', conditions: ['queues', 'severities'], description: '미등록·타 병원 배치 라인을 원장에 확정했을 때' },
  { key: 'AS_INTAKE_QUEUED', label: 'AS 등록대기 적재', group: 'AS', kind: 'domain', implemented: false, refType: 'AS', conditions: [], description: '채널톡 상담이 자동 접수에 실패해 등록대기 큐에 들어갔을 때' },
  // ── VOC ──
  { key: 'VOC_AUTO_CREATED', label: 'VOC 자동 승격', group: 'VOC', kind: 'domain', implemented: false, refType: 'VOC', conditions: ['queues'], description: '채널톡 태그로 VOC가 자동 생성됐을 때 (현재는 티켓 등록 이벤트로 발송)' },
  { key: 'VOC_CHAT_CHANGE_DETECTED', label: '채널톡 변경 감지', group: 'VOC', kind: 'domain', implemented: false, refType: 'AS', conditions: ['queues'], description: '접수 후 원천 상담이 바뀌어 반영 판단이 필요할 때' },
  // ── 운영 ──
  { key: 'OPS_CHANNELTALK_SYNC_FAILED', label: '채널톡 동기화 실패', group: 'OPS', kind: 'domain', implemented: false, conditions: [], description: '채널톡 폴링 틱이 오류로 끝났을 때' },
  { key: 'OPS_SHEET_UNLINKED', label: '시트 행 미연결', group: 'OPS', kind: 'domain', implemented: false, conditions: [], description: '연결 전용 모드에서 24시간 내 채널톡 경로 접수를 못 찾은 시트 행' },
]

export const NOTIFY_EVENT_KEYS = NOTIFY_EVENTS.map((e) => e.key)
export const NOTIFY_EVENT_MAP: Record<string, NotifyEventDef> = Object.fromEntries(NOTIFY_EVENTS.map((e) => [e.key, e]))
export const NOTIFY_EVENT_ENABLED_KEY = 'notify_event_enabled' // AppSetting JSON {eventKey: boolean}
export const isDomainEvent = (key: string) => NOTIFY_EVENT_MAP[key]?.kind === 'domain'
export const NOTIFY_EVENT_LABEL: Record<string, string> = Object.fromEntries(NOTIFY_EVENTS.map((e) => [e.key, e.label]))
