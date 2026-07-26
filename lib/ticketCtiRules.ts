/**
 * 티켓 자동생성 규칙 — 도메인 업무에서 티켓이 만들어질 때 붙는
 * CTI 분류 · Assignment Group · 설명 자동입력 여부를 DB 규칙으로 해석한다.
 * 설계: ticket_cti_rule_design.md
 *
 * 해석 순서 (§4)
 *   1) (refType, matchStatusCodeId) 정확 일치 행   ← 유지보수 장애유형별
 *   2) (refType, NULL) 기본 행                     ← 전 업무
 *   3) 없으면 null → 호출부가 기존 하드코딩 폴백 사용
 *
 * 규칙 변경은 소급 적용하지 않는다(이미 만들어진 티켓의 CTI는 그대로).
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sanitizeRichTextHtml, isEmptyRichText } from '@/lib/richtext'

type DbClient = Prisma.TransactionClient | typeof prisma

/** 도메인 연결 유형 — tickets.ref_type과 동일 값 */
export const DOMAIN_REF_TYPES = ['SITE_VISIT', 'INSTALL_PLAN', 'PROJECT', 'ETC', 'MAINTENANCE'] as const
export type DomainRefType = (typeof DOMAIN_REF_TYPES)[number]

export function isDomainRefType(v: unknown): v is DomainRefType {
  return typeof v === 'string' && (DOMAIN_REF_TYPES as readonly string[]).includes(v)
}

/** 업무별 표시 정보 (설정 화면·API 공용 단일 소스) */
export const DOMAIN_META: Record<
  DomainRefType,
  {
    label: string
    /** 목록 경로 (설정 버튼이 붙는 화면) */
    listPath: string
    /** 설명으로 옮길 도메인 필드의 사람용 이름 */
    descriptionSource: string
    /** 소스 필드가 리치텍스트(Tiptap HTML)인지 — false면 plain text */
    descriptionIsHtml: boolean
    /** 조건 축(장애유형 등)을 갖는 업무인지 */
    matchCategory: string | null
    matchLabel: string | null
    /** 규칙이 없을 때 코드 폴백이 쓰는 Assignment Group 이름 (안내 표시용) */
    fallbackQueueName: string
  }
> = {
  SITE_VISIT: {
    label: '답사',
    listPath: '/site-visits',
    descriptionSource: '노트',
    descriptionIsHtml: true,
    matchCategory: null,
    matchLabel: null,
    fallbackQueueName: '설치·답사',
  },
  INSTALL_PLAN: {
    label: '설치계획',
    listPath: '/install-plans',
    descriptionSource: '비고',
    descriptionIsHtml: true,
    matchCategory: null,
    matchLabel: null,
    fallbackQueueName: '설치·답사',
  },
  PROJECT: {
    label: '프로젝트',
    listPath: '/projects',
    descriptionSource: '비고',
    descriptionIsHtml: false,
    matchCategory: null,
    matchLabel: null,
    fallbackQueueName: '설치·답사',
  },
  ETC: {
    label: '기타업무',
    listPath: '/etc-tasks',
    descriptionSource: '비고',
    descriptionIsHtml: true,
    matchCategory: null,
    matchLabel: null,
    fallbackQueueName: '내부운영',
  },
  MAINTENANCE: {
    label: '유지보수',
    listPath: '/maintenances',
    descriptionSource: '증상',
    descriptionIsHtml: false,
    matchCategory: 'MAINTENANCE_TYPE',
    matchLabel: '장애유형',
    fallbackQueueName: '유지보수',
  },
}

export interface ResolvedDomainRule {
  ruleId: number
  ctiId: number
  /** 규칙 지정 그룹 → 없으면 CTI 기본 그룹 → 둘 다 없으면 null(호출부 폴백) */
  queueId: number | null
  fillDescription: boolean
  /** 조건 행이 적중했는지 (false = 업무 기본 행) */
  matched: boolean
}

/**
 * 규칙 해석. 못 찾으면 null — 호출부는 기존 하드코딩 폴백을 쓴다.
 * statusCodeId는 유지보수 장애유형(status_codes.id)에만 의미가 있다.
 */
export async function resolveDomainTicketRule(
  client: DbClient,
  refType: DomainRefType,
  opts: { statusCodeId?: number | null } = {}
): Promise<ResolvedDomainRule | null> {
  const rows = await client.ticketDomainCtiRule.findMany({
    where: {
      refType,
      isActive: true,
      OR: [{ matchStatusCodeId: null }, ...(opts.statusCodeId ? [{ matchStatusCodeId: opts.statusCodeId }] : [])],
    },
    select: {
      id: true,
      matchStatusCodeId: true,
      ctiId: true,
      queueId: true,
      fillDescription: true,
      cti: { select: { isActive: true, defaultQueueId: true } },
    },
  })
  if (!rows.length) return null

  // 조건 일치 행이 기본 행을 이긴다
  const hit = rows.find((r) => r.matchStatusCodeId !== null) ?? rows.find((r) => r.matchStatusCodeId === null)
  if (!hit) return null

  return {
    ruleId: hit.id,
    ctiId: hit.ctiId,
    queueId: hit.queueId ?? hit.cti.defaultQueueId ?? null,
    // 설명 자동입력 여부는 업무 단위 정책 — 조건 행이 적중해도 기본 행 값을 따른다
    fillDescription: (rows.find((r) => r.matchStatusCodeId === null) ?? hit).fillDescription,
    matched: hit.matchStatusCodeId !== null,
  }
}

/**
 * 규칙이 지정한 Assignment Group id. 규칙·CTI 기본 그룹이 모두 없으면 이름으로 폴백 조회.
 * 폴백 그룹까지 없으면 null (호출부가 에러 처리)
 */
export async function resolveDomainQueueId(
  client: DbClient,
  rule: ResolvedDomainRule | null,
  fallbackName: string
): Promise<number | null> {
  if (rule?.queueId) return rule.queueId
  const q = await client.ticketQueue.findUnique({ where: { name: fallbackName }, select: { id: true } })
  return q?.id ?? null
}

// ── 설명 자동 채움 (§5) ────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** plain text → 문단 HTML (빈 줄 기준 문단 분리, 줄바꿈은 <br>) */
export function plainTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/**
 * 도메인 소스 → 티켓 설명 HTML.
 * - 소스가 비면 null (빈 설명 박스를 만들지 않는다)
 * - 상단에 출처 한 줄 — 티켓만 보는 사람이 원본을 찾을 수 있어야 한다
 * - 생성 시 1회 스냅샷. 이후 도메인 비고 수정은 반영하지 않는다(티켓에서 쓴 내용 보호)
 */
export function buildTicketDescription(params: {
  refType: DomainRefType
  source: string | null | undefined
  refCode: string | null
}): string | null {
  const { refType, source, refCode } = params
  if (!source) return null
  const meta = DOMAIN_META[refType]

  const bodyRaw = meta.descriptionIsHtml ? source : plainTextToHtml(source)
  if (meta.descriptionIsHtml ? isEmptyRichText(bodyRaw) : !source.trim()) return null

  const origin = `${meta.label} ${refCode ?? ''}`.trim()
  const note = `<p><em>※ ${escapeHtml(origin)} ${escapeHtml(meta.descriptionSource)}에서 자동 입력</em></p>`
  return sanitizeRichTextHtml(`${note}${bodyRaw}`)
}
