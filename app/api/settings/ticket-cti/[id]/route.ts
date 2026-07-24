import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

// 이름·기본 큐·정렬·활성만 수정 가능. 트리 이동(parent 변경)은 미지원 — 삭제 후 재생성.
export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const before = await prisma.ticketCti.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '분류를 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const data: { name?: string; defaultQueueId?: number | null; sortOrder?: number; isActive?: boolean } = {}

  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) return NextResponse.json({ error: '분류명을 입력하세요.' }, { status: 400 })
    const dup = await prisma.ticketCti.findFirst({ where: { parentId: before.parentId, name, id: { not: id } } })
    if (dup) return NextResponse.json({ error: '같은 상위 아래 동일한 분류명이 있습니다.' }, { status: 409 })
    data.name = name
  }
  if (body.defaultQueueId !== undefined) {
    if (body.defaultQueueId === null) data.defaultQueueId = null
    else if (typeof body.defaultQueueId === 'number') {
      const queue = await prisma.ticketQueue.findUnique({ where: { id: body.defaultQueueId } })
      if (!queue) return NextResponse.json({ error: '기본 큐를 찾을 수 없습니다.' }, { status: 400 })
      data.defaultQueueId = queue.id
    }
  }
  if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive

  const node = await prisma.ticketCti.update({ where: { id }, data })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:ticket_cti',
    resourceId: id,
    resourceLabel: `L${node.level} ${node.name}`,
    before,
    after: node,
  })

  return NextResponse.json({ node })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const before = await prisma.ticketCti.findUnique({
    where: { id },
    include: { _count: { select: { tickets: true, children: true } } },
  })
  if (!before) return NextResponse.json({ error: '분류를 찾을 수 없습니다.' }, { status: 404 })
  if (before._count.tickets > 0 || before._count.children > 0) {
    return NextResponse.json({ error: '하위 분류 또는 연결된 티켓이 있어 삭제할 수 없습니다. 비활성화하세요.' }, { status: 400 })
  }

  await prisma.ticketCti.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'setting:ticket_cti',
    resourceId: id,
    resourceLabel: `L${before.level} ${before.name}`,
    before,
  })

  return NextResponse.json({ ok: true })
}
