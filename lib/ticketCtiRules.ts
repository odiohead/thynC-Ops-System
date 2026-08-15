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
import { TICKET_DOMAIN_META, type DomainRefType } from '@/lib/ticket-domains/meta'

type DbClient = Prisma.TransactionClient | typeof prisma

// 도메인 유형·메타 단일 소스는 lib/ticket-domains/meta.ts 로 이동 (P0 리팩토링) — 기존 호출부 호환 재-export
export { DOMAIN_REF_TYPES, isDomainRefType, type DomainRefType } from '@/lib/ticket-domains/meta'
/** @deprecated TICKET_DOMAIN_META(lib/ticket-domains/meta.ts) 사용 — 별칭 유지 */
export const DOMAIN_META = TICKET_DOMAIN_META

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
