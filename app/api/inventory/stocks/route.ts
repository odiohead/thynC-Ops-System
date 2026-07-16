import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { categoryPath, categoryWithDescendants } from '@/lib/inventory'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)

  // 버킷 모드: 전표 모달용 — 특정 품목의 위치별 가용 재고 (품목이 인벤토리에 귀속되어 인벤토리 축은 불필요)
  const itemIdParam = searchParams.get('itemId')
  if (itemIdParam) {
    const whParam = searchParams.get('warehouseId')
    const buckets = await prisma.inventoryStock.findMany({
      where: {
        itemId: parseInt(itemIdParam),
        ...(whParam ? { warehouseId: parseInt(whParam) } : {}),
        quantity: { gt: 0 },
      },
      include: {
        warehouse: { select: { id: true, name: true } },
      },
      orderBy: [{ warehouseId: 'asc' }],
    })
    return NextResponse.json({
      buckets: buckets.map((b) => ({
        warehouseId: b.warehouseId,
        warehouseName: b.warehouse.name,
        quantity: b.quantity,
      })),
    })
  }

  const search = searchParams.get('search')?.trim() ?? ''
  const categoryId = searchParams.get('categoryId')
  const warehouseId = searchParams.get('warehouseId')
  const inventoryId = searchParams.get('inventoryId') // 품목 소속 인벤토리 필터
  const includeInactive = searchParams.get('includeInactive') === 'true'

  const allCategories = await prisma.inventoryCategory.findMany({
    select: { id: true, name: true, parentId: true, sortOrder: true },
  })
  const categoryIds = categoryId ? categoryWithDescendants(allCategories, parseInt(categoryId)) : null

  const where: Prisma.InventoryItemWhereInput = {
    ...(includeInactive ? {} : { isActive: true }),
    ...(inventoryId ? { inventoryId: parseInt(inventoryId) } : {}),
    ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
    ...(search
      ? { OR: [{ name: { contains: search } }, { itemCode: { contains: search } }, { modelName: { contains: search } }, { spec: { contains: search } }] }
      : {}),
  }

  const items = await prisma.inventoryItem.findMany({
    where,
    include: {
      inventory: { select: { id: true, name: true, linkHospital: true, isActive: true, sortOrder: true } },
      category: { select: { id: true, name: true } },
      manufacturer: { select: { id: true, name: true } },
      deviceInfo: { select: { deviceModel: true } },
      stocks: {
        include: {
          warehouse: { select: { id: true, name: true, isActive: true } },
        },
      },
      components: { select: { childItemId: true } },
      usedIn: { select: { parentItemId: true } },
    },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })

  const whFilter = warehouseId ? parseInt(warehouseId) : null

  const rows = items.map((item) => {
    const stocks = item.stocks
      .filter((s) => s.quantity > 0)
      .map((s) => ({
        warehouseId: s.warehouseId,
        warehouseName: s.warehouse.name,
        quantity: s.quantity,
      }))
      .sort((a, b) => b.quantity - a.quantity)
    const total = stocks.reduce((sum, s) => sum + s.quantity, 0)
    return {
      id: item.id,
      itemCode: item.itemCode,
      name: item.name,
      modelName: item.modelName,
      spec: item.spec,
      unit: item.unit,
      isSerialManaged: item.isSerialManaged,
      isActive: item.isActive,
      inventoryId: item.inventoryId,
      inventory: item.inventory,
      category: item.category,
      categoryPath: categoryPath(allCategories, item.categoryId),
      manufacturer: item.manufacturer,
      deviceModel: item.deviceInfo?.deviceModel ?? null,
      componentCount: item.components.length, // 주자재 여부 (부자재 수)
      isComponent: item.usedIn.length > 0, // 부자재 여부
      stocks,
      total,
    }
  })

  const filtered = rows.filter((r) => (whFilter ? r.stocks.some((s) => s.warehouseId === whFilter) : true))

  return NextResponse.json({ items: filtered })
}
