/**
 * 답사 어댑터 (P7 — 상태 5종, 역방향 손실 허용·도메인이 자기 상태의 원본)
 * 구 lib/ticketDomain.ts 답사 블록의 동작 불변 이관 (P0 리팩토링)
 */
import { Prisma, TicketStatus } from '@prisma/client'
import { generateTicketCode, addTicketEvent } from '@/lib/ticket'
import { buildTicketDescription } from '@/lib/ticketCtiRules'
import { TICKET_DOMAIN_META } from './meta'
import type { TicketDomainAdapter } from './types'
import {
  type DbClient,
  STATUS_MAPPING_SELECT,
  getStatusMapping,
  mappedTicketStatus,
  pickDomainStatus,
  resolvePendingReasonId,
  resolveRuleWithFallback,
  bannerDate,
} from './shared'

/** 답사 상태명 → 티켓 상태 */
export function siteVisitStatusToTicket(statusName: string | null, hasOwner: boolean): TicketStatus {
  switch (statusName) {
    case '답사예정': return 'IN_PROGRESS'
    case '작성완료': return 'PENDING' // 회신 대기
    case '보류': return 'PENDING'
    case '회신완료': return 'CLOSED'
    case '접수':
    default:
      return hasOwner ? 'ASSIGNED' : 'OPEN'
  }
}

/** 티켓 상태 → 답사 상태명 (역방향 — PENDING은 보류로) */
export function ticketStatusToSiteVisit(status: TicketStatus): string {
  switch (status) {
    case 'IN_PROGRESS': return '답사예정'
    case 'PENDING': return '보류'
    case 'RESOLVED':
    case 'CLOSED': return '회신완료'
    default: return '접수'
  }
}

async function siteVisitCtiId(client: DbClient): Promise<number | null> {
  const parent = await client.ticketCti.findFirst({
    where: { level: 2, name: '신규도입', parent: { level: 1, name: '영업' } },
    select: { id: true },
  })
  if (!parent) return null
  const item = await client.ticketCti.findFirst({ where: { parentId: parent.id, name: '답사요청' }, select: { id: true } })
  return item?.id ?? null
}

interface SiteVisitForTicket {
  id: number
  siteVisitCode: string | null
  hospitalCode: string
  hospitalName: string | null
  statusName: string | null
  statusId?: number | null // 상태 status_code id — 티켓 상태 매핑 컬럼 조회용 (없으면 이름 폴백)
  assigneeUserIds: string[]
  notes?: string | null // 노트 → 티켓 설명 자동 입력 소스
  createdAt: Date
  replyDate: Date | null
}

/** 답사용 티켓 생성 (직접 생성·큐 승격·백필 공용) */
export async function createTicketForSiteVisit(
  tx: Prisma.TransactionClient,
  s: SiteVisitForTicket,
  actorId: string | null,
  via: 'domain' | 'backfill'
): Promise<number> {
  const rule = await resolveRuleWithFallback(tx, 'SITE_VISIT', () => siteVisitCtiId(tx))
  if (!rule.queueId) throw new Error("Assignment Group '설치·답사'가 없습니다. seed-ticket-masters.sql을 먼저 적용하세요.")
  const ctiId = rule.ctiId

  const ownerId = s.assigneeUserIds[0] ?? null
  const participants = s.assigneeUserIds.slice(1)
  const statusMap = await getStatusMapping(tx, s.statusId)
  const status = mappedTicketStatus(statusMap, !!ownerId, () => siteVisitStatusToTicket(s.statusName, !!ownerId))

  let pendingReasonId: number | null = null
  let pendingNote: string | null = null
  if (status === 'PENDING') {
    pendingReasonId = await resolvePendingReasonId(tx, statusMap?.ticketPendingReasonId, s.statusName === '작성완료' ? '외부 회신 대기' : '기타')
    pendingNote = s.statusName === '작성완료' ? '답사 회신 대기' : '답사 보류'
  }

  const ticketCode = await generateTicketCode(tx)
  const ticket = await tx.ticket.create({
    data: {
      ticketCode,
      title: `[답사] ${s.hospitalName ?? s.hospitalCode}`,
      descriptionHtml: rule.fillDescription
        ? buildTicketDescription({ refType: 'SITE_VISIT', source: s.notes, refCode: s.siteVisitCode })
        : null,
      status,
      severity: 'SEV4',
      queueId: rule.queueId,
      ctiId,
      ownerId,
      hospitalCode: s.hospitalCode,
      refType: 'SITE_VISIT',
      pendingReasonId,
      pendingNote,
      createdAt: via === 'backfill' ? s.createdAt : undefined,
      statusChangedAt: via === 'backfill' ? s.createdAt : undefined,
      resolvedAt: status === 'CLOSED' ? s.replyDate ?? undefined : undefined,
      closedAt: status === 'CLOSED' ? s.replyDate ?? s.createdAt : undefined,
      participants: participants.length ? { create: participants.map((userId) => ({ userId })) } : undefined,
    },
  })
  await addTicketEvent(tx, ticket.id, 'created', actorId, { via, refType: 'SITE_VISIT', refCode: s.siteVisitCode })
  await tx.siteVisit.update({ where: { id: s.id }, data: { ticketId: ticket.id } })
  return ticket.id
}

/** 답사 변경 → 티켓 동기화 */
export async function syncSiteVisitToTicket(tx: Prisma.TransactionClient, siteVisitId: number, actorId: string | null) {
  const s = await tx.siteVisit.findUnique({
    where: { id: siteVisitId },
    select: {
      id: true, ticketId: true, hospitalCode: true, replyDate: true,
      hospital: { select: { hospitalName: true } },
      status: { select: STATUS_MAPPING_SELECT },
      assignees: { select: { userId: true }, orderBy: { id: 'asc' } },
    },
  })
  if (!s?.ticketId) return
  const ticket = await tx.ticket.findUnique({ where: { id: s.ticketId } })
  if (!ticket) return

  const ownerId = s.assignees[0]?.userId ?? null
  const participantIds = s.assignees.slice(1).map((a) => a.userId)
  const nextStatus = mappedTicketStatus(s.status, !!ownerId, () => siteVisitStatusToTicket(s.status?.name ?? null, !!ownerId))

  const data: Prisma.TicketUncheckedUpdateInput = {
    title: `[답사] ${s.hospital?.hospitalName ?? s.hospitalCode}`,
    hospitalCode: s.hospitalCode,
  }
  if (nextStatus !== ticket.status) {
    data.status = nextStatus
    data.statusChangedAt = new Date()
    if (nextStatus === 'CLOSED') { data.resolvedAt = s.replyDate ?? new Date(); data.closedAt = s.replyDate ?? new Date() }
    else { data.resolvedAt = null; data.closedAt = null }
    if (nextStatus === 'PENDING') {
      data.pendingReasonId = await resolvePendingReasonId(tx, s.status?.ticketPendingReasonId, s.status?.name === '작성완료' ? '외부 회신 대기' : '기타')
      data.pendingNote = s.status?.name === '작성완료' ? '답사 회신 대기' : '답사 보류'
    } else { data.pendingReasonId = null; data.pendingNote = null }
    await addTicketEvent(tx, ticket.id, 'status_change', actorId, { from: ticket.status, to: nextStatus, via: 'domain_sync' })
  }
  if (ownerId !== ticket.ownerId) {
    data.ownerId = ownerId
    await addTicketEvent(tx, ticket.id, 'assign', actorId, { from: ticket.ownerId, to: ownerId, via: 'domain_sync' })
  }
  await tx.ticket.update({ where: { id: ticket.id }, data })
  await tx.ticketParticipant.deleteMany({ where: { ticketId: ticket.id } })
  if (participantIds.length) {
    await tx.ticketParticipant.createMany({
      data: participantIds.map((userId) => ({ ticketId: ticket.id, userId })),
      skipDuplicates: true,
    })
  }
}

/** 티켓 전이/배정 → 답사 역동기화 */
export async function syncTicketToSiteVisit(tx: Prisma.TransactionClient, ticketId: number) {
  const ticket = await tx.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true, status: true, ownerId: true, pendingReasonId: true,
      participants: { select: { userId: true } },
      siteVisit: { select: { id: true, statusId: true, replyDate: true } },
    },
  })
  if (!ticket?.siteVisit) return
  const s = ticket.siteVisit

  const nextStatusId = await pickDomainStatus(tx, 'SITE_VISIT', s.statusId, ticket, ticketStatusToSiteVisit(ticket.status))

  const data: Prisma.SiteVisitUncheckedUpdateInput = {}
  if (nextStatusId) {
    data.statusId = nextStatusId
    data.statusChangedAt = new Date()
    if ((ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') && !s.replyDate) data.replyDate = new Date()
  }
  if (Object.keys(data).length) await tx.siteVisit.update({ where: { id: s.id }, data })

  const userIds = [ticket.ownerId, ...ticket.participants.map((p) => p.userId)].filter((v): v is string => !!v)
  await tx.siteVisitAssignee.deleteMany({ where: { siteVisitId: s.id } })
  if (userIds.length) {
    await tx.siteVisitAssignee.createMany({
      data: Array.from(new Set(userIds)).map((userId) => ({ siteVisitId: s.id, userId })),
      skipDuplicates: true,
    })
  }
}

// ── 어댑터 ────────────────────────────────────────────────────

interface SiteVisitBannerRel {
  id: number
  siteVisitCode: string | null
  requestDate: Date | string | null
  visitDate: Date | string | null
  replyDate: Date | string | null
  daewoongUser: { name: string } | null
}

export const siteVisitAdapter: TicketDomainAdapter = {
  refType: 'SITE_VISIT',
  meta: TICKET_DOMAIN_META.SITE_VISIT,
  detailInclude: {
    siteVisit: {
      select: { id: true, siteVisitCode: true, requestDate: true, visitDate: true, replyDate: true, daewoongUser: { select: { name: true } } },
    },
  },
  syncTicketToDomain: syncTicketToSiteVisit,
  buildLinkedWork(ticket) {
    const s = ticket.siteVisit as SiteVisitBannerRel | null | undefined
    if (!s) return null
    return {
      refType: 'SITE_VISIT',
      code: s.siteVisitCode ?? `SV-${String(s.id).padStart(5, '0')}`,
      meta: [
        `요청일 ${bannerDate(s.requestDate)}`,
        `방문일 ${bannerDate(s.visitDate)}`,
        `회신일 ${bannerDate(s.replyDate)}`,
        `대웅담당자 ${s.daewoongUser?.name ?? '-'}`,
      ].join(' · '),
      href: TICKET_DOMAIN_META.SITE_VISIT.detailHref({ id: s.id, code: s.siteVisitCode }),
      linkLabel: '답사 상세로 이동 →',
    }
  },
}
