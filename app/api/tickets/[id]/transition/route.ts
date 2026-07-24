import { NextRequest, NextResponse } from 'next/server'
import { Prisma, TicketStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { canTransition, addTicketEvent, TICKET_STATUS_LABELS } from '@/lib/ticket'
import { notifyTaskStatusChanged } from '@/lib/notify'
import { syncTicketToDomain, domainNotifyRef } from '@/lib/ticketDomain'

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

  // 도메인 연결 티켓은 도메인 알림이 대표 (이중 발송 방지 — P5 설계)
  const domainRef = await domainNotifyRef(id, ticket.refType)
  if (domainRef) notifyTaskStatusChanged({ ...domainRef, actorName: user.name }).catch(() => {})
  else notifyTaskStatusChanged({ taskType: 'TICKET', refCode: ticket.ticketCode, actorName: user.name }).catch(() => {})

  return NextResponse.json({ ticket: updated })
}
