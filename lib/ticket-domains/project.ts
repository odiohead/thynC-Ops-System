/**
 * 프로젝트 어댑터 (P9 — BuildStatus 라벨 의미 앵커 매핑, assignee FK=projectCode)
 * 구 lib/ticketDomain.ts 프로젝트 블록의 동작 불변 이관 (P0 리팩토링)
 */
import { Prisma, TicketStatus } from '@prisma/client'
import { generateTicketCode, addTicketEvent } from '@/lib/ticket'
import { buildTicketDescription } from '@/lib/ticketCtiRules'
import { TICKET_DOMAIN_META } from './meta'
import type { TicketDomainAdapter } from './types'
import {
  type DbClient,
  applyOwnerRule,
  pickBuildStatus,
  resolvePendingReasonId,
  resolveRuleWithFallback,
  bannerDate,
} from './shared'

export function projectStatusToTicket(label: string | null, hasOwner: boolean): TicketStatus {
  if (!label) return hasOwner ? 'ASSIGNED' : 'OPEN'
  if (label.includes('완료')) return 'CLOSED'
  if (label.includes('보류')) return 'PENDING'
  if (label.includes('준비')) return hasOwner ? 'ASSIGNED' : 'OPEN'
  return 'IN_PROGRESS'
}

async function projectCtiId(client: DbClient): Promise<number | null> {
  const parent = await client.ticketCti.findFirst({
    where: { level: 2, name: '신규도입', parent: { level: 1, name: '영업' } },
    select: { id: true },
  })
  if (!parent) return null
  const item = await client.ticketCti.findFirst({ where: { parentId: parent.id, name: '구축' }, select: { id: true } })
  return item?.id ?? null
}

interface ProjectForTicket {
  id: number
  projectCode: string
  projectName: string
  hospitalCode: string
  buildStatusLabel: string | null
  buildStatusId?: number | null // build_statuses id — 티켓 상태 매핑 컬럼 조회용 (없으면 라벨 앵커 폴백)
  assigneeUserIds: string[]
  endDateExpected: Date | null
  remark?: string | null // 비고 → 티켓 설명 자동 입력 소스
  createdAt: Date
}

/** 프로젝트용 티켓 생성 (POST·백필 공용). dueAt = endDateExpected */
export async function createTicketForProject(
  tx: Prisma.TransactionClient,
  p: ProjectForTicket,
  actorId: string | null,
  via: 'domain' | 'backfill'
): Promise<number> {
  const rule = await resolveRuleWithFallback(tx, 'PROJECT', () => projectCtiId(tx))
  if (!rule.queueId) throw new Error("Assignment Group '설치·답사'가 없습니다. seed-ticket-masters.sql을 먼저 적용하세요.")
  const ctiId = rule.ctiId

  const ownerId = p.assigneeUserIds[0] ?? null
  const participants = p.assigneeUserIds.slice(1)
  const bs = p.buildStatusId
    ? await tx.buildStatus.findUnique({ where: { id: p.buildStatusId }, select: { ticketStatus: true } })
    : null
  const status = bs?.ticketStatus
    ? applyOwnerRule(bs.ticketStatus, !!ownerId)
    : projectStatusToTicket(p.buildStatusLabel, !!ownerId)

  let pendingReasonId: number | null = null
  let pendingNote: string | null = null
  if (status === 'PENDING') {
    pendingReasonId = await resolvePendingReasonId(tx, null, '기타')
    pendingNote = '프로젝트 보류 (도메인 동기화)'
  }

  const ticketCode = await generateTicketCode(tx)
  const ticket = await tx.ticket.create({
    data: {
      ticketCode,
      title: `[프로젝트] ${p.projectName}`,
      descriptionHtml: rule.fillDescription
        ? buildTicketDescription({ refType: 'PROJECT', source: p.remark, refCode: p.projectCode })
        : null,
      status,
      severity: 'SEV4',
      queueId: rule.queueId,
      ctiId,
      ownerId,
      hospitalCode: p.hospitalCode,
      refType: 'PROJECT',
      dueAt: p.endDateExpected,
      pendingReasonId,
      pendingNote,
      createdAt: via === 'backfill' ? p.createdAt : undefined,
      statusChangedAt: via === 'backfill' ? p.createdAt : undefined,
      resolvedAt: status === 'CLOSED' ? p.createdAt : undefined,
      closedAt: status === 'CLOSED' ? p.createdAt : undefined,
      participants: participants.length ? { create: participants.map((userId) => ({ userId })) } : undefined,
    },
  })
  await addTicketEvent(tx, ticket.id, 'created', actorId, { via, refType: 'PROJECT', refCode: p.projectCode })
  await tx.project.update({ where: { id: p.id }, data: { ticketId: ticket.id } })
  return ticket.id
}

/** 프로젝트 변경 → 티켓 동기화 */
export async function syncProjectToTicket(tx: Prisma.TransactionClient, projectId: number, actorId: string | null) {
  const p = await tx.project.findUnique({
    where: { id: projectId },
    select: {
      id: true, ticketId: true, projectCode: true, projectName: true, hospitalCode: true, endDateExpected: true,
      buildStatus: { select: { label: true, ticketStatus: true } },
      assignees: { select: { userId: true }, orderBy: { id: 'asc' } },
    },
  })
  if (!p?.ticketId) return
  const ticket = await tx.ticket.findUnique({ where: { id: p.ticketId } })
  if (!ticket) return

  const ownerId = p.assignees[0]?.userId ?? null
  const participantIds = p.assignees.slice(1).map((a) => a.userId)
  const nextStatus = p.buildStatus?.ticketStatus
    ? applyOwnerRule(p.buildStatus.ticketStatus, !!ownerId)
    : projectStatusToTicket(p.buildStatus?.label ?? null, !!ownerId)

  const data: Prisma.TicketUncheckedUpdateInput = {
    title: `[프로젝트] ${p.projectName}`,
    hospitalCode: p.hospitalCode,
    dueAt: p.endDateExpected,
  }
  if (nextStatus !== ticket.status) {
    data.status = nextStatus
    data.statusChangedAt = new Date()
    if (nextStatus === 'CLOSED') { data.resolvedAt = new Date(); data.closedAt = new Date() }
    else { data.resolvedAt = null; data.closedAt = null }
    if (nextStatus === 'PENDING') {
      const reason = await tx.ticketPendingReason.findUnique({ where: { name: '기타' }, select: { id: true } })
      data.pendingReasonId = reason?.id ?? null
      data.pendingNote = '프로젝트 보류 (도메인 동기화)'
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

/** 티켓 전이/배정 → 프로젝트 역동기화 (ticket_status 매핑 우선·keep-if-consistent, 라벨 앵커 폴백) */
export async function syncTicketToProject(tx: Prisma.TransactionClient, ticketId: number) {
  const ticket = await tx.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true, status: true, ownerId: true,
      participants: { select: { userId: true } },
      project: { select: { id: true, projectCode: true, buildStatusId: true } },
    },
  })
  if (!ticket?.project) return
  const p = ticket.project

  const nextBuildStatusId = await pickBuildStatus(tx, p.buildStatusId, ticket.status)
  const data: Prisma.ProjectUncheckedUpdateInput = {}
  if (nextBuildStatusId) {
    data.buildStatusId = nextBuildStatusId
    data.statusChangedAt = new Date()
  }
  if (Object.keys(data).length) await tx.project.update({ where: { id: p.id }, data })

  // 담당: FK가 projectCode(문자열)
  const userIds = [ticket.ownerId, ...ticket.participants.map((pt) => pt.userId)].filter((v): v is string => !!v)
  await tx.projectAssignee.deleteMany({ where: { projectCode: p.projectCode } })
  if (userIds.length) {
    await tx.projectAssignee.createMany({
      data: Array.from(new Set(userIds)).map((userId) => ({ projectCode: p.projectCode, userId })),
      skipDuplicates: true,
    })
  }
}

// ── 어댑터 ────────────────────────────────────────────────────

interface ProjectBannerRel {
  id: number
  projectCode: string
  projectName: string
  startDate: Date | string | null
  endDateExpected: Date | string | null
  buildStatus: { label: string } | null
}

export const projectAdapter: TicketDomainAdapter = {
  refType: 'PROJECT',
  meta: TICKET_DOMAIN_META.PROJECT,
  detailInclude: {
    project: {
      select: { id: true, projectCode: true, projectName: true, startDate: true, endDateExpected: true, buildStatus: { select: { label: true } } },
    },
  },
  syncTicketToDomain: syncTicketToProject,
  buildLinkedWork(ticket) {
    const p = ticket.project as ProjectBannerRel | null | undefined
    if (!p) return null
    return {
      refType: 'PROJECT',
      code: p.projectCode,
      meta: [
        p.projectName,
        `공사상태 ${p.buildStatus?.label ?? '-'}`,
        `구축시작 ${bannerDate(p.startDate)}`,
        `완료예정 ${bannerDate(p.endDateExpected)}`,
      ].join(' · '),
      href: TICKET_DOMAIN_META.PROJECT.detailHref({ id: p.id, code: p.projectCode }),
      linkLabel: '프로젝트 상세로 이동 →',
    }
  },
}
