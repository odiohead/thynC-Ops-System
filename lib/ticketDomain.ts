/**
 * 도메인 ↔ 티켓 동기화 (P5~: 유지보수부터)
 *
 * 원칙 (ticket_dev_schedule.md P5 상세 설계):
 * - 각 API 핸들러가 한 트랜잭션에서 양쪽을 갱신한다 (DB 트리거 없음 → 루프 없음)
 * - 도메인 연결 티켓의 Slack 알림은 도메인 taskType이 대표한다 (TICKET 알림 미발송)
 */
import { Prisma, TicketStatus, TicketSeverity } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { generateTicketCode, addTicketEvent } from '@/lib/ticket'

type DbClient = Prisma.TransactionClient | typeof prisma

// ── 유지보수 매핑 ─────────────────────────────────────────────

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

/** 우선순위 → Severity (§2.6 확정: 긴급→2, 높음→3, 보통→4, 낮음→5) */
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
  typeName: string | null
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
  const queueId = await maintenanceQueueId(tx)
  if (!queueId) throw new Error("티켓 큐 '유지보수'가 없습니다. seed-ticket-masters.sql을 먼저 적용하세요.")
  const ctiId = await maintTypeToCtiId(tx, m.typeName)

  const ownerId = m.assigneeUserIds[0] ?? null
  const participants = m.assigneeUserIds.slice(1)
  const status = maintStatusToTicket(m.statusName, !!ownerId)

  const ticketCode = await generateTicketCode(tx)
  const ticket = await tx.ticket.create({
    data: {
      ticketCode,
      title: m.title,
      status,
      severity: priorityToSeverity(m.priority),
      queueId,
      ctiId,
      ownerId,
      hospitalCode: m.hospitalCode,
      refType: 'MAINTENANCE',
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
      id: true, ticketId: true, title: true, hospitalCode: true, priority: true, resolvedAt: true,
      status: { select: { name: true } },
      type: { select: { name: true } },
      assignees: { select: { userId: true }, orderBy: { id: 'asc' } },
    },
  })
  if (!m?.ticketId) return
  const ticket = await tx.ticket.findUnique({ where: { id: m.ticketId } })
  if (!ticket) return

  const ownerId = m.assignees[0]?.userId ?? null
  const participantIds = m.assignees.slice(1).map((a) => a.userId)
  const nextStatus = maintStatusToTicket(m.status?.name ?? null, !!ownerId)
  const nextSev = priorityToSeverity(m.priority)
  const nextCti = await maintTypeToCtiId(tx, m.type?.name ?? null)

  const data: Prisma.TicketUncheckedUpdateInput = { title: m.title, hospitalCode: m.hospitalCode }
  if (nextStatus !== ticket.status) {
    data.status = nextStatus
    data.statusChangedAt = new Date()
    if (nextStatus === 'CLOSED') { data.resolvedAt = m.resolvedAt ?? new Date(); data.closedAt = m.resolvedAt ?? new Date() }
    else { data.resolvedAt = null; data.closedAt = null }
    if (nextStatus === 'PENDING') {
      // 도메인 '보류'는 사유 미보유 — '기타' 사유로 채움 (티켓 PENDING 사유 필수 규칙 충족)
      const etc = await tx.ticketPendingReason.findUnique({ where: { name: '기타' }, select: { id: true } })
      data.pendingReasonId = etc?.id ?? null
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

// ── 공통 진입점 (티켓 라우트용 — refType별 분기) ─────────────

/** 티켓 변경 → 도메인 역동기화 (refType 기준 분기). 티켓 mutation 트랜잭션 안에서 호출 */
export async function syncTicketToDomain(tx: Prisma.TransactionClient, ticketId: number, refType: string | null) {
  if (refType === 'MAINTENANCE') await syncTicketToMaintenance(tx, ticketId)
  else if (refType === 'ETC') await syncTicketToEtcTask(tx, ticketId)
  else if (refType === 'SITE_VISIT') await syncTicketToSiteVisit(tx, ticketId)
  else if (refType === 'INSTALL_PLAN') await syncTicketToInstallPlan(tx, ticketId)
  else if (refType === 'PROJECT') await syncTicketToProject(tx, ticketId)
}

/** 도메인 연결 티켓의 대표 Slack 알림 참조 (없으면 null → TICKET 알림 사용) */
export async function domainNotifyRef(
  ticketId: number,
  refType: string | null
): Promise<{ taskType: 'MAINTENANCE' | 'ETC' | 'SITE_VISIT' | 'INSTALL_PLAN' | 'PROJECT'; refCode: string } | null> {
  if (refType === 'MAINTENANCE') {
    const m = await prisma.maintenance.findUnique({ where: { ticketId }, select: { maintenanceCode: true } })
    return m?.maintenanceCode ? { taskType: 'MAINTENANCE', refCode: m.maintenanceCode } : null
  }
  if (refType === 'ETC') {
    const e = await prisma.etcTask.findUnique({ where: { ticketId }, select: { etcTaskCode: true } })
    return e?.etcTaskCode ? { taskType: 'ETC', refCode: e.etcTaskCode } : null
  }
  if (refType === 'SITE_VISIT') {
    const s = await prisma.siteVisit.findUnique({ where: { ticketId }, select: { siteVisitCode: true } })
    return s?.siteVisitCode ? { taskType: 'SITE_VISIT', refCode: s.siteVisitCode } : null
  }
  if (refType === 'INSTALL_PLAN') {
    const ip = await prisma.installPlan.findUnique({ where: { ticketId }, select: { planCode: true } })
    return ip?.planCode ? { taskType: 'INSTALL_PLAN', refCode: ip.planCode } : null
  }
  if (refType === 'PROJECT') {
    const p = await prisma.project.findUnique({ where: { ticketId }, select: { projectCode: true } })
    return p?.projectCode ? { taskType: 'PROJECT', refCode: p.projectCode } : null
  }
  return null
}

// ── 프로젝트 (P9 — BuildStatus 라벨 의미 앵커 매핑, assignee FK=projectCode) ──

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
  assigneeUserIds: string[]
  endDateExpected: Date | null
  createdAt: Date
}

/** 프로젝트용 티켓 생성 (POST·백필 공용). dueAt = endDateExpected */
export async function createTicketForProject(
  tx: Prisma.TransactionClient,
  p: ProjectForTicket,
  actorId: string | null,
  via: 'domain' | 'backfill'
): Promise<number> {
  const queue = await tx.ticketQueue.findUnique({ where: { name: '설치·답사' }, select: { id: true } })
  if (!queue) throw new Error("티켓 큐 '설치·답사'가 없습니다. seed-ticket-masters.sql을 먼저 적용하세요.")
  const ctiId = await projectCtiId(tx)

  const ownerId = p.assigneeUserIds[0] ?? null
  const participants = p.assigneeUserIds.slice(1)
  const status = projectStatusToTicket(p.buildStatusLabel, !!ownerId)

  let pendingReasonId: number | null = null
  let pendingNote: string | null = null
  if (status === 'PENDING') {
    const reason = await tx.ticketPendingReason.findUnique({ where: { name: '기타' }, select: { id: true } })
    pendingReasonId = reason?.id ?? null
    pendingNote = '프로젝트 보류 (도메인 동기화)'
  }

  const ticketCode = await generateTicketCode(tx)
  const ticket = await tx.ticket.create({
    data: {
      ticketCode,
      title: `[프로젝트] ${p.projectName}`,
      status,
      severity: 'SEV4',
      queueId: queue.id,
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
      buildStatus: { select: { label: true } },
      assignees: { select: { userId: true }, orderBy: { id: 'asc' } },
    },
  })
  if (!p?.ticketId) return
  const ticket = await tx.ticket.findUnique({ where: { id: p.ticketId } })
  if (!ticket) return

  const ownerId = p.assignees[0]?.userId ?? null
  const participantIds = p.assignees.slice(1).map((a) => a.userId)
  const nextStatus = projectStatusToTicket(p.buildStatus?.label ?? null, !!ownerId)

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

/** 티켓 전이/배정 → 프로젝트 역동기화 (BuildStatus는 라벨 앵커 findFirst best-effort) */
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

  const anchor =
    ticket.status === 'RESOLVED' || ticket.status === 'CLOSED' ? '완료'
    : ticket.status === 'PENDING' ? '보류'
    : ticket.status === 'IN_PROGRESS' ? '진행'
    : '준비'
  const build = await tx.buildStatus.findFirst({ where: { label: { contains: anchor } }, select: { id: true } })
  const data: Prisma.ProjectUncheckedUpdateInput = {}
  if (build && build.id !== p.buildStatusId) {
    data.buildStatusId = build.id
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

// ── 설치계획 (P8 — 2축 상태 write/reply ↔ 티켓 단일 상태) ──

export function installPlanStatusToTicket(writeStatus: string, replyStatus: string, hasOwner: boolean): TicketStatus {
  const w = writeStatus === '완료'
  const r = replyStatus === '완료'
  if (w && r) return 'CLOSED'
  if (w) return 'PENDING' // 작성 완료, 회신 대기
  return hasOwner ? 'IN_PROGRESS' : 'OPEN'
}

export function ticketStatusToInstallPlan(status: TicketStatus): { writeStatus: string; replyStatus: string } {
  switch (status) {
    case 'RESOLVED':
    case 'CLOSED': return { writeStatus: '완료', replyStatus: '완료' }
    case 'PENDING': return { writeStatus: '완료', replyStatus: '미완료' }
    default: return { writeStatus: '미완료', replyStatus: '미완료' }
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
  writeStatus: string
  replyStatus: string
  assigneeUserIds: string[]
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
  const queue = await tx.ticketQueue.findUnique({ where: { name: '설치·답사' }, select: { id: true } })
  if (!queue) throw new Error("티켓 큐 '설치·답사'가 없습니다. seed-ticket-masters.sql을 먼저 적용하세요.")
  const ctiId = await installPlanCtiId(tx)

  const ownerId = ip.assigneeUserIds[0] ?? null
  const participants = ip.assigneeUserIds.slice(1)
  const status = installPlanStatusToTicket(ip.writeStatus, ip.replyStatus, !!ownerId)

  let pendingReasonId: number | null = null
  let pendingNote: string | null = null
  if (status === 'PENDING') {
    const reason = await tx.ticketPendingReason.findUnique({ where: { name: '외부 회신 대기' }, select: { id: true } })
    pendingReasonId = reason?.id ?? null
    pendingNote = '설치계획 회신 대기'
  }

  const ticketCode = await generateTicketCode(tx)
  const ticket = await tx.ticket.create({
    data: {
      ticketCode,
      title: `[설치계획] ${ip.hospitalName ?? ip.hospitalCode ?? ip.planCode ?? ''}`.trim(),
      status,
      severity: 'SEV4',
      queueId: queue.id,
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
      id: true, ticketId: true, hospitalCode: true, writeStatus: true, replyStatus: true, replyDate: true,
      hospital: { select: { hospitalName: true } },
      assignees: { select: { userId: true }, orderBy: { id: 'asc' } },
    },
  })
  if (!ip?.ticketId) return
  const ticket = await tx.ticket.findUnique({ where: { id: ip.ticketId } })
  if (!ticket) return

  const ownerId = ip.assignees[0]?.userId ?? null
  const participantIds = ip.assignees.slice(1).map((a) => a.userId)
  const nextStatus = installPlanStatusToTicket(ip.writeStatus, ip.replyStatus, !!ownerId)

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
      const reason = await tx.ticketPendingReason.findUnique({ where: { name: '외부 회신 대기' }, select: { id: true } })
      data.pendingReasonId = reason?.id ?? null
      data.pendingNote = '설치계획 회신 대기'
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

/** 티켓 전이/배정 → 설치계획 역동기화 */
export async function syncTicketToInstallPlan(tx: Prisma.TransactionClient, ticketId: number) {
  const ticket = await tx.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true, status: true, ownerId: true,
      participants: { select: { userId: true } },
      installPlan: { select: { id: true, writeStatus: true, replyStatus: true, replyDate: true } },
    },
  })
  if (!ticket?.installPlan) return
  const ip = ticket.installPlan

  const mapped = ticketStatusToInstallPlan(ticket.status)
  const data: Prisma.InstallPlanUncheckedUpdateInput = {}
  if (mapped.writeStatus !== ip.writeStatus) data.writeStatus = mapped.writeStatus
  if (mapped.replyStatus !== ip.replyStatus) data.replyStatus = mapped.replyStatus
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

// ── 답사 (P7 — 상태 5종, 역방향 손실 허용·도메인이 자기 상태의 원본) ──

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
  assigneeUserIds: string[]
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
  const queue = await tx.ticketQueue.findUnique({ where: { name: '설치·답사' }, select: { id: true } })
  if (!queue) throw new Error("티켓 큐 '설치·답사'가 없습니다. seed-ticket-masters.sql을 먼저 적용하세요.")
  const ctiId = await siteVisitCtiId(tx)

  const ownerId = s.assigneeUserIds[0] ?? null
  const participants = s.assigneeUserIds.slice(1)
  const status = siteVisitStatusToTicket(s.statusName, !!ownerId)

  let pendingReasonId: number | null = null
  let pendingNote: string | null = null
  if (status === 'PENDING') {
    const reasonName = s.statusName === '작성완료' ? '외부 회신 대기' : '기타'
    const reason = await tx.ticketPendingReason.findUnique({ where: { name: reasonName }, select: { id: true } })
    pendingReasonId = reason?.id ?? null
    pendingNote = s.statusName === '작성완료' ? '답사 회신 대기' : '답사 보류'
  }

  const ticketCode = await generateTicketCode(tx)
  const ticket = await tx.ticket.create({
    data: {
      ticketCode,
      title: `[답사] ${s.hospitalName ?? s.hospitalCode}`,
      status,
      severity: 'SEV4',
      queueId: queue.id,
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
      status: { select: { name: true } },
      assignees: { select: { userId: true }, orderBy: { id: 'asc' } },
    },
  })
  if (!s?.ticketId) return
  const ticket = await tx.ticket.findUnique({ where: { id: s.ticketId } })
  if (!ticket) return

  const ownerId = s.assignees[0]?.userId ?? null
  const participantIds = s.assignees.slice(1).map((a) => a.userId)
  const nextStatus = siteVisitStatusToTicket(s.status?.name ?? null, !!ownerId)

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
      const reasonName = s.status?.name === '작성완료' ? '외부 회신 대기' : '기타'
      const reason = await tx.ticketPendingReason.findUnique({ where: { name: reasonName }, select: { id: true } })
      data.pendingReasonId = reason?.id ?? null
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
      id: true, status: true, ownerId: true,
      participants: { select: { userId: true } },
      siteVisit: { select: { id: true, statusId: true, replyDate: true } },
    },
  })
  if (!ticket?.siteVisit) return
  const s = ticket.siteVisit

  const statusName = ticketStatusToSiteVisit(ticket.status)
  const statusCode = await tx.statusCode.findFirst({ where: { category: 'SITE_VISIT', name: statusName }, select: { id: true } })

  const data: Prisma.SiteVisitUncheckedUpdateInput = {}
  if (statusCode && statusCode.id !== s.statusId) {
    data.statusId = statusCode.id
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

// ── 기타업무 (P6 — 유지보수와 동일 상태 체계, 카테고리만 ETC_TASK_STATUS) ──

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
  hospitalCodes: string[] // 첫 병원 → ticket.hospitalCode (실측 복수 0건)
  assigneeUserIds: string[]
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
  const queue = await tx.ticketQueue.findUnique({ where: { name: '내부운영' }, select: { id: true } })
  if (!queue) throw new Error("티켓 큐 '내부운영'이 없습니다. seed-ticket-masters.sql을 먼저 적용하세요.")
  const ctiId = await etcTaskCtiId(tx)

  const ownerId = e.assigneeUserIds[0] ?? null
  const participants = e.assigneeUserIds.slice(1)
  const status = maintStatusToTicket(e.statusName, !!ownerId) // 상태 체계 동일 (접수/처리중/완료/보류)

  const ticketCode = await generateTicketCode(tx)
  const ticket = await tx.ticket.create({
    data: {
      ticketCode,
      title: e.title,
      status,
      severity: priorityToSeverity(e.priority),
      queueId: queue.id,
      ctiId,
      ownerId,
      hospitalCode: e.hospitalCodes[0] ?? null,
      refType: 'ETC',
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
      status: { select: { name: true } },
      hospitals: { select: { hospitalCode: true }, orderBy: { id: 'asc' } },
      assignees: { select: { userId: true }, orderBy: { id: 'asc' } },
    },
  })
  if (!e?.ticketId) return
  const ticket = await tx.ticket.findUnique({ where: { id: e.ticketId } })
  if (!ticket) return

  const ownerId = e.assignees[0]?.userId ?? null
  const participantIds = e.assignees.slice(1).map((a) => a.userId)
  const nextStatus = maintStatusToTicket(e.status?.name ?? null, !!ownerId)
  const nextSev = priorityToSeverity(e.priority)

  const data: Prisma.TicketUncheckedUpdateInput = { title: e.title, hospitalCode: e.hospitals[0]?.hospitalCode ?? null }
  if (nextStatus !== ticket.status) {
    data.status = nextStatus
    data.statusChangedAt = new Date()
    if (nextStatus === 'CLOSED') { data.resolvedAt = e.resolvedAt ?? new Date(); data.closedAt = e.resolvedAt ?? new Date() }
    else { data.resolvedAt = null; data.closedAt = null }
    if (nextStatus === 'PENDING') {
      const etcReason = await tx.ticketPendingReason.findUnique({ where: { name: '기타' }, select: { id: true } })
      data.pendingReasonId = etcReason?.id ?? null
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
      id: true, status: true, severity: true, ownerId: true,
      participants: { select: { userId: true } },
      etcTask: { select: { id: true, statusId: true, resolvedAt: true } },
    },
  })
  if (!ticket?.etcTask) return
  const e = ticket.etcTask

  const statusName = ticketStatusToMaint(ticket.status)
  const statusCode = await tx.statusCode.findFirst({ where: { category: 'ETC_TASK_STATUS', name: statusName }, select: { id: true } })

  const data: Prisma.EtcTaskUncheckedUpdateInput = { priority: severityToPriority(ticket.severity) }
  if (statusCode && statusCode.id !== e.statusId) {
    data.statusId = statusCode.id
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

/**
 * 티켓 전이/배정 → 유지보수 역동기화. 티켓 transition/assign 핸들러의 트랜잭션 안에서 호출.
 * (도메인 연결 티켓일 때만 — 호출부에서 refType 확인)
 */
export async function syncTicketToMaintenance(tx: Prisma.TransactionClient, ticketId: number) {
  const ticket = await tx.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true, status: true, severity: true, ownerId: true,
      participants: { select: { userId: true } },
      maintenance: { select: { id: true, statusId: true, resolvedAt: true } },
    },
  })
  if (!ticket?.maintenance) return
  const m = ticket.maintenance

  const statusName = ticketStatusToMaint(ticket.status)
  const statusCode = await tx.statusCode.findFirst({ where: { category: 'MAINTENANCE_STATUS', name: statusName }, select: { id: true } })

  const data: Prisma.MaintenanceUncheckedUpdateInput = { priority: severityToPriority(ticket.severity) }
  if (statusCode && statusCode.id !== m.statusId) {
    data.statusId = statusCode.id
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
