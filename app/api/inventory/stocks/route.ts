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

  // 버킷 모드: 전표 모달용 — 특정 품목(·위치)의 (위치, 인벤토리)별 가용 재고
  const itemIdParam = searchParams.get('itemId')
  if (itemIdParam) {
    const whParam = searchParams.get('warehouseId')
    const invParam = searchParams.get('inventoryId')
    const buckets = await prisma.inventoryStock.findMany({
      where: {
        itemId: parseInt(itemIdParam),
        ...(whParam ? { warehouseId: parseInt(whParam) } : {}),
        ...(invParam ? { inventoryId: parseInt(invParam) } : {}),
        quantity: { gt: 0 },
      },
      include: {
        inventory: { select: { id: true, name: true, isTransferLocked: true } },
        warehouse: { select: { id: true, name: true } },
      },
      orderBy: [{ inventoryId: 'asc' }, { warehouseId: 'asc' }],
    })
    return NextResponse.json({
      buckets: buckets.map((b) => ({
        warehouseId: b.warehouseId,
        warehouseName: b.warehouse.name,
        inventoryId: b.inventoryId,
        inventoryName: b.inventory.name,
        isTransferLocked: b.inventory.isTransferLocked,
        quantity: b.quantity,
      })),
    })
  }

  const search = searchParams.get('search')?.trim() ?? ''
  const categoryId = searchParams.get('categoryId')
  const warehouseId = searchParams.get('warehouseId')
  const inventoryId = searchParams.get('inventoryId')
  const includeInactive = searchParams.get('includeInactive') === 'true'

  const allCategories = await prisma.inventoryCategory.findMany({
    select: { id: true, name: true, parentId: true, sortOrder: true },
  })
  const categoryIds = categoryId ? categoryWithDescendants(allCategories, parseInt(categoryId)) : null

  const where: Prisma.InventoryItemWhereInput = {
    ...(includeInactive ? {} : { isActive: true }),
    ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
    ...(search
      ? { OR: [{ name: { contains: search } }, { itemCode: { contains: search } }, { modelName: { contains: search } }, { spec: { contains: search } }] }
      : {}),
  }

  const items = await prisma.inventoryItem.findMany({
    where,
    include: {
      category: { select: { id: true, name: true } },
      manufacturer: { select: { id: true, name: true } },
      deviceInfo: { select: { deviceModel: true } },
      stocks: {
        include: {
          warehouse: { select: { id: true, name: true, isActive: true } },
          inventory: { select: { id: true, name: true } },
        },
      },
      components: { select: { childItemId: true } },
      usedIn: { select: { parentItemId: true } },
    },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })

  const whFilter = warehouseId ? parseInt(warehouseId) : null
  const invFilter = inventoryId ? parseInt(inventoryId) : null

  const rows = items.map((item) => {
    const stocks = item.stocks
      .filter((s) => s.quantity > 0)
      .filter((s) => (invFilter ? s.inventoryId === invFilter : true))
      .map((s) => ({
        warehouseId: s.warehouseId,
        warehouseName: s.warehouse.name,
        inventoryId: s.inventoryId,
        inventoryName: s.inventory.name,
        quantity: s.quantity,
      }))
      .sort((a, b) => b.quantity - a.quantity)
    // 총재고: 인벤토리 탭 선택 시 그 인벤토리 합계, 전체 탭이면 전체 합계
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
