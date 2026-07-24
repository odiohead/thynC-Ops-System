import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { addTicketEvent } from '@/lib/ticket'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

// 큐 이관 (transfer)
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const ticket = await prisma.ticket.findUnique({ where: { id } })
  if (!ticket) return NextResponse.json({ error: '티켓을 찾을 수 없습니다.' }, { status: 404 })
  if (ticket.status === 'CLOSED') return NextResponse.json({ error: '종결된 티켓은 이관할 수 없습니다.' }, { status: 400 })

  const body = await request.json()
  const queueId = typeof body.queueId === 'number' ? body.queueId : null
  if (!queueId) return NextResponse.json({ error: '큐를 선택하세요.' }, { status: 400 })
  if (queueId === ticket.queueId) return NextResponse.json({ ticket })

  const queue = await prisma.ticketQueue.findUnique({ where: { id: queueId } })
  if (!queue || !queue.isActive) return NextResponse.json({ error: '유효하지 않은 큐입니다.' }, { status: 400 })

  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.ticket.update({ where: { id }, data: { queueId } })
    await addTicketEvent(tx, id, 'queue_transfer', user.userId, { from: ticket.queueId, to: queueId })
    return t
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'ticket',
    resourceId: id,
    resourceLabel: `${ticket.ticketCode} 큐 이관 → ${queue.name}`,
    before: ticket,
    after: updated,
  })

  return NextResponse.json({ ticket: updated })
}
