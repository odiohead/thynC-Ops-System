/**
 * 티켓 도메인 어댑터 레지스트리 (cs_ticket_workflow_design.md §3)
 *
 * 신규 도메인 편입 = 어댑터 파일 1개 작성 + 여기 1줄 등록 + meta.ts 항목 + 마스터 데이터(seed).
 * 공용 코드는 이 레지스트리 조회만 사용한다 — refType switch를 새로 만들지 말 것.
 *
 * 미등록 refType 폴백 계약 (도메인 폐기 시에도 적용):
 * - syncTicketToDomain: no-op
 * - buildTicketLinkedWork: null (배너 미표시)
 * - 배지: TicketRefTypeBadge fallback (회색/미표시)
 * - 목록 필터·라벨: 미노출 (raw 문자열 표기)
 */
import { Prisma } from '@prisma/client'
import { DOMAIN_REF_TYPES, isDomainRefType, type DomainRefType, type LinkedWorkData } from './meta'
import type { TicketDomainAdapter } from './types'
import { maintenanceAdapter } from './maintenance'
import { etcTaskAdapter } from './etcTask'
import { siteVisitAdapter } from './siteVisit'
import { installPlanAdapter } from './installPlan'
import { projectAdapter } from './project'
import { vocAdapter } from './voc'
import { stockOutAdapter } from './stockOut'

export const TICKET_DOMAIN_ADAPTERS: Record<DomainRefType, TicketDomainAdapter> = {
  MAINTENANCE: maintenanceAdapter,
  ETC: etcTaskAdapter,
  SITE_VISIT: siteVisitAdapter,
  INSTALL_PLAN: installPlanAdapter,
  PROJECT: projectAdapter,
  VOC: vocAdapter,
  STOCK_OUT: stockOutAdapter,
}

export function getDomainAdapter(refType: string | null | undefined): TicketDomainAdapter | null {
  if (!refType || !isDomainRefType(refType)) return null
  return TICKET_DOMAIN_ADAPTERS[refType]
}

/** 티켓 상세 GET include에 병합할 전 도메인 relation fragment */
export function domainDetailIncludes(): Prisma.TicketInclude {
  const merged: Record<string, unknown> = {}
  for (const rt of DOMAIN_REF_TYPES) Object.assign(merged, TICKET_DOMAIN_ADAPTERS[rt].detailInclude)
  return merged as Prisma.TicketInclude
}

/** 티켓 상세 응답의 연결 업무 배너 데이터 — refType 어댑터에 위임 (미등록/미연결이면 null) */
export function buildTicketLinkedWork(ticket: { refType: string | null }): LinkedWorkData | null {
  const adapter = getDomainAdapter(ticket.refType)
  return adapter ? adapter.buildLinkedWork(ticket as unknown as Record<string, unknown>) : null
}

/** 티켓 변경 → 도메인 역동기화 (refType 디스패치). 티켓 mutation 트랜잭션 안에서 호출 */
export async function syncTicketToDomain(tx: Prisma.TransactionClient, ticketId: number, refType: string | null) {
  const adapter = getDomainAdapter(refType)
  if (adapter) await adapter.syncTicketToDomain(tx, ticketId)
}
