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

  const before = await prisma.ticketQueue.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '큐를 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const data: { name?: string; description?: string | null; sortOrder?: number; isActive?: boolean } = {}
  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) return NextResponse.json({ error: '큐 이름을 입력하세요.' }, { status: 400 })
    const dup = await prisma.ticketQueue.findFirst({ where: { name, id: { not: id } } })
    if (dup) return NextResponse.json({ error: '이미 존재하는 큐 이름입니다.' }, { status: 409 })
    data.name = name
  }
  if (body.description !== undefined) data.description = typeof body.description === 'string' ? body.description.trim() || null : null
  if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive

  const queue = await prisma.ticketQueue.update({ where: { id }, data })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:ticket_queue',
    resourceId: id,
    resourceLabel: queue.name,
    before,
    after: queue,
  })

  return NextResponse.json({ queue })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const before = await prisma.ticketQueue.findUnique({
    where: { id },
    include: { _count: { select: { tickets: true, ctiDefaults: true } } },
  })
  if (!before) return NextResponse.json({ error: '큐를 찾을 수 없습니다.' }, { status: 404 })
  if (before._count.tickets > 0) {
    return NextResponse.json({ error: '이 큐에 티켓이 있어 삭제할 수 없습니다. 비활성화하거나 티켓을 이관하세요.' }, { status: 400 })
  }

  await prisma.ticketQueue.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'setting:ticket_queue',
    resourceId: id,
    resourceLabel: before.name,
    before,
  })

  return NextResponse.json({ ok: true })
}
