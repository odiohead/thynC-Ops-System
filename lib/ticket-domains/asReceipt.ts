/**
 * AS접수 어댑터 (as_work_design.md — 어댑터 SOP(§3.4) 8번째 적용)
 * 기기 수리·교체(AS) 업무 — 연결 티켓 refType 'AS'. 병원 필수 연결.
 *
 * 워크플로 상태(AS_STATUS, 단계형 8종): 접수 → 수거중 → 입고 → 처리중 → 발송 → 완료(**CLOSED 직행**)
 * + 보류(PENDING)·취소(CLOSED). 선교체·방문교체가 있어 단계 순서는 강제하지 않는다(2026-09-04 결정 5).
 * 담당 배정은 티켓 단독 소유(VOC 선례) — 도메인에는 등록자(createdBy)만 기록.
 */
import { Prisma, TicketStatus } from '@prisma/client'
import { generateTicketCode, addTicketEvent } from '@/lib/ticket'
import { buildTicketDescription } from '@/lib/ticketCtiRules'
import { AS_CATEGORY_LABELS, summarizeAsItems, type AsCategory } from '@/lib/asReceiptShared'
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

/** AS접수 상태명 → 티켓 상태 */
export function asStatusToTicket(statusName: string | null, hasOwner: boolean): TicketStatus {
  switch (statusName) {
    case '수거중':
    case '입고':
    case '처리중':
    case '발송': return 'IN_PROGRESS'
    case '보류': return 'PENDING'
    case '완료': return 'CLOSED' // RESOLVED 미경유 — SOR 선례
    case '취소': return 'CLOSED'
    case '접수':
    default:
      return hasOwner ? 'ASSIGNED' : 'OPEN'
  }
}

/** 티켓 상태 → AS접수 상태명 (역방향 이름 폴백 — 매핑 행 전무 환경) */
export function ticketStatusToAs(status: TicketStatus): string {
  switch (status) {
    case 'IN_PROGRESS': return '처리중'
    case 'PENDING': return '보류'
    case 'RESOLVED':
    case 'CLOSED': return '완료'
    default: return '접수'
  }
}

interface AsReceiptForTicket {
  id: number
  asCode: string | null
  hospitalCode: string
  hospitalName: string
  category: string
  statusName: string | null
  statusId?: number | null
  /** 티켓 설명 자동입력 소스 — 비고 또는 라인 접수사유 요약 */
  description?: string | null
  resolvedAt: Date | null
  createdAt: Date
}

/** AS접수용 티켓 생성 (POST 생성 경로). 반환: ticketId */
export async function createTicketForAsReceipt(
  tx: Prisma.TransactionClient,
  r: AsReceiptForTicket,
  actorId: string | null,
  via: 'domain' | 'backfill'
): Promise<number> {
  // 코드 폴백 없음(신규 도메인 — 규칙 시드가 전제). 규칙·CTI 기본 그룹·이름 폴백까지 전부 없으면 에러.
  const rule = await resolveRuleWithFallback(tx, 'AS', () => Promise.resolve(null))
  if (!rule.ctiId || !rule.queueId) {
    throw new Error('AS접수 자동생성 규칙이 없습니다. seed-as-masters.sql을 먼저 적용하세요.')
  }

  const statusMap = await getStatusMapping(tx, r.statusId)
  const status = mappedTicketStatus(statusMap, false, () => asStatusToTicket(r.statusName, false))

  let pendingReasonId: number | null = null
  let pendingNote: string | null = null
  if (status === 'PENDING') {
    pendingReasonId = await resolvePendingReasonId(tx, statusMap?.ticketPendingReasonId, '기타')
    pendingNote = 'AS접수 보류 (도메인 동기화)'
  }

  const catLabel = AS_CATEGORY_LABELS[r.category as AsCategory] ?? r.category
  const ticketCode = await generateTicketCode(tx)
  const now = new Date()
  const ticket = await tx.ticket.create({
    data: {
      ticketCode,
      title: `[AS접수·${catLabel}] ${r.hospitalName}`,
      descriptionHtml: rule.fillDescription
        ? buildTicketDescription({ refType: 'AS', source: r.description ?? null, refCode: r.asCode })
        : null,
      status,
      severity: 'SEV4',
      queueId: rule.queueId,
      ctiId: rule.ctiId,
      hospitalCode: r.hospitalCode,
      refType: 'AS',
      pendingReasonId,
      pendingNote,
      createdAt: via === 'backfill' ? r.createdAt : undefined,
      statusChangedAt: via === 'backfill' ? r.createdAt : undefined,
      resolvedAt: status === 'RESOLVED' || status === 'CLOSED' ? r.resolvedAt ?? now : undefined,
      closedAt: status === 'CLOSED' ? r.resolvedAt ?? now : undefined,
    },
  })
  await addTicketEvent(tx, ticket.id, 'created', actorId, { via, refType: 'AS', refCode: r.asCode })
  await tx.asReceipt.update({ where: { id: r.id }, data: { ticketId: ticket.id } })
  return ticket.id
}

/**
 * AS접수 변경 → 티켓 동기화 (상태·제목·병원). PUT/처리 핸들러의 트랜잭션 안에서 호출.
 * CTI 재동기화 없음(조건 축 없음). 담당(owner)은 티켓 단독 소유 — 여기서 건드리지 않는다.
 */
export async function syncAsReceiptToTicket(tx: Prisma.TransactionClient, receiptId: number, actorId: string | null) {
  const r = await tx.asReceipt.findUnique({
    where: { id: receiptId },
    select: {
      id: true, ticketId: true, resolvedAt: true, category: true,
      hospital: { select: { hospitalName: true, hospitalCode: true } },
      status: { select: STATUS_MAPPING_SELECT },
    },
  })
  if (!r?.ticketId) return
  const ticket = await tx.ticket.findUnique({ where: { id: r.ticketId } })
  if (!ticket) return

  const hasOwner = !!ticket.ownerId
  const nextStatus = mappedTicketStatus(r.status, hasOwner, () => asStatusToTicket(r.status?.name ?? null, hasOwner))

  const catLabel = AS_CATEGORY_LABELS[r.category as AsCategory] ?? r.category
  const data: Prisma.TicketUncheckedUpdateInput = {
    title: `[AS접수·${catLabel}] ${r.hospital.hospitalName}`,
    hospitalCode: r.hospital.hospitalCode,
  }
  if (nextStatus !== ticket.status) {
    data.status = nextStatus
    data.statusChangedAt = new Date()
    if (nextStatus === 'CLOSED') { data.resolvedAt = r.resolvedAt ?? new Date(); data.closedAt = r.resolvedAt ?? new Date() }
    else if (nextStatus === 'RESOLVED') { data.resolvedAt = r.resolvedAt ?? new Date(); data.closedAt = null }
    else { data.resolvedAt = null; data.closedAt = null }
    if (nextStatus === 'PENDING') {
      data.pendingReasonId = await resolvePendingReasonId(tx, r.status?.ticketPendingReasonId, '기타')
      data.pendingNote = 'AS접수 보류 (도메인 동기화)'
    } else { data.pendingReasonId = null; data.pendingNote = null }
    await addTicketEvent(tx, ticket.id, 'status_change', actorId, { from: ticket.status, to: nextStatus, via: 'domain_sync' })
  }
  await tx.ticket.update({ where: { id: ticket.id }, data })
}

/** 티켓 전이/배정 → AS접수 역동기화 (상태·완료일만) */
export async function syncTicketToAsReceipt(tx: Prisma.TransactionClient, ticketId: number) {
  const ticket = await tx.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true, status: true, pendingReasonId: true,
      asReceipt: { select: { id: true, statusId: true, resolvedAt: true } },
    },
  })
  if (!ticket?.asReceipt) return
  const r = ticket.asReceipt

  const nextStatusId = await pickDomainStatus(tx, 'AS_STATUS', r.statusId, ticket, ticketStatusToAs(ticket.status))

  const data: Prisma.AsReceiptUncheckedUpdateInput = {}
  if (nextStatusId) {
    data.statusId = nextStatusId
    data.statusChangedAt = new Date()
  }
  // 완료일 백필은 상태 변경과 독립 (VOC 선례 — keep-if-consistent 경로에서도 완료일 기록)
  if ((ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') && !r.resolvedAt) data.resolvedAt = new Date()
  if (ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED' && r.resolvedAt) data.resolvedAt = null
  if (Object.keys(data).length) await tx.asReceipt.update({ where: { id: r.id }, data })
}

// ── 어댑터 ────────────────────────────────────────────────────

interface AsReceiptBannerRel {
  id: number
  asCode: string | null
  category: string
  receiptDate: Date | string | null
  hospital: { hospitalName: string } | null
  createdBy: { name: string } | null
  items: { outcome: string | null }[]
}

export const asReceiptAdapter: TicketDomainAdapter = {
  refType: 'AS',
  meta: TICKET_DOMAIN_META.AS,
  detailInclude: {
    asReceipt: {
      select: {
        id: true, asCode: true, category: true, receiptDate: true,
        hospital: { select: { hospitalName: true } },
        createdBy: { select: { name: true } },
        items: { select: { outcome: true }, orderBy: { id: 'asc' as const } },
      },
    },
  },
  syncTicketToDomain: syncTicketToAsReceipt,
  buildLinkedWork(ticket) {
    const r = ticket.asReceipt as AsReceiptBannerRel | null | undefined
    if (!r) return null
    return {
      refType: 'AS',
      code: r.asCode ?? `#${r.id}`,
      meta: [
        AS_CATEGORY_LABELS[r.category as AsCategory] ?? r.category,
        summarizeAsItems(r.items ?? []),
        `접수일 ${bannerDate(r.receiptDate)}`,
        `등록 ${r.createdBy?.name ?? '-'}`,
      ].join(' · '),
      href: TICKET_DOMAIN_META.AS.detailHref({ id: r.id, code: r.asCode }),
      linkLabel: 'AS접수 상세로 이동 →',
    }
  },
}
