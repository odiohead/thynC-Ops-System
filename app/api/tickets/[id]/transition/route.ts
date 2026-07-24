import { NextRequest, NextResponse } from 'next/server'
import { Prisma, TicketStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { canTransition, addTicketEvent, TICKET_STATUS_LABELS } from '@/lib/ticket'
import { notifyTicketChanged } from '@/lib/notify'
import { syncTicketToDomain } from '@/lib/ticketDomain'
import { advanceHospitalStatus } from '@/lib/hospitalStatus'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const ticket = await prisma.ticket.findUnique({ where: { id } })
  if (!ticket) return NextResponse.json({ error: '티켓을 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const to = typeof body.to === 'string' ? body.to : ''
  if (!(to in TicketStatus)) return NextResponse.json({ error: '잘못된 상태값입니다.' }, { status: 400 })
  const target = to as TicketStatus

  // 전이표 강제 — 허용되지 않은 전이는 400
  if (!canTransition(ticket.status, target)) {
    return NextResponse.json(
      { error: `'${TICKET_STATUS_LABELS[ticket.status]}' 상태에서 '${TICKET_STATUS_LABELS[target]}'(으)로 전이할 수 없습니다.` },
      { status: 400 }
    )
  }

  // 부속 규칙
  if ((target === 'ASSIGNED' || target === 'IN_PROGRESS') && !ticket.ownerId) {
    return NextResponse.json({ error: '담당자(owner) 배정이 필요한 상태입니다. 먼저 배정하세요.' }, { status: 400 })
  }

  // 마스터 티켓은 열린 서브가 있으면 해결/종결 불가 (§2.1 보강 — AWS 관례)
  if (target === 'RESOLVED' || target === 'CLOSED') {
    const openChildren = await prisma.ticket.count({
      where: { parentId: id, status: { notIn: ['RESOLVED', 'CLOSED'] } },
    })
    if (openChildren > 0) {
      return NextResponse.json(
        { error: `열린 서브 티켓이 ${openChildren}건 있습니다. 서브 티켓을 먼저 해결하세요.` },
        { status: 400 }
      )
    }
  }

  const data: Prisma.TicketUncheckedUpdateInput = {
    status: target,
    statusChangedAt: new Date(),
  }

  let pendingReasonName: string | null = null
  if (target === 'PENDING') {
    const pendingReasonId = typeof body.pendingReasonId === 'number' ? body.pendingReasonId : null
    if (!pendingReasonId) return NextResponse.json({ error: '대기(PENDING) 사유를 선택하세요.' }, { status: 400 })
    const reason = await prisma.ticketPendingReason.findUnique({ where: { id: pendingReasonId } })
    if (!reason || !reason.isActive) return NextResponse.json({ error: '유효하지 않은 대기 사유입니다.' }, { status: 400 })
    data.pendingReasonId = pendingReasonId
    data.pendingNote = typeof body.pendingNote === 'string' ? body.pendingNote.trim() || null : null
    pendingReasonName = reason.name
  } else if (ticket.status === 'PENDING') {
    data.pendingReasonId = null
    data.pendingNote = null
  }

  if (target === 'RESOLVED') data.resolvedAt = new Date()
  if (target === 'CLOSED') data.closedAt = new Date()
  if (ticket.status === 'RESOLVED' && target === 'IN_PROGRESS') {
    // 재오픈
    data.reopenCount = { increment: 1 }
    data.resolvedAt = null
  }

  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.ticket.update({ where: { id }, data })
    await addTicketEvent(tx, id, 'status_change', user.userId, {
      from: ticket.status,
      to: target,
      ...(pendingReasonName ? { pendingReason: pendingReasonName, pendingNote: data.pendingNote ?? null } : {}),
      ...(ticket.status === 'RESOLVED' && target === 'IN_PROGRESS' ? { reopen: true } : {}),
    })
    await syncTicketToDomain(tx, id, ticket.refType)
    return t
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'ticket',
    resourceId: id,
    resourceLabel: `${ticket.ticketCode} 상태 ${ticket.status}→${target}`,
    before: ticket,
    after: updated,
  })

  // P13: 프로젝트 티켓이 티켓 경로로 구축완료(해결/종결 → BuildStatus '완료' 동기화)되면
  // 병원 상태 '운영' 전진 — 도메인 PUT 경로의 훅과 동일 규칙 (P9 한계 해소, best-effort)
  if (ticket.refType === 'PROJECT' && (target === 'RESOLVED' || target === 'CLOSED') && ticket.hospitalCode) {
    await advanceHospitalStatus({
      hospitalCode: ticket.hospitalCode,
      targetStatus: '운영',
      req: request,
      actor: auditActorFromJWT(user),
      source: '티켓 전이(프로젝트 구축완료)',
    })
  }

  // P11: 티켓 이벤트 단일 파이프라인 — sig 비교로 실변경만 발송
  notifyTicketChanged({ ticketId: id, actorName: user.name }).catch(() => {})

  return NextResponse.json({ ticket: updated })
}
