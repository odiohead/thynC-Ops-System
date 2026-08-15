/**
 * 설치계획 어댑터 (2026-07-27 단일 상태 축 — ticket_status_map_design.md §7, 구 2축 write/reply는 폴백 전용)
 * 구 lib/ticketDomain.ts 설치계획 블록의 동작 불변 이관 (P0 리팩토링)
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

/** 구 2축 매핑 — statusId 없는 레거시 호출(백필 스크립트)용 폴백 */
export function installPlanStatusToTicket(writeStatus: string, replyStatus: string, hasOwner: boolean): TicketStatus {
  const w = writeStatus === '완료'
  const r = replyStatus === '완료'
  if (w && r) return 'CLOSED'
  if (w) return 'PENDING' // 작성 완료, 회신 대기
  return hasOwner ? 'ASSIGNED' : 'OPEN' // 단일 축 전환과 함께 owner 판정을 타 도메인과 통일 (구 IN_PROGRESS 비일관 해소)
}

/** 단일 축 상태명 → 티켓 상태 (매핑 컬럼 NULL일 때 이름 폴백) */
export function installPlanNameToTicket(statusName: string | null, hasOwner: boolean): TicketStatus {
  switch (statusName) {
    case '작성완료': return 'PENDING' // 회신 대기
    case '보류': return 'PENDING'
    case '회신완료': return 'CLOSED'
    case '접수':
    default:
      return hasOwner ? 'ASSIGNED' : 'OPEN'
  }
}

/** 티켓 상태 → 설치계획 상태명 (역방향 이름 폴백 — 매핑 행 전무 환경) */
export function ticketStatusToInstallPlanName(status: TicketStatus): string {
  switch (status) {
    case 'PENDING': return '작성완료'
    case 'RESOLVED':
    case 'CLOSED': return '회신완료'
    default: return '접수'
  }
}

async function installPlanCtiId(client: DbClient): Promise<number | null> {
  const parent = await client.ticketCti.findFirst({
    where: { level: 2, name: '신규도입', parent: { level: 1, name: '영업' } },
    select: { id: true },
  })
  if (!parent) return null
  const item = await client.ticketCti.findFirst({ where: { parentId: parent.id, name: '설치계획(가안)요청' }, select: { id: true } })
  return item?.id ?? null
}

interface InstallPlanForTicket {
  id: number
  planCode: string | null
  hospitalCode: string | null
  hospitalName: string | null
  statusId?: number | null // 단일 축 상태 (INSTALL_PLAN_STATUS) — 티켓 상태 매핑 컬럼 조회용
  statusName?: string | null // 이름 폴백용
  writeStatus?: string // deprecated — statusId 없는 레거시 호출(백필 스크립트) 폴백 전용
  replyStatus?: string // deprecated — 상동
  assigneeUserIds: string[]
  note?: string | null // 비고 → 티켓 설명 자동 입력 소스
  createdAt: Date
  replyDate: Date | null
}

/** 설치계획용 티켓 생성 (직접 생성·메일큐 승격·백필 공용) */
export async function createTicketForInstallPlan(
  tx: Prisma.TransactionClient,
  ip: InstallPlanForTicket,
  actorId: string | null,
  via: 'domain' | 'backfill'
): Promise<number> {
  const rule = await resolveRuleWithFallback(tx, 'INSTALL_PLAN', () => installPlanCtiId(tx))
  if (!rule.queueId) throw new Error("Assignment Group '설치·답사'가 없습니다. seed-ticket-masters.sql을 먼저 적용하세요.")
  const ctiId = rule.ctiId

  const ownerId = ip.assigneeUserIds[0] ?? null
  const participants = ip.assigneeUserIds.slice(1)
  const statusMap = await getStatusMapping(tx, ip.statusId)
  const status = mappedTicketStatus(statusMap, !!ownerId, () =>
    ip.statusName !== undefined
      ? installPlanNameToTicket(ip.statusName, !!ownerId)
      : installPlanStatusToTicket(ip.writeStatus ?? '-', ip.replyStatus ?? '-', !!ownerId) // 레거시(백필) 폴백
  )
  const statusName = statusMap?.name ?? ip.statusName ?? null

  let pendingReasonId: number | null = null
  let pendingNote: string | null = null
  if (status === 'PENDING') {
    pendingReasonId = await resolvePendingReasonId(tx, statusMap?.ticketPendingReasonId, statusName === '보류' ? '기타' : '외부 회신 대기')
    pendingNote = statusName === '보류' ? '설치계획 보류' : '설치계획 회신 대기'
  }

  const ticketCode = await generateTicketCode(tx)
  const ticket = await tx.ticket.create({
    data: {
      ticketCode,
      title: `[설치계획] ${ip.hospitalName ?? ip.hospitalCode ?? ip.planCode ?? ''}`.trim(),
      descriptionHtml: rule.fillDescription
        ? buildTicketDescription({ refType: 'INSTALL_PLAN', source: ip.note, refCode: ip.planCode })
        : null,
      status,
      severity: 'SEV4',
      queueId: rule.queueId,
      ctiId,
      ownerId,
      hospitalCode: ip.hospitalCode,
      refType: 'INSTALL_PLAN',
      pendingReasonId,
      pendingNote,
      createdAt: via === 'backfill' ? ip.createdAt : undefined,
      statusChangedAt: via === 'backfill' ? ip.createdAt : undefined,
      resolvedAt: status === 'CLOSED' ? ip.replyDate ?? undefined : undefined,
      closedAt: status === 'CLOSED' ? ip.replyDate ?? ip.createdAt : undefined,
      participants: participants.length ? { create: participants.map((userId) => ({ userId })) } : undefined,
    },
  })
  await addTicketEvent(tx, ticket.id, 'created', actorId, { via, refType: 'INSTALL_PLAN', refCode: ip.planCode })
  await tx.installPlan.update({ where: { id: ip.id }, data: { ticketId: ticket.id } })
  return ticket.id
}

/** 설치계획 변경 → 티켓 동기화 */
export async function syncInstallPlanToTicket(tx: Prisma.TransactionClient, installPlanId: number, actorId: string | null) {
  const ip = await tx.installPlan.findUnique({
    where: { id: installPlanId },
    select: {
      id: true, ticketId: true, hospitalCode: true, replyDate: true,
      status: { select: STATUS_MAPPING_SELECT },
      hospital: { select: { hospitalName: true } },
      assignees: { select: { userId: true }, orderBy: { id: 'asc' } },
    },
  })
  if (!ip?.ticketId) return
  const ticket = await tx.ticket.findUnique({ where: { id: ip.ticketId } })
  if (!ticket) return

  const ownerId = ip.assignees[0]?.userId ?? null
  const participantIds = ip.assignees.slice(1).map((a) => a.userId)
  const nextStatus = mappedTicketStatus(ip.status, !!ownerId, () => installPlanNameToTicket(ip.status?.name ?? null, !!ownerId))

  const data: Prisma.TicketUncheckedUpdateInput = {
    title: `[설치계획] ${ip.hospital?.hospitalName ?? ip.hospitalCode ?? ''}`.trim(),
    hospitalCode: ip.hospitalCode,
  }
  if (nextStatus !== ticket.status) {
    data.status = nextStatus
    data.statusChangedAt = new Date()
    if (nextStatus === 'CLOSED') { data.resolvedAt = ip.replyDate ?? new Date(); data.closedAt = ip.replyDate ?? new Date() }
    else { data.resolvedAt = null; data.closedAt = null }
    if (nextStatus === 'PENDING') {
      data.pendingReasonId = await resolvePendingReasonId(tx, ip.status?.ticketPendingReasonId, ip.status?.name === '보류' ? '기타' : '외부 회신 대기')
      data.pendingNote = ip.status?.name === '보류' ? '설치계획 보류' : '설치계획 회신 대기'
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

/** 티켓 전이/배정 → 설치계획 역동기화 (단일 축 statusId — keep-if-consistent·사유 우선) */
export async function syncTicketToInstallPlan(tx: Prisma.TransactionClient, ticketId: number) {
  const ticket = await tx.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true, status: true, ownerId: true, pendingReasonId: true,
      participants: { select: { userId: true } },
      installPlan: { select: { id: true, statusId: true, replyDate: true } },
    },
  })
  if (!ticket?.installPlan) return
  const ip = ticket.installPlan

  const nextStatusId = await pickDomainStatus(tx, 'INSTALL_PLAN_STATUS', ip.statusId, ticket, ticketStatusToInstallPlanName(ticket.status))
  const data: Prisma.InstallPlanUncheckedUpdateInput = {}
  if (nextStatusId) data.statusId = nextStatusId
  if ((ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') && !ip.replyDate) data.replyDate = new Date()
  if (Object.keys(data).length) await tx.installPlan.update({ where: { id: ip.id }, data })

  const userIds = [ticket.ownerId, ...ticket.participants.map((p) => p.userId)].filter((v): v is string => !!v)
  await tx.installPlanAssignee.deleteMany({ where: { installPlanId: ip.id } })
  if (userIds.length) {
    await tx.installPlanAssignee.createMany({
      data: Array.from(new Set(userIds)).map((userId) => ({ installPlanId: ip.id, userId })),
      skipDuplicates: true,
    })
  }
}

// ── 어댑터 ────────────────────────────────────────────────────

interface InstallPlanBannerRel {
  id: number
  planCode: string | null
  requestDate: Date | string | null
  status: { name: string } | null
  replyDate: Date | string | null
}

export const installPlanAdapter: TicketDomainAdapter = {
  refType: 'INSTALL_PLAN',
  meta: TICKET_DOMAIN_META.INSTALL_PLAN,
  detailInclude: {
    installPlan: { select: { id: true, planCode: true, requestDate: true, status: { select: { name: true } }, replyDate: true } },
  },
  syncTicketToDomain: syncTicketToInstallPlan,
  buildLinkedWork(ticket) {
    const ip = ticket.installPlan as InstallPlanBannerRel | null | undefined
    if (!ip) return null
    return {
      refType: 'INSTALL_PLAN',
      code: ip.planCode ?? `#${ip.id}`,
      meta: [
        `요청일 ${bannerDate(ip.requestDate)}`,
        `상태 ${ip.status?.name ?? '-'}`,
        `회신일 ${bannerDate(ip.replyDate)}`,
      ].join(' · '),
      href: TICKET_DOMAIN_META.INSTALL_PLAN.detailHref({ id: ip.id, code: ip.planCode }),
      linkLabel: '설치계획 상세로 이동 →',
    }
  },
}
