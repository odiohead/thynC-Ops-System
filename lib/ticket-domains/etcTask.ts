/**
 * 기타업무 어댑터 (P6 — 유지보수와 동일 상태 체계, 카테고리만 ETC_TASK_STATUS)
 * 구 lib/ticketDomain.ts 기타업무 블록의 동작 불변 이관 (P0 리팩토링)
 */
import { Prisma } from '@prisma/client'
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
import { maintStatusToTicket, ticketStatusToMaint, priorityToSeverity, severityToPriority } from './maintenance'

async function etcTaskCtiId(client: DbClient): Promise<number | null> {
  const parent = await client.ticketCti.findFirst({
    where: { level: 2, name: '기타업무', parent: { level: 1, name: '내부' } },
    select: { id: true },
  })
  if (!parent) return null
  const item = await client.ticketCti.findFirst({ where: { parentId: parent.id, name: '일반' }, select: { id: true } })
  return item?.id ?? null
}

interface EtcTaskForTicket {
  id: number
  etcTaskCode: string | null
  title: string
  priority: string | null
  statusName: string | null
  statusId?: number | null // 상태 status_code id — 티켓 상태 매핑 컬럼 조회용 (없으면 이름 폴백)
  hospitalCodes: string[] // 첫 병원 → ticket.hospitalCode (실측 복수 0건)
  assigneeUserIds: string[]
  note?: string | null // 비고 → 티켓 설명 자동 입력 소스
  resolvedAt: Date | null
  createdAt: Date
}

/** 기타업무용 티켓 생성 (POST 생성 경로·백필 공용) */
export async function createTicketForEtcTask(
  tx: Prisma.TransactionClient,
  e: EtcTaskForTicket,
  actorId: string | null,
  via: 'domain' | 'backfill'
): Promise<number> {
  const rule = await resolveRuleWithFallback(tx, 'ETC', () => etcTaskCtiId(tx))
  if (!rule.queueId) throw new Error("Assignment Group '내부운영'이 없습니다. seed-ticket-masters.sql을 먼저 적용하세요.")
  const ctiId = rule.ctiId

  const ownerId = e.assigneeUserIds[0] ?? null
  const participants = e.assigneeUserIds.slice(1)
  const statusMap = await getStatusMapping(tx, e.statusId)
  const status = mappedTicketStatus(statusMap, !!ownerId, () => maintStatusToTicket(e.statusName, !!ownerId)) // 폴백 상태 체계 동일 (접수/처리중/완료/보류)
  const severity = priorityToSeverity(e.priority)

  let pendingReasonId: number | null = null
  let pendingNote: string | null = null
  if (status === 'PENDING') {
    pendingReasonId = await resolvePendingReasonId(tx, statusMap?.ticketPendingReasonId, '기타')
    pendingNote = '기타업무 보류 (도메인 동기화)'
  }

  const ticketCode = await generateTicketCode(tx)
  const ticket = await tx.ticket.create({
    data: {
      ticketCode,
      title: e.title,
      descriptionHtml: rule.fillDescription
        ? buildTicketDescription({ refType: 'ETC', source: e.note, refCode: e.etcTaskCode })
        : null,
      status,
      severity,
      queueId: rule.queueId,
      ctiId,
      ownerId,
      hospitalCode: e.hospitalCodes[0] ?? null,
      refType: 'ETC',
      pendingReasonId,
      pendingNote,
      createdAt: via === 'backfill' ? e.createdAt : undefined,
      statusChangedAt: via === 'backfill' ? e.createdAt : undefined,
      resolvedAt: status === 'CLOSED' ? e.resolvedAt ?? undefined : undefined,
      closedAt: status === 'CLOSED' ? e.resolvedAt ?? e.createdAt : undefined,
      participants: participants.length ? { create: participants.map((userId) => ({ userId })) } : undefined,
    },
  })
  await addTicketEvent(tx, ticket.id, 'created', actorId, { via, refType: 'ETC', refCode: e.etcTaskCode })
  await tx.etcTask.update({ where: { id: e.id }, data: { ticketId: ticket.id } })
  return ticket.id
}

/** 기타업무 변경 → 티켓 동기화 */
export async function syncEtcTaskToTicket(tx: Prisma.TransactionClient, etcTaskId: number, actorId: string | null) {
  const e = await tx.etcTask.findUnique({
    where: { id: etcTaskId },
    select: {
      id: true, ticketId: true, title: true, priority: true, resolvedAt: true,
      status: { select: STATUS_MAPPING_SELECT },
      hospitals: { select: { hospitalCode: true }, orderBy: { id: 'asc' } },
      assignees: { select: { userId: true }, orderBy: { id: 'asc' } },
    },
  })
  if (!e?.ticketId) return
  const ticket = await tx.ticket.findUnique({ where: { id: e.ticketId } })
  if (!ticket) return

  const ownerId = e.assignees[0]?.userId ?? null
  const participantIds = e.assignees.slice(1).map((a) => a.userId)
  const nextStatus = mappedTicketStatus(e.status, !!ownerId, () => maintStatusToTicket(e.status?.name ?? null, !!ownerId))
  const nextSev = priorityToSeverity(e.priority)

  const data: Prisma.TicketUncheckedUpdateInput = { title: e.title, hospitalCode: e.hospitals[0]?.hospitalCode ?? null }
  if (nextStatus !== ticket.status) {
    data.status = nextStatus
    data.statusChangedAt = new Date()
    if (nextStatus === 'CLOSED') { data.resolvedAt = e.resolvedAt ?? new Date(); data.closedAt = e.resolvedAt ?? new Date() }
    else { data.resolvedAt = null; data.closedAt = null }
    if (nextStatus === 'PENDING') {
      data.pendingReasonId = await resolvePendingReasonId(tx, e.status?.ticketPendingReasonId, '기타')
      data.pendingNote = '기타업무 보류 (도메인 동기화)'
    } else { data.pendingReasonId = null; data.pendingNote = null }
    await addTicketEvent(tx, ticket.id, 'status_change', actorId, { from: ticket.status, to: nextStatus, via: 'domain_sync' })
  }
  if (nextSev !== ticket.severity) {
    data.severity = nextSev
    await addTicketEvent(tx, ticket.id, 'sev_change', actorId, { from: ticket.severity, to: nextSev, via: 'domain_sync' })
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

/** 티켓 전이/배정 → 기타업무 역동기화 */
export async function syncTicketToEtcTask(tx: Prisma.TransactionClient, ticketId: number) {
  const ticket = await tx.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true, status: true, severity: true, ownerId: true, pendingReasonId: true,
      participants: { select: { userId: true } },
      etcTask: { select: { id: true, statusId: true, resolvedAt: true } },
    },
  })
  if (!ticket?.etcTask) return
  const e = ticket.etcTask

  const nextStatusId = await pickDomainStatus(tx, 'ETC_TASK_STATUS', e.statusId, ticket, ticketStatusToMaint(ticket.status))

  const data: Prisma.EtcTaskUncheckedUpdateInput = { priority: severityToPriority(ticket.severity) }
  if (nextStatusId) {
    data.statusId = nextStatusId
    data.statusChangedAt = new Date()
    if ((ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') && !e.resolvedAt) data.resolvedAt = new Date()
    if (ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED') data.resolvedAt = null
  }
  await tx.etcTask.update({ where: { id: e.id }, data })

  const userIds = [ticket.ownerId, ...ticket.participants.map((p) => p.userId)].filter((v): v is string => !!v)
  await tx.etcTaskAssignee.deleteMany({ where: { etcTaskId: e.id } })
  if (userIds.length) {
    await tx.etcTaskAssignee.createMany({
      data: Array.from(new Set(userIds)).map((userId) => ({ etcTaskId: e.id, userId })),
      skipDuplicates: true,
    })
  }
}

// ── 어댑터 ────────────────────────────────────────────────────

interface EtcBannerRel {
  id: number
  etcTaskCode: string | null
  reportedAt: Date | string | null
  hospitals: { hospital: { hospitalCode: string; hospitalName: string } }[]
}

export const etcTaskAdapter: TicketDomainAdapter = {
  refType: 'ETC',
  meta: TICKET_DOMAIN_META.ETC,
  detailInclude: {
    etcTask: {
      select: {
        id: true, etcTaskCode: true, reportedAt: true,
        hospitals: { select: { hospital: { select: { hospitalCode: true, hospitalName: true } } } },
      },
    },
  },
  syncTicketToDomain: syncTicketToEtcTask,
  buildLinkedWork(ticket) {
    const e = ticket.etcTask as EtcBannerRel | null | undefined
    if (!e) return null
    return {
      refType: 'ETC',
      code: e.etcTaskCode ?? `ETC-${String(e.id).padStart(4, '0')}`,
      meta: [
        `병원 ${
          e.hospitals.length === 0
            ? '-'
            : `${e.hospitals[0].hospital.hospitalName}${e.hospitals.length > 1 ? ` 외 ${e.hospitals.length - 1}곳` : ''}`
        }`,
        `접수일 ${bannerDate(e.reportedAt)}`,
      ].join(' · '),
      href: TICKET_DOMAIN_META.ETC.detailHref({ id: e.id, code: e.etcTaskCode }),
      linkLabel: '기타업무 상세로 이동 →',
    }
  },
}
