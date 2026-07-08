import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const itemId = searchParams.get('itemId')
  const status = searchParams.get('status')
  const warehouseId = searchParams.get('warehouseId')
  const hospitalCode = searchParams.get('hospitalCode')
  const inventoryId = searchParams.get('inventoryId')

  const where: Prisma.InventoryUnitWhereInput = {
    ...(itemId ? { itemId: parseInt(itemId) } : {}),
    ...(status ? { status } : {}),
    ...(warehouseId ? { warehouseId: parseInt(warehouseId) } : {}),
    ...(hospitalCode ? { hospitalCode } : {}),
    ...(inventoryId ? { inventoryId: parseInt(inventoryId) } : {}),
  }

  const units = await prisma.inventoryUnit.findMany({
    where,
    include: {
      warehouse: { select: { id: true, name: true } },
      inventory: { select: { id: true, name: true } },
      hospital: { select: { hospitalCode: true, hospitalName: true } },
      item: { select: { id: true, itemCode: true, name: true } },
    },
    orderBy: [{ status: 'asc' }, { serialNo: 'asc' }],
  })

  return NextResponse.json({ units })
}
