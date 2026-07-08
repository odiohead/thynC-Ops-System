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

  const { name, memo, sortOrder, isActive } = await request.json()
  if (!name?.trim()) {
    return NextResponse.json({ error: '위치명을 입력해주세요.' }, { status: 400 })
  }

  const duplicate = await prisma.warehouse.findFirst({
    where: { name: name.trim(), id: { not: id } },
  })
  if (duplicate) {
    return NextResponse.json({ error: '이미 존재하는 위치명입니다.' }, { status: 409 })
  }

  const before = await prisma.warehouse.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '위치를 찾을 수 없습니다.' }, { status: 404 })

  const warehouse = await prisma.warehouse.update({
    where: { id },
    data: {
      name: name.trim(),
      memo: memo !== undefined ? (memo?.trim() || null) : undefined,
      sortOrder,
      isActive,
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:warehouse',
    resourceId: id,
    resourceLabel: warehouse.name,
    before,
    after: warehouse,
  })

  return NextResponse.json({ warehouse })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const wh = await prisma.warehouse.findUnique({ where: { id } })
  if (!wh) return NextResponse.json({ error: '위치를 찾을 수 없습니다.' }, { status: 404 })

  // 재고·전표 이력이 있는 위치는 삭제 대신 비활성화 (이력 보존 — function_wms.md §4-2)
  const [stockCnt, txCnt] = await Promise.all([
    prisma.inventoryStock.count({ where: { warehouseId: id, quantity: { gt: 0 } } }),
    prisma.inventoryTransaction.count({ where: { OR: [{ warehouseId: id }, { toWarehouseId: id }] } }),
  ])
  if (stockCnt > 0) {
    return NextResponse.json({ error: `이 위치에 재고가 남아 있어 삭제·비활성화할 수 없습니다. 먼저 재고를 이동하세요. (재고 행 ${stockCnt}건)` }, { status: 409 })
  }
  if (txCnt > 0) {
    const deactivated = await prisma.warehouse.update({ where: { id }, data: { isActive: false } })
    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'setting:warehouse',
      resourceId: id,
      resourceLabel: `${wh.name} (이력 보존 비활성화)`,
      before: wh,
      after: deactivated,
    })
    return NextResponse.json({ deactivated: true, message: `입출고 이력이 ${txCnt}건 있어 삭제 대신 비활성화했습니다.` })
  }

  await prisma.warehouse.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'setting:warehouse',
    resourceId: id,
    resourceLabel: wh.name,
    before: wh,
  })

  return NextResponse.json({ success: true })
}
