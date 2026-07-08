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

  const { name, sortOrder } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: '분류명을 입력해주세요.' }, { status: 400 })

  const before = await prisma.inventoryCategory.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '분류를 찾을 수 없습니다.' }, { status: 404 })

  const dup = await prisma.inventoryCategory.findFirst({
    where: { parentId: before.parentId, name: name.trim(), id: { not: id } },
  })
  if (dup) return NextResponse.json({ error: '같은 상위 분류 아래에 이미 있는 이름입니다.' }, { status: 409 })

  const category = await prisma.inventoryCategory.update({
    where: { id },
    data: { name: name.trim(), sortOrder: sortOrder ?? undefined },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:item_category',
    resourceId: id,
    resourceLabel: category.name,
    before,
    after: category,
  })

  return NextResponse.json({ category })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const category = await prisma.inventoryCategory.findUnique({
    where: { id },
    include: { _count: { select: { items: true, children: true } } },
  })
  if (!category) return NextResponse.json({ error: '분류를 찾을 수 없습니다.' }, { status: 404 })

  if (category._count.children > 0) {
    return NextResponse.json({ error: `하위 분류가 ${category._count.children}개 있어 삭제할 수 없습니다. 하위 분류를 먼저 삭제하세요.` }, { status: 409 })
  }
  if (category._count.items > 0) {
    return NextResponse.json({ error: `이 분류를 사용하는 품목이 ${category._count.items}건 있어 삭제할 수 없습니다. 먼저 품목의 분류를 변경하세요.` }, { status: 409 })
  }

  await prisma.inventoryCategory.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'setting:item_category',
    resourceId: id,
    resourceLabel: category.name,
    before: category,
  })

  return NextResponse.json({ success: true })
}
