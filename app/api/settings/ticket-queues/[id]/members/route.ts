import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const members = await prisma.ticketQueueMember.findMany({
    where: { queueId: id },
    include: { user: { select: { id: true, name: true, isActive: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ members })
}

// 큐 멤버 전체 설정 — 기존 관례(delete-all → createMany)
export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const queue = await prisma.ticketQueue.findUnique({
    where: { id },
    include: { members: { select: { userId: true } } },
  })
  if (!queue) return NextResponse.json({ error: '큐를 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const userIds: string[] = Array.isArray(body.userIds)
    ? Array.from(new Set(body.userIds.filter((v: unknown): v is string => typeof v === 'string')))
    : []

  const beforeIds = queue.members.map((m) => m.userId).sort()

  await prisma.$transaction(async (tx) => {
    await tx.ticketQueueMember.deleteMany({ where: { queueId: id } })
    if (userIds.length) {
      await tx.ticketQueueMember.createMany({ data: userIds.map((userId) => ({ queueId: id, userId })) })
    }
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:ticket_queue',
    resourceId: id,
    resourceLabel: `${queue.name} 멤버 변경`,
    before: { members: beforeIds },
    after: { members: userIds },
  })

  return NextResponse.json({ ok: true })
}
