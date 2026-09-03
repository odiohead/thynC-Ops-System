import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

type Params = { params: { id: string } }

const ITEM_GROUPS = ['SYSTEM', 'WEARABLE'] as const

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const before = await prisma.stockOutItem.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 })

  const { name, itemGroup, sortOrder, isActive, wmsModelName } = await request.json()
  if (name !== undefined && !name?.trim()) return NextResponse.json({ error: '품목명을 입력해주세요.' }, { status: 400 })
  if (itemGroup !== undefined && !ITEM_GROUPS.includes(itemGroup)) return NextResponse.json({ error: '품목 그룹이 올바르지 않습니다.' }, { status: 400 })

  if (name !== undefined && name.trim() !== before.name) {
    const dup = await prisma.stockOutItem.findUnique({ where: { name: name.trim() } })
    if (dup) return NextResponse.json({ error: '이미 존재하는 품목명입니다.' }, { status: 409 })
  }

  const item = await prisma.stockOutItem.update({
    where: { id },
    data: {
      name: name !== undefined ? name.trim() : undefined,
      itemGroup: itemGroup !== undefined ? itemGroup : undefined,
      sortOrder: sortOrder !== undefined ? sortOrder : undefined,
      isActive: isActive !== undefined ? isActive : undefined,
      wmsModelName: wmsModelName !== undefined ? (typeof wmsModelName === 'string' && wmsModelName.trim() ? wmsModelName.trim() : null) : undefined,
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:stock_out_item',
    resourceId: id,
    resourceLabel: item.name,
    before,
    after: item,
  })

  return NextResponse.json({ item })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const item = await prisma.stockOutItem.findUnique({ where: { id } })
  if (!item) return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 })

  const inUse = await prisma.stockOutRequestItem.count({ where: { itemId: id } })
  if (inUse > 0) {
    return NextResponse.json({ error: `이 품목을 사용하는 출고요청 라인이 ${inUse}건 있어 삭제할 수 없습니다. 비활성으로 전환하세요.` }, { status: 409 })
  }

  await prisma.stockOutItem.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'setting:stock_out_item',
    resourceId: id,
    resourceLabel: item.name,
    before: item,
  })

  return NextResponse.json({ success: true })
}
