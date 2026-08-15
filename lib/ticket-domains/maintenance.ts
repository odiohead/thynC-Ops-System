/**
 * 유지보수 어댑터 (P5) — 구 lib/ticketDomain.ts 유지보수 블록의 동작 불변 이관 (P0 리팩토링)
 */
import { Prisma, TicketStatus, TicketSeverity } from '@prisma/client'
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

// ── 상태·우선순위 폴백 매핑 (매핑 컬럼 유실 시 전용) ─────────────

/** 유지보수 상태명 → 티켓 상태 (P5 확정 매핑) */
export function maintStatusToTicket(statusName: string | null, hasOwner: boolean): TicketStatus {
  switch (statusName) {
    case '처리중': return 'IN_PROGRESS'
    case '보류': return 'PENDING'
    case '완료': return 'CLOSED'
    case '접수':
    default:
      return hasOwner ? 'ASSIGNED' : 'OPEN'
  }
}

/** 티켓 상태 → 유지보수 상태명 (역방향) */
export function ticketStatusToMaint(status: TicketStatus): string {
  switch (status) {
    case 'IN_PROGRESS': return '처리중'
    case 'PENDING': return '보류'
    case 'RESOLVED':
    case 'CLOSED': return '완료'
    default: return '접수'
  }
}

/** 우선순위 → Severity (§2.6 확정: 긴급→2, 높음→3, 보통→4, 낮음→5) — 기타업무와 공유 */
export function priorityToSeverity(priority: string | null): TicketSeverity {
  switch (priority) {
    case '긴급': return 'SEV2'
    case '높음': return 'SEV3'
    case '낮음': return 'SEV5'
    default: return 'SEV4'
  }
}

export function severityToPriority(sev: TicketSeverity): string {
  switch (sev) {
    case 'SEV1':
    case 'SEV2': return '긴급'
    case 'SEV3': return '높음'
    case 'SEV5': return '낮음'
    default: return '보통'
  }
}

/** 장애유형(MAINTENANCE_TYPE 이름) → CTI Item id (고객지원/장애/*). 못 찾으면 '기타' */
export async function maintTypeToCtiId(client: DbClient, typeName: string | null): Promise<number | null> {
  const fault = await client.ticketCti.findFirst({
    where: { level: 2, name: '장애', parent: { level: 1, name: '고객지원' } },
    select: { id: true },
  })
  if (!fault) return null
  const item = await client.ticketCti.findFirst({
    where: { parentId: fault.id, name: typeName ?? '기타' },
    select: { id: true },
  })
  if (item) return item.id
  const etc = await client.ticketCti.findFirst({ where: { parentId: fault.id, name: '기타' }, select: { id: true } })
  return etc?.id ?? null
}

export async function maintenanceQueueId(client: DbClient): Promise<number | null> {
  const q = await client.ticketQueue.findUnique({ where: { name: '유지보수' }, select: { id: true } })
  return q?.id ?? null
}

// ── 생성·동기화 ───────────────────────────────────────────────

interface MaintForTicket {
  id: number
  maintenanceCode: string | null
  title: string
  hospitalCode: string
  priority: string | null
  statusName: string | null
  statusId?: number | null // 상태 status_code id — 티켓 상태 매핑 컬럼 조회용 (없으면 이름 폴백)
  typeName: string | null
  typeId?: number | null // 장애유형 status_code id — 자동생성 규칙 조건 축
  symptoms?: string | null // 증상 → 티켓 설명 자동 입력 소스
  assigneeUserIds: string[] // 등록 순서 — 첫 번째가 owner
  reportedAt: Date | null
  resolvedAt: Date | null
  createdAt: Date
}

/** 유지보수용 티켓 생성 (POST 생성 경로·백필 공용). 반환: ticketId */
export async function createTicketForMaintenance(
  tx: Prisma.TransactionClient,
  m: MaintForTicket,
  actorId: string | null,
  via: 'domain' | 'backfill'
): Promise<number> {
  const rule = await resolveRuleWithFallback(tx, 'MAINTENANCE', () => maintTypeToCtiId(tx, m.typeName), {
    statusCodeId: m.typeId ?? null,
  })
  const queueId = rule.queueId
  if (!queueId) throw new Error("Assignment Group '유지보수'가 없습니다. seed-ticket-masters.sql을 먼저 적용하세요.")
  const ctiId = rule.ctiId

  const ownerId = m.assigneeUserIds[0] ?? null
  const participants = m.assigneeUserIds.slice(1)
  const statusMap = await getStatusMapping(tx, m.statusId)
  const status = mappedTicketStatus(statusMap, !!ownerId, () => maintStatusToTicket(m.statusName, !!ownerId))
  const severity = priorityToSeverity(m.priority)

  let pendingReasonId: number | null = null
  let pendingNote: string | null = null
  if (status === 'PENDING') {
    pendingReasonId = await resolvePendingReasonId(tx, statusMap?.ticketPendingReasonId, '기타')
    pendingNote = '유지보수 보류 (도메인 동기화)'
  }

  const ticketCode = await generateTicketCode(tx)
  const ticket = await tx.ticket.create({
    data: {
      ticketCode,
      title: m.title,
      descriptionHtml: rule.fillDescription
        ? buildTicketDescription({ refType: 'MAINTENANCE', source: m.symptoms, refCode: m.maintenanceCode })
        : null,
      status,
      severity,
      queueId,
      ctiId,
      ownerId,
      hospitalCode: m.hospitalCode,
      refType: 'MAINTENANCE',
      pendingReasonId,
      pendingNote,
      createdAt: via === 'backfill' ? m.createdAt : undefined,
      statusChangedAt: via === 'backfill' ? m.createdAt : undefined,
      resolvedAt: status === 'CLOSED' ? m.resolvedAt ?? undefined : undefined,
      closedAt: status === 'CLOSED' ? m.resolvedAt ?? m.createdAt : undefined,
      participants: participants.length ? { create: participants.map((userId) => ({ userId })) } : undefined,
    },
  })
  await addTicketEvent(tx, ticket.id, 'created', actorId, { via, refType: 'MAINTENANCE', refCode: m.maintenanceCode })
  await tx.maintenance.update({ where: { id: m.id }, data: { ticketId: ticket.id } })
  return ticket.id
}

/**
 * 유지보수 변경 → 티켓 동기화 (상태·우선순위·유형·담당·제목·병원).
 * 유지보수 PATCH/담당변경 핸들러의 트랜잭션 안에서 호출.
 */
export async function syncMaintenanceToTicket(tx: Prisma.TransactionClient, maintenanceId: number, actorId: string | null) {
  const m = await tx.maintenance.findUnique({
    where: { id: maintenanceId },
    select: {
      id: true, ticketId: true, title: true, hospitalCode: true, priority: true, resolvedAt: true, typeId: true,
      status: { select: STATUS_MAPPING_SELECT },
      type: { select: { name: true } },
      assignees: { select: { userId: true }, orderBy: { id: 'asc' } },
    },
  })
  if (!m?.ticketId) return
  const ticket = await tx.ticket.findUnique({ where: { id: m.ticketId } })
  if (!ticket) return

  const ownerId = m.assignees[0]?.userId ?? null
  const participantIds = m.assignees.slice(1).map((a) => a.userId)
  const nextStatus = mappedTicketStatus(m.status, !!ownerId, () => maintStatusToTicket(m.status?.name ?? null, !!ownerId))
  const nextSev = priorityToSeverity(m.priority)
  // 장애유형 변경 → CTI 재동기화 (유지보수만 유지되는 예외 — 규칙 테이블 경유로 ID 기반 매칭)
  const nextCti = (
    await resolveRuleWithFallback(tx, 'MAINTENANCE', () => maintTypeToCtiId(tx, m.type?.name ?? null), {
      statusCodeId: m.typeId ?? null,
    })
  ).ctiId

  const data: Prisma.TicketUncheckedUpdateInput = { title: m.title, hospitalCode: m.hospitalCode }
  if (nextStatus !== ticket.status) {
    data.status = nextStatus
    data.statusChangedAt = new Date()
    if (nextStatus === 'CLOSED') { data.resolvedAt = m.resolvedAt ?? new Date(); data.closedAt = m.resolvedAt ?? new Date() }
    else { data.resolvedAt = null; data.closedAt = null }
    if (nextStatus === 'PENDING') {
      // 사유: 매핑 행 지정 → '기타' 폴백 (티켓 PENDING 사유 필수 규칙 충족)
      data.pendingReasonId = await resolvePendingReasonId(tx, m.status?.ticketPendingReasonId, '기타')
      data.pendingNote = '유지보수 보류 (도메인 동기화)'
    } else { data.pendingReasonId = null; data.pendingNote = null }
    await addTicketEvent(tx, ticket.id, 'status_change', actorId, { from: ticket.status, to: nextStatus, via: 'domain_sync' })
  }
  if (nextSev !== ticket.severity) {
    data.severity = nextSev
    await addTicketEvent(tx, ticket.id, 'sev_change', actorId, { from: ticket.severity, to: nextSev, via: 'domain_sync' })
  }
  if (nextCti && nextCti !== ticket.ctiId) {
    data.ctiId = nextCti
    await addTicketEvent(tx, ticket.id, 'cti_change', actorId, { from: ticket.ctiId, to: nextCti, via: 'domain_sync' })
  }
  if (ownerId !== ticket.ownerId) {
    data.ownerId = ownerId
    await addTicketEvent(tx, ticket.id, 'assign', actorId, { from: ticket.ownerId, to: ownerId, via: 'domain_sync' })
  }
  await tx.ticket.update({ where: { id: ticket.id }, data })
  await tx.ticketParticipant.deleteMany({ where: { ticketId: ticket.id } })
  if (participantIds.length) {
    await tx.ticketParticipant.createMany({
      data: participantIds.map((userId) => ({ ticketId: ticket.id!, userId })),
      skipDuplicates: true,
    })
  }
}

/**
 * 티켓 전이/배정 → 유지보수 역동기화. 티켓 transition/assign 핸들러의 트랜잭션 안에서 호출.
 * (도메인 연결 티켓일 때만 — registry.syncTicketToDomain이 refType으로 디스패치)
 */
export async function syncTicketToMaintenance(tx: Prisma.TransactionClient, ticketId: number) {
  const ticket = await tx.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true, status: true, severity: true, ownerId: true, pendingReasonId: true,
      participants: { select: { userId: true } },
      maintenance: { select: { id: true, statusId: true, resolvedAt: true } },
    },
  })
  if (!ticket?.maintenance) return
  const m = ticket.maintenance

  const nextStatusId = await pickDomainStatus(tx, 'MAINTENANCE_STATUS', m.statusId, ticket, ticketStatusToMaint(ticket.status))

  const data: Prisma.MaintenanceUncheckedUpdateInput = { priority: severityToPriority(ticket.severity) }
  if (nextStatusId) {
    data.statusId = nextStatusId
    data.statusChangedAt = new Date()
    if ((ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') && !m.resolvedAt) data.resolvedAt = new Date()
    if (ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED') data.resolvedAt = null
  }
  await tx.maintenance.update({ where: { id: m.id }, data })

  // 담당: owner + 참여자 순서로 재구성
  const userIds = [ticket.ownerId, ...ticket.participants.map((p) => p.userId)].filter((v): v is string => !!v)
  await tx.maintenanceAssignee.deleteMany({ where: { maintenanceId: m.id } })
  if (userIds.length) {
    await tx.maintenanceAssignee.createMany({
      data: Array.from(new Set(userIds)).map((userId) => ({ maintenanceId: m.id, userId })),
      skipDuplicates: true,
    })
  }
}

// ── 어댑터 ────────────────────────────────────────────────────

interface MaintenanceBannerRel {
  id: number
  maintenanceCode: string | null
  reporterName: string | null
  isRemote: boolean
  reportedAt: Date | string | null
}

export const maintenanceAdapter: TicketDomainAdapter = {
  refType: 'MAINTENANCE',
  meta: TICKET_DOMAIN_META.MAINTENANCE,
  detailInclude: {
    maintenance: { select: { id: true, maintenanceCode: true, reporterName: true, isRemote: true, reportedAt: true } },
  },
  syncTicketToDomain: syncTicketToMaintenance,
  buildLinkedWork(ticket) {
    const m = ticket.maintenance as MaintenanceBannerRel | null | undefined
    if (!m) return null
    return {
      refType: 'MAINTENANCE',
      code: m.maintenanceCode ?? `MNT-${String(m.id).padStart(4, '0')}`,
      meta: [
        `신고자 ${m.reporterName || '-'}`,
        m.isRemote ? '원격' : '방문',
        `접수일 ${bannerDate(m.reportedAt)}`,
      ].join(' · '),
      href: TICKET_DOMAIN_META.MAINTENANCE.detailHref({ id: m.id, code: m.maintenanceCode }),
      linkLabel: '유지보수 상세로 이동 →',
    }
  },
}
