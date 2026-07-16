import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { categoryPath, categoryWithDescendants } from '@/lib/inventory'
import { Prisma } from '@prisma/client'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

/** 재고 현황 Excel export — 현황 화면과 동일한 필터(search/categoryId/warehouseId/inventoryId) 적용, 버킷 단위 1행 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')?.trim() ?? ''
  const categoryId = searchParams.get('categoryId')
  const warehouseId = searchParams.get('warehouseId')
  const inventoryId = searchParams.get('inventoryId')

  const allCategories = await prisma.inventoryCategory.findMany({
    select: { id: true, name: true, parentId: true, sortOrder: true },
  })
  const categoryIds = categoryId ? categoryWithDescendants(allCategories, parseInt(categoryId)) : null

  const itemWhere: Prisma.InventoryItemWhereInput = {
    isActive: true,
    ...(inventoryId ? { inventoryId: parseInt(inventoryId) } : {}), // 품목 소속 인벤토리 필터
    ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
    ...(search
      ? { OR: [{ name: { contains: search } }, { itemCode: { contains: search } }, { modelName: { contains: search } }, { spec: { contains: search } }] }
      : {}),
  }

  const stocks = await prisma.inventoryStock.findMany({
    where: {
      quantity: { gt: 0 },
      ...(warehouseId ? { warehouseId: parseInt(warehouseId) } : {}),
      item: itemWhere,
    },
    include: {
      item: {
        select: { itemCode: true, name: true, modelName: true, spec: true, unit: true, isSerialManaged: true, categoryId: true, manufacturer: { select: { name: true } } },
      },
      warehouse: { select: { name: true } },
      inventory: { select: { name: true } },
    },
    orderBy: [{ inventoryId: 'asc' }, { itemId: 'asc' }, { warehouseId: 'asc' }],
  })

  const rows = stocks.map((s) => ({
    인벤토리: s.inventory.name,
    품목코드: s.item.itemCode,
    품목명: s.item.name,
    모델명: s.item.modelName ?? '',
    분류: categoryPath(allCategories, s.item.categoryId),
    제조사: s.item.manufacturer?.name ?? '',
    규격: s.item.spec ?? '',
    단위: s.item.unit,
    시리얼관리: s.item.isSerialManaged ? 'Y' : '',
    위치: s.warehouse.name,
    수량: s.quantity,
  }))

  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 24 }, { wch: 20 }, { wch: 12 }, { wch: 20 }, { wch: 6 }, { wch: 8 }, { wch: 14 }, { wch: 8 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '재고현황')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const filename = encodeURIComponent(`재고현황_${ymd}.xlsx`)
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
    },
  })
}
