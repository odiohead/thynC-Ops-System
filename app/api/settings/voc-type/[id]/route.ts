import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

type Params = { params: { id: string } }

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const { name, order, color } = await request.json()

  if (!name?.trim()) {
    return NextResponse.json({ error: 'VOC 분류명을 입력해주세요.' }, { status: 400 })
  }

  const duplicate = await prisma.statusCode.findFirst({
    where: { name: name.trim(), category: 'VOC_TYPE', id: { not: id } },
  })
  if (duplicate) {
    return NextResponse.json({ error: '이미 존재하는 VOC 분류명입니다.' }, { status: 409 })
  }

  const before = await prisma.statusCode.findUnique({ where: { id } })
  if (!before || before.category !== 'VOC_TYPE') {
    return NextResponse.json({ error: 'VOC 분류을 찾을 수 없습니다.' }, { status: 404 })
  }

  const statusCode = await prisma.statusCode.update({
    where: { id },
    data: { name: name.trim(), order, color: color !== undefined ? (color || null) : undefined },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:voc_type',
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
  if (!sc || sc.category !== 'VOC_TYPE') {
    return NextResponse.json({ error: 'VOC 분류을 찾을 수 없습니다.' }, { status: 404 })
  }

  const inUse = await prisma.vocReceipt.count({ where: { vocTypeId: id } })
  if (inUse > 0) {
    return NextResponse.json({ error: `이 분류를 사용하는 VOC 접수가 ${inUse}건 있어 삭제할 수 없습니다.` }, { status: 409 })
  }

  await prisma.statusCode.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'setting:voc_type',
    resourceId: id,
    resourceLabel: sc.name,
    before: sc,
  })

  return NextResponse.json({ success: true })
}
