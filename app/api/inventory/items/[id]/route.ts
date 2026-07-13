import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { categoryPath } from '@/lib/inventory'
import { Prisma } from '@prisma/client'

type Params = { params: { id: string } }

const itemInclude = {
  category: { select: { id: true, name: true, parentId: true } },
  manufacturer: { select: { id: true, name: true } },
  deviceInfo: { select: { id: true, deviceName: true, deviceModel: true } },
} satisfies Prisma.InventoryItemInclude

export async function GET(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const [item, allCategories] = await Promise.all([
    prisma.inventoryItem.findUnique({
      where: { id },
      include: {
        ...itemInclude,
        stocks: {
          include: {
            warehouse: { select: { id: true, name: true, isActive: true } },
            inventory: { select: { id: true, name: true } },
          },
        },
        components: {
          include: { child: { select: { id: true, itemCode: true, name: true, unit: true, isSerialManaged: true } } },
          orderBy: [{ sortOrder: 'asc' }, { childItemId: 'asc' }],
        },
        usedIn: {
          include: { parent: { select: { id: true, itemCode: true, name: true } } },
        },
      },
    }),
    prisma.inventoryCategory.findMany({ select: { id: true, name: true, parentId: true, sortOrder: true } }),
  ])
  if (!item) return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 })

  const total = item.stocks.reduce((s, x) => s + x.quantity, 0)
  return NextResponse.json({
    item: { ...item, categoryPath: categoryPath(allCategories, item.categoryId) },
    total,
  })
}

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const before = await prisma.inventoryItem.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 })

  const body = await req.json()
  const name = body.name?.trim()
  if (!name) return NextResponse.json({ error: '품목명을 입력해주세요.' }, { status: 400 })

  // 시리얼 관리 여부는 재고 이력이 생기면 변경 금지 — 수량↔개체 정합이 깨짐 (function_wms.md §4-1)
  const wantSerial = !!body.isSerialManaged
  if (wantSerial !== before.isSerialManaged) {
    const txCount = await prisma.inventoryTransaction.count({ where: { itemId: id } })
    if (txCount > 0) {
      return NextResponse.json({ error: `입출고 이력이 ${txCount}건 있어 시리얼 관리 여부를 변경할 수 없습니다.` }, { status: 409 })
    }
  }

  const item = await prisma.inventoryItem.update({
    where: { id },
    data: {
      name,
      modelName: body.modelName?.trim() || null,
      categoryId: body.categoryId ?? null,
      spec: body.spec?.trim() || null,
      unit: body.unit?.trim() || 'EA',
      isSerialManaged: wantSerial,
      deviceInfoId: body.deviceInfoId ?? null,
      manufacturerId: body.manufacturerId ?? null,
      refPrice: typeof body.refPrice === 'number' ? body.refPrice : null,
      memo: body.memo?.trim() || null,
      isActive: body.isActive ?? true,
      sortOrder: body.sortOrder ?? 0,
    },
    include: itemInclude,
  })

  await logAudit({
    req,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'inventory_item',
    resourceId: id,
    resourceLabel: `${item.itemCode} ${item.name}`,
    before,
    after: item,
  })

  return NextResponse.json({ item })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const item = await prisma.inventoryItem.findUnique({ where: { id } })
  if (!item) return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 })

  // 입출고 이력이 있는 품목은 삭제 대신 비활성화 (Vehicle 패턴 — 이력 보존)
  const txCount = await prisma.inventoryTransaction.count({ where: { itemId: id } })
  if (txCount > 0) {
    const deactivated = await prisma.inventoryItem.update({ where: { id }, data: { isActive: false } })
    await logAudit({
      req,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'inventory_item',
      resourceId: id,
      resourceLabel: `${item.itemCode} ${item.name} (이력 보존 비활성화)`,
      before: item,
      after: deactivated,
    })
    return NextResponse.json({
      deactivated: true,
      message: `입출고 이력이 ${txCount}건 있어 삭제 대신 비활성화했습니다.`,
    })
  }

  await prisma.inventoryItem.delete({ where: { id } })

  await logAudit({
    req,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'inventory_item',
    resourceId: id,
    resourceLabel: `${item.itemCode} ${item.name}`,
    before: item,
  })

  return NextResponse.json({ success: true })
}
