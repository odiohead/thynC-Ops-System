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

  const { name, order } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: '제조사명을 입력해주세요.' }, { status: 400 })

  const duplicate = await prisma.statusCode.findFirst({
    where: { name: name.trim(), category: 'MANUFACTURER', id: { not: id } },
  })
  if (duplicate) return NextResponse.json({ error: '이미 존재하는 제조사입니다.' }, { status: 409 })

  const before = await prisma.statusCode.findUnique({ where: { id } })
  const statusCode = await prisma.statusCode.update({
    where: { id },
    data: { name: name.trim(), order },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:manufacturer',
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
  if (!sc || sc.category !== 'MANUFACTURER') {
    return NextResponse.json({ error: '제조사를 찾을 수 없습니다.' }, { status: 404 })
  }

  const usageCount = await prisma.inventoryItem.count({ where: { manufacturerId: id } })
  if (usageCount > 0) {
    return NextResponse.json({ error: `이 제조사를 사용하는 품목이 ${usageCount}건 있어 삭제할 수 없습니다.` }, { status: 409 })
  }

  await prisma.statusCode.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'setting:manufacturer',
    resourceId: id,
    resourceLabel: sc.name,
    before: sc,
  })

  return NextResponse.json({ success: true })
}
