/**
 * 출고요청 어댑터 (stock_out_request_design.md — 어댑터 SOP(§3.4) 7번째 적용)
 * 구축 프로젝트의 자재 출고요청 — 연결 티켓 refType 'STOCK_OUT'. 프로젝트 연결 필수.
 *
 * 워크플로 상태(STOCK_OUT_STATUS): 요청 → 처리중 → 완료(**CLOSED 직행** — 2026-09-03 사용자 결정
 * "도메인에서 완료로 바꾸면 메인티켓도 closed") + 보류(PENDING)·취소(CLOSED).
 * 담당 배정은 티켓 단독 소유(VOC 선례) — 도메인에는 생성자(createdBy)만 기록.
 */
import { Prisma, TicketStatus } from '@prisma/client'
import { generateTicketCode, addTicketEvent } from '@/lib/ticket'
import { buildTicketDescription } from '@/lib/ticketCtiRules'
import { summarizeStockOutItems } from '@/lib/stockOut'
import { TICKET_DOMAIN_META } from './meta'
import type { TicketDomainAdapter } from './types'
import {
  STATUS_MAPPING_SELECT,
  getStatusMapping,
  mappedTicketStatus,
  pickDomainStatus,
  resolvePendingReasonId,
  resolveRuleWithFallback,
  bannerDate,
} from './shared'

// ── 상태 폴백 매핑 (매핑 컬럼 유실 시 전용 — 단일 소스는 status_codes.ticket_status) ──

/** 출고요청 상태명 → 티켓 상태 */
export function stockOutStatusToTicket(statusName: string | null, hasOwner: boolean): TicketStatus {
  switch (statusName) {
    case '처리중': return 'IN_PROGRESS'
    case '보류': return 'PENDING'
    case '완료': return 'CLOSED' // RESOLVED 미경유 — 2026-09-03 결정
    case '취소': return 'CLOSED'
    case '요청':
    default:
      return hasOwner ? 'ASSIGNED' : 'OPEN'
  }
}

/** 티켓 상태 → 출고요청 상태명 (역방향 이름 폴백 — 매핑 행 전무 환경) */
export function ticketStatusToStockOut(status: TicketStatus): string {
  switch (status) {
    case 'IN_PROGRESS': return '처리중'
    case 'PENDING': return '보류'
    case 'RESOLVED':
    case 'CLOSED': return '완료'
    default: return '요청'
  }
}

interface StockOutForTicket {
  id: number
  sorCode: string | null
  projectName: string
  hospitalCode: string | null
  statusName: string | null
  statusId?: number | null
  note?: string | null // 비고 → 티켓 설명 자동 입력 소스
  requestDate: Date | null
  resolvedAt: Date | null
  createdAt: Date
}

/** 출고요청용 티켓 생성 (POST 생성 경로). 반환: ticketId */
export async function createTicketForStockOut(
  tx: Prisma.TransactionClient,
  r: StockOutForTicket,
  actorId: string | null,
  via: 'domain' | 'backfill'
): Promise<number> {
  // 코드 폴백 없음(신규 도메인 — 규칙 시드가 전제). 규칙·CTI 기본 그룹·이름 폴백까지 전부 없으면 에러.
  const rule = await resolveRuleWithFallback(tx, 'STOCK_OUT', () => Promise.resolve(null))
  if (!rule.ctiId || !rule.queueId) {
    throw new Error('출고요청 자동생성 규칙이 없습니다. seed-stock-out-masters.sql을 먼저 적용하세요.')
  }

  const statusMap = await getStatusMapping(tx, r.statusId)
  const status = mappedTicketStatus(statusMap, false, () => stockOutStatusToTicket(r.statusName, false))

  let pendingReasonId: number | null = null
  let pendingNote: string | null = null
  if (status === 'PENDING') {
    pendingReasonId = await resolvePendingReasonId(tx, statusMap?.ticketPendingReasonId, '기타')
    pendingNote = '출고요청 보류 (도메인 동기화)'
  }

  const ticketCode = await generateTicketCode(tx)
  const now = new Date()
  const ticket = await tx.ticket.create({
    data: {
      ticketCode,
      title: `[출고요청] ${r.projectName}`,
      descriptionHtml: rule.fillDescription
        ? buildTicketDescription({ refType: 'STOCK_OUT', source: r.note, refCode: r.sorCode })
        : null,
      status,
      severity: 'SEV4',
      queueId: rule.queueId,
      ctiId: rule.ctiId,
      hospitalCode: r.hospitalCode,
      refType: 'STOCK_OUT',
      pendingReasonId,
      pendingNote,
      createdAt: via === 'backfill' ? r.createdAt : undefined,
      statusChangedAt: via === 'backfill' ? r.createdAt : undefined,
      resolvedAt: status === 'RESOLVED' || status === 'CLOSED' ? r.resolvedAt ?? now : undefined,
      closedAt: status === 'CLOSED' ? r.resolvedAt ?? now : undefined,
    },
  })
  await addTicketEvent(tx, ticket.id, 'created', actorId, { via, refType: 'STOCK_OUT', refCode: r.sorCode })
  await tx.stockOutRequest.update({ where: { id: r.id }, data: { ticketId: ticket.id } })
  return ticket.id
}

/**
 * 출고요청 변경 → 티켓 동기화 (상태·제목·병원). PUT 핸들러의 트랜잭션 안에서 호출.
 * CTI 재동기화 없음(조건 축 없음). 담당(owner)은 티켓 단독 소유 — 여기서 건드리지 않는다.
 */
export async function syncStockOutToTicket(tx: Prisma.TransactionClient, requestId: number, actorId: string | null) {
  const r = await tx.stockOutRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true, ticketId: true, resolvedAt: true,
      project: { select: { projectName: true, hospitalCode: true } },
      status: { select: STATUS_MAPPING_SELECT },
    },
  })
  if (!r?.ticketId) return
  const ticket = await tx.ticket.findUnique({ where: { id: r.ticketId } })
  if (!ticket) return

  const hasOwner = !!ticket.ownerId
  const nextStatus = mappedTicketStatus(r.status, hasOwner, () => stockOutStatusToTicket(r.status?.name ?? null, hasOwner))

  const data: Prisma.TicketUncheckedUpdateInput = {
    title: `[출고요청] ${r.project.projectName}`,
    hospitalCode: r.project.hospitalCode,
  }
  if (nextStatus !== ticket.status) {
    data.status = nextStatus
    data.statusChangedAt = new Date()
    if (nextStatus === 'CLOSED') { data.resolvedAt = r.resolvedAt ?? new Date(); data.closedAt = r.resolvedAt ?? new Date() }
    else if (nextStatus === 'RESOLVED') { data.resolvedAt = r.resolvedAt ?? new Date(); data.closedAt = null }
    else { data.resolvedAt = null; data.closedAt = null }
    if (nextStatus === 'PENDING') {
      data.pendingReasonId = await resolvePendingReasonId(tx, r.status?.ticketPendingReasonId, '기타')
      data.pendingNote = '출고요청 보류 (도메인 동기화)'
    } else { data.pendingReasonId = null; data.pendingNote = null }
    await addTicketEvent(tx, ticket.id, 'status_change', actorId, { from: ticket.status, to: nextStatus, via: 'domain_sync' })
  }
  await tx.ticket.update({ where: { id: ticket.id }, data })
}

/** 티켓 전이/배정 → 출고요청 역동기화 (상태·완료일만) */
export async function syncTicketToStockOut(tx: Prisma.TransactionClient, ticketId: number) {
  const ticket = await tx.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true, status: true, pendingReasonId: true,
      stockOutRequest: { select: { id: true, statusId: true, resolvedAt: true } },
    },
  })
  if (!ticket?.stockOutRequest) return
  const r = ticket.stockOutRequest

  const nextStatusId = await pickDomainStatus(tx, 'STOCK_OUT_STATUS', r.statusId, ticket, ticketStatusToStockOut(ticket.status))

  const data: Prisma.StockOutRequestUncheckedUpdateInput = {}
  if (nextStatusId) {
    data.statusId = nextStatusId
    data.statusChangedAt = new Date()
  }
  // 완료일 백필은 상태 변경과 독립 (VOC 선례 — keep-if-consistent 경로에서도 완료일 기록)
  if ((ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') && !r.resolvedAt) data.resolvedAt = new Date()
  if (ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED' && r.resolvedAt) data.resolvedAt = null
  if (Object.keys(data).length) await tx.stockOutRequest.update({ where: { id: r.id }, data })
}

// ── 어댑터 ────────────────────────────────────────────────────

interface StockOutBannerRel {
  id: number
  sorCode: string | null
  requestDate: Date | string | null
  project: { projectCode: string; projectName: string } | null
  createdBy: { name: string } | null
  items: { quantity: number; item: { name: string } }[]
}

export const stockOutAdapter: TicketDomainAdapter = {
  refType: 'STOCK_OUT',
  meta: TICKET_DOMAIN_META.STOCK_OUT,
  detailInclude: {
    stockOutRequest: {
      select: {
        id: true, sorCode: true, requestDate: true,
        project: { select: { projectCode: true, projectName: true } },
        createdBy: { select: { name: true } },
        items: { select: { quantity: true, item: { select: { name: true } } }, orderBy: { id: 'asc' as const } },
      },
    },
  },
  syncTicketToDomain: syncTicketToStockOut,
  buildLinkedWork(ticket) {
    const r = ticket.stockOutRequest as StockOutBannerRel | null | undefined
    if (!r) return null
    return {
      refType: 'STOCK_OUT',
      code: r.sorCode ?? `#${r.id}`,
      meta: [
        `프로젝트 ${r.project?.projectName ?? '-'}`,
        summarizeStockOutItems(r.items ?? []),
        `희망 출고일 ${bannerDate(r.requestDate)}`,
        `요청 ${r.createdBy?.name ?? '-'}`,
      ].join(' · '),
      href: TICKET_DOMAIN_META.STOCK_OUT.detailHref({ id: r.id, code: r.sorCode }),
      linkLabel: '출고요청 상세로 이동 →',
    }
  },
}
