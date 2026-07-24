import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function GET() {
  const queues = await prisma.ticketQueue.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: {
      _count: { select: { tickets: true } },
      members: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
    },
  })
  return NextResponse.json({ queues })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: '큐 이름을 입력하세요.' }, { status: 400 })

  const existing = await prisma.ticketQueue.findUnique({ where: { name } })
  if (existing) return NextResponse.json({ error: '이미 존재하는 큐 이름입니다.' }, { status: 409 })

  const queue = await prisma.ticketQueue.create({
    data: {
      name,
      description: typeof body.description === 'string' ? body.description.trim() || null : null,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : 0,
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:ticket_queue',
    resourceId: queue.id,
    resourceLabel: queue.name,
    after: queue,
  })

  return NextResponse.json({ queue }, { status: 201 })
}
