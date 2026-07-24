import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const before = await prisma.ticketPendingReason.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '대기 사유를 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const data: { name?: string; sortOrder?: number; isActive?: boolean } = {}
  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) return NextResponse.json({ error: '대기 사유명을 입력하세요.' }, { status: 400 })
    const dup = await prisma.ticketPendingReason.findFirst({ where: { name, id: { not: id } } })
    if (dup) return NextResponse.json({ error: '이미 존재하는 대기 사유입니다.' }, { status: 409 })
    data.name = name
  }
  if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive

  const reason = await prisma.ticketPendingReason.update({ where: { id }, data })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:ticket_pending_reason',
    resourceId: id,
    resourceLabel: reason.name,
    before,
    after: reason,
  })

  return NextResponse.json({ reason })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const before = await prisma.ticketPendingReason.findUnique({
    where: { id },
    include: { _count: { select: { tickets: true } } },
  })
  if (!before) return NextResponse.json({ error: '대기 사유를 찾을 수 없습니다.' }, { status: 404 })
  if (before._count.tickets > 0) {
    return NextResponse.json({ error: '이 사유를 사용하는 티켓이 있어 삭제할 수 없습니다. 비활성화하세요.' }, { status: 400 })
  }

  await prisma.ticketPendingReason.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'setting:ticket_pending_reason',
    resourceId: id,
    resourceLabel: before.name,
    before,
  })

  return NextResponse.json({ ok: true })
}
