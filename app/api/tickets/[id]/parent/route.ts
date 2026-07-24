import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { addTicketEvent } from '@/lib/ticket'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

// 마스터-서브 연결/해제 — 2레벨 고정 (§2.1 보강)
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { _count: { select: { children: true } } },
  })
  if (!ticket) return NextResponse.json({ error: '티켓을 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const parentId: number | null = typeof body.parentId === 'number' ? body.parentId : null

  if (parentId === ticket.parentId) return NextResponse.json({ ticket })

  let parentCode: string | null = null
  if (parentId) {
    if (parentId === id) return NextResponse.json({ error: '자기 자신을 마스터로 지정할 수 없습니다.' }, { status: 400 })
    if (ticket._count.children > 0) {
      return NextResponse.json({ error: '서브 티켓을 가진 마스터 티켓은 다른 티켓의 서브가 될 수 없습니다.' }, { status: 400 })
    }
    const parent = await prisma.ticket.findUnique({ where: { id: parentId } })
    if (!parent) return NextResponse.json({ error: '마스터 티켓을 찾을 수 없습니다.' }, { status: 404 })
    if (parent.parentId) {
      return NextResponse.json({ error: '서브 티켓 아래에는 서브를 둘 수 없습니다 (2레벨 고정).' }, { status: 400 })
    }
    if (parent.status === 'CLOSED') {
      return NextResponse.json({ error: '종결된 티켓의 서브로 연결할 수 없습니다.' }, { status: 400 })
    }
    parentCode = parent.ticketCode
  }

  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.ticket.update({ where: { id }, data: { parentId } })
    if (parentId) {
      await addTicketEvent(tx, id, 'link', user.userId, { event: 'parent_set', parentId, parentCode })
      await addTicketEvent(tx, parentId, 'link', user.userId, { event: 'child_added', childId: id, childCode: ticket.ticketCode })
    } else if (ticket.parentId) {
      await addTicketEvent(tx, id, 'link', user.userId, { event: 'parent_unset', parentId: ticket.parentId })
      await addTicketEvent(tx, ticket.parentId, 'link', user.userId, { event: 'child_removed', childId: id, childCode: ticket.ticketCode })
    }
    return t
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'ticket',
    resourceId: id,
    resourceLabel: `${ticket.ticketCode} 마스터 ${parentCode ?? '해제'}`,
    before: ticket,
    after: updated,
  })

  return NextResponse.json({ ticket: updated })
}
