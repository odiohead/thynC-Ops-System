import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { addTicketEvent } from '@/lib/ticket'
import { notifyTicketChanged } from '@/lib/notify'
import { syncTicketToDomain } from '@/lib/ticketDomain'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

// owner 배정/해제 + 상태 자동 연동: 배정 시 OPEN→ASSIGNED, 해제 시 ASSIGNED→OPEN
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const ticket = await prisma.ticket.findUnique({ where: { id } })
  if (!ticket) return NextResponse.json({ error: '티켓을 찾을 수 없습니다.' }, { status: 404 })
  if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
    return NextResponse.json({ error: '해결/종결된 티켓은 배정을 변경할 수 없습니다.' }, { status: 400 })
  }

  const body = await request.json()
  const ownerId: string | null = typeof body.ownerId === 'string' && body.ownerId ? body.ownerId : null

  if (ownerId) {
    const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true, isActive: true } })
    if (!owner || !owner.isActive) return NextResponse.json({ error: '유효하지 않은 사용자입니다.' }, { status: 400 })
  } else if (ticket.status !== 'OPEN' && ticket.status !== 'ASSIGNED') {
    // IN_PROGRESS/PENDING에서는 owner 해제 불가 — 상태를 먼저 되돌려야 함
    return NextResponse.json({ error: '진행/대기 중 티켓은 담당자를 해제할 수 없습니다. 상태를 먼저 변경하세요.' }, { status: 400 })
  }

  if (ownerId === ticket.ownerId) return NextResponse.json({ ticket })

  const nextStatus =
    ownerId && ticket.status === 'OPEN' ? 'ASSIGNED'
    : !ownerId && ticket.status === 'ASSIGNED' ? 'OPEN'
    : ticket.status

  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.ticket.update({
      where: { id },
      data: {
        ownerId,
        ...(nextStatus !== ticket.status ? { status: nextStatus, statusChangedAt: new Date() } : {}),
      },
    })
    await addTicketEvent(tx, id, 'assign', user.userId, { from: ticket.ownerId, to: ownerId })
    if (nextStatus !== ticket.status) {
      await addTicketEvent(tx, id, 'status_change', user.userId, { from: ticket.status, to: nextStatus, auto: true })
    }
    await syncTicketToDomain(tx, id, ticket.refType)
    return t
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'ticket',
    resourceId: id,
    resourceLabel: `${ticket.ticketCode} 배정 변경`,
    before: ticket,
    after: updated,
  })

  // P11: 단일 파이프라인 — owner 변경(배정 DM)·자동 상태 전이(채널)를 sig 비교로 처리
  notifyTicketChanged({ ticketId: id, actorName: user.name }).catch(() => {})

  return NextResponse.json({ ticket: updated })
}
