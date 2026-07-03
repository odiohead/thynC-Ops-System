import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

type Params = { params: { id: string } }

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const { name, order, color } = await request.json()

  if (!name?.trim()) {
    return NextResponse.json({ error: '기타업무 상태명을 입력해주세요.' }, { status: 400 })
  }

  const duplicate = await prisma.statusCode.findFirst({
    where: { name: name.trim(), category: 'ETC_TASK_STATUS', id: { not: id } },
  })
  if (duplicate) {
    return NextResponse.json({ error: '이미 존재하는 기타업무 상태명입니다.' }, { status: 409 })
  }

  const before = await prisma.statusCode.findUnique({ where: { id } })

  const statusCode = await prisma.statusCode.update({
    where: { id },
    data: { name: name.trim(), order, color: color !== undefined ? (color || null) : undefined },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:etc_task_status',
    resourceId: id,
    resourceLabel: statusCode.name,
    before,
    after: statusCode,
  })

  return NextResponse.json({ statusCode })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const sc = await prisma.statusCode.findUnique({ where: { id } })
  if (!sc || sc.category !== 'ETC_TASK_STATUS') {
    return NextResponse.json({ error: '기타업무 상태를 찾을 수 없습니다.' }, { status: 404 })
  }

  await prisma.statusCode.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'setting:etc_task_status',
    resourceId: id,
    resourceLabel: sc.name,
    before: sc,
  })

  return NextResponse.json({ success: true })
}
