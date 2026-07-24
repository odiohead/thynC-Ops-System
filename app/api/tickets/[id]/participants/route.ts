import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { addTicketEvent } from '@/lib/ticket'
import { syncTicketToDomain } from '@/lib/ticketDomain'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

// 참여자 전체 설정 — 기존 관례(delete-all → createMany)
export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { participants: { select: { userId: true } } },
  })
  if (!ticket) return NextResponse.json({ error: '티켓을 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const userIds: string[] = Array.isArray(body.userIds)
    ? Array.from(new Set(body.userIds.filter((v: unknown): v is string => typeof v === 'string')))
    : []

  const beforeIds = ticket.participants.map((p) => p.userId).sort()
  if (JSON.stringify(beforeIds) === JSON.stringify([...userIds].sort())) {
    return NextResponse.json({ ok: true })
  }

  await prisma.$transaction(async (tx) => {
    await tx.ticketParticipant.deleteMany({ where: { ticketId: id } })
    if (userIds.length) {
      await tx.ticketParticipant.createMany({ data: userIds.map((userId) => ({ ticketId: id, userId })) })
    }
    await addTicketEvent(tx, id, 'system', user.userId, { event: 'participants_set', from: beforeIds, to: userIds })
    await syncTicketToDomain(tx, id, ticket.refType)
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'ticket',
    resourceId: id,
    resourceLabel: `${ticket.ticketCode} 참여자 변경`,
    before: { participants: beforeIds },
    after: { participants: userIds },
  })

  return NextResponse.json({ ok: true })
}
