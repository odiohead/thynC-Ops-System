/**
 * 티켓 도메인 메타 — 클라이언트 안전 단일 소스 (cs_ticket_workflow_design.md §3)
 *
 * "이 refType이면 라벨·경로·알림 타입이 무엇인가"를 여기 한 곳에만 기술한다.
 * 서버 전용 로직(생성·동기화)은 lib/ticket-domains/<domain>.ts 어댑터,
 * 배지 색상(Tailwind 클래스)은 JIT 스캔 범위 문제로 app/tickets/components/TicketRefTypeBadge.tsx 참조
 * — 단, 그 색상 맵은 Record<DomainRefType, …> 타입이라 여기 도메인을 추가하면 누락이 컴파일 오류가 된다.
 *
 * 신규 도메인 추가 절차는 projects/cs_ticket_workflow_design.md §3.4 (SOP).
 * ⚠ 이 파일은 클라이언트 번들에 포함된다 — prisma 등 서버 모듈 import 금지.
 */

/** 도메인 연결 유형 — tickets.ref_type과 동일 값 (구 lib/ticketCtiRules.ts에서 이동) */
export const DOMAIN_REF_TYPES = ['SITE_VISIT', 'INSTALL_PLAN', 'PROJECT', 'ETC', 'MAINTENANCE', 'VOC', 'STOCK_OUT'] as const
export type DomainRefType = (typeof DOMAIN_REF_TYPES)[number]

export function isDomainRefType(v: unknown): v is DomainRefType {
  return typeof v === 'string' && (DOMAIN_REF_TYPES as readonly string[]).includes(v)
}

/** 순수 티켓(refType NULL) 표기 — 목록 필터 'none' / 지표 'PURE' / 알림·SLA 'NONE' 센티널이 공유하는 라벨 */
export const PURE_TICKET_LABEL = '순수 티켓'

/** 알림 업무 타입 (lib/notify.ts TaskType과 동일 값 집합 — 순환 import 방지를 위해 여기서 문자열로 보관) */
export type DomainTaskType = 'PROJECT' | 'SITE_VISIT' | 'INSTALL_PLAN' | 'MAINTENANCE' | 'ETC' | 'VOC' | 'STOCK_OUT'

export interface TicketDomainMeta {
  /** 사람용 라벨 (배지·필터·설정 화면 공용) */
  label: string
  /** 목록 경로 (설정 버튼이 붙는 화면) */
  listPath: string
  /** 도메인 상세 경로 — 연결 업무 배너·링크용 (PROJECT만 코드 라우팅, 나머지는 숫자 id) */
  detailHref: (ref: { id: number; code: string | null }) => string
  /** 도메인 코드 prefix (참고용 — 발번은 도메인 측 소유) */
  codePrefix: string
  /** 설명으로 옮길 도메인 필드의 사람용 이름 */
  descriptionSource: string
  /** 소스 필드가 리치텍스트(Tiptap HTML)인지 — false면 plain text */
  descriptionIsHtml: boolean
  /** 자동생성 규칙의 조건 축(장애유형 등) status_codes 카테고리 (없으면 null) */
  matchCategory: string | null
  matchLabel: string | null
  /** 규칙이 없을 때 코드 폴백이 쓰는 Assignment Group 이름 (안내 표시용) */
  fallbackQueueName: string
  /** 알림(lib/notify) 업무 타입 매핑 */
  taskType: DomainTaskType
  /** 도메인 워크플로 상태 마스터 — status_codes 카테고리 (build_statuses 사용 도메인은 null) */
  statusCategory: string | null
  /** (P3) 마스터 티켓 하위 생성 — 도메인 등록 폼 진입점. 미정의면 하위 생성 메뉴에 노출 안 됨 */
  childCreate?: { formPath: string }
}

export const TICKET_DOMAIN_META: Record<DomainRefType, TicketDomainMeta> = {
  SITE_VISIT: {
    label: '답사',
    listPath: '/site-visits',
    detailHref: (r) => `/site-visits/${r.id}`,
    codePrefix: 'VISIT',
    descriptionSource: '노트',
    descriptionIsHtml: true,
    matchCategory: null,
    matchLabel: null,
    fallbackQueueName: '설치·답사',
    taskType: 'SITE_VISIT',
    statusCategory: 'SITE_VISIT',
  },
  INSTALL_PLAN: {
    label: '설치계획',
    listPath: '/install-plans',
    detailHref: (r) => `/install-plans/${r.id}`,
    codePrefix: 'IP',
    descriptionSource: '비고',
    descriptionIsHtml: true,
    matchCategory: null,
    matchLabel: null,
    fallbackQueueName: '설치·답사',
    taskType: 'INSTALL_PLAN',
    statusCategory: 'INSTALL_PLAN_STATUS',
  },
  PROJECT: {
    label: '프로젝트',
    listPath: '/projects',
    detailHref: (r) => `/projects/${r.code ?? r.id}`,
    codePrefix: 'PRJ',
    descriptionSource: '비고',
    descriptionIsHtml: false,
    matchCategory: null,
    matchLabel: null,
    fallbackQueueName: '설치·답사',
    taskType: 'PROJECT',
    statusCategory: null, // 프로젝트는 build_statuses (status_codes 아님)
  },
  ETC: {
    label: '기타업무',
    listPath: '/etc-tasks',
    detailHref: (r) => `/etc-tasks/${r.id}`,
    codePrefix: 'ETC',
    descriptionSource: '비고',
    descriptionIsHtml: true,
    matchCategory: null,
    matchLabel: null,
    fallbackQueueName: '내부운영',
    taskType: 'ETC',
    statusCategory: 'ETC_TASK_STATUS',
  },
  MAINTENANCE: {
    label: '유지보수',
    listPath: '/maintenances',
    detailHref: (r) => `/maintenances/${r.id}`,
    codePrefix: 'MNT',
    descriptionSource: '증상',
    descriptionIsHtml: false,
    matchCategory: 'MAINTENANCE_TYPE',
    matchLabel: '장애유형',
    fallbackQueueName: '유지보수',
    taskType: 'MAINTENANCE',
    statusCategory: 'MAINTENANCE_STATUS',
    childCreate: { formPath: '/maintenances/new' }, // P3 — 마스터 하위 생성 (도메인 POST parentTicketId)
  },
  // 6번째 도메인 (cs_ticket_workflow_design.md §5) — 어댑터 SOP(§3.4) 첫 적용 사례.
  // 연결 티켓이 CS 마스터 티켓이 되며, 하위 도메인 티켓(P3)의 parentId 대상.
  VOC: {
    label: 'VOC접수',
    listPath: '/voc',
    detailHref: (r) => `/voc/${r.id}`,
    codePrefix: 'VOC',
    descriptionSource: '내용',
    descriptionIsHtml: false,
    matchCategory: 'VOC_TYPE',
    matchLabel: 'VOC 분류',
    fallbackQueueName: 'CS',
    taskType: 'VOC',
    statusCategory: 'VOC_STATUS',
  },
  // 7번째 도메인 (stock_out_request_design.md) — 구축 프로젝트 자재 출고요청.
  // nav 표기는 '출고업무', 도메인 라벨은 '출고요청' (2026-09-03 승인 — 라벨 이원화).
  STOCK_OUT: {
    label: '출고요청',
    listPath: '/stock-out-requests',
    detailHref: (r) => `/stock-out-requests/${r.id}`,
    codePrefix: 'SOR',
    descriptionSource: '비고',
    descriptionIsHtml: false,
    matchCategory: null,
    matchLabel: null,
    fallbackQueueName: '내부운영',
    taskType: 'STOCK_OUT',
    statusCategory: 'STOCK_OUT_STATUS',
  },
}

/** refType → 라벨 맵 (+ 순수 티켓 센티널) — 설정 화면 칩·차트 라벨용 */
export function refTypeLabelMap(pureKey: 'NONE' | 'PURE' | 'none'): Record<string, string> {
  const map: Record<string, string> = {}
  for (const rt of DOMAIN_REF_TYPES) map[rt] = TICKET_DOMAIN_META[rt].label
  map[pureKey] = PURE_TICKET_LABEL
  return map
}

/** 티켓 상세 '연결 업무 배너' 데이터 — 서버(어댑터)가 조립해 API 응답에 실어 준다 */
export interface LinkedWorkData {
  refType: DomainRefType
  code: string
  /** ' · ' 로 연결된 부가정보 한 줄 */
  meta: string
  href: string
  linkLabel: string
}
