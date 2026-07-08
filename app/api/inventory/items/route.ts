import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { nextItemCode, categoryPath, categoryWithDescendants } from '@/lib/inventory'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

const itemInclude = {
  category: { select: { id: true, name: true, parentId: true } },
  manufacturer: { select: { id: true, name: true } },
  deviceInfo: { select: { id: true, deviceName: true, deviceModel: true } },
} satisfies Prisma.InventoryItemInclude

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')?.trim() ?? ''
  const categoryId = searchParams.get('categoryId')
  const manufacturerId = searchParams.get('manufacturerId')
  const includeInactive = searchParams.get('includeInactive') === 'true'

  const allCategories = await prisma.inventoryCategory.findMany({
    select: { id: true, name: true, parentId: true, sortOrder: true },
  })

  // 분류 필터: 선택 노드 + 모든 후손 포함
  const categoryIds = categoryId ? categoryWithDescendants(allCategories, parseInt(categoryId)) : null

  const where: Prisma.InventoryItemWhereInput = {
    ...(includeInactive ? {} : { isActive: true }),
    ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
    ...(manufacturerId ? { manufacturerId: parseInt(manufacturerId) } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search } },
            { itemCode: { contains: search } },
            { spec: { contains: search } },
          ],
        }
      : {}),
  }

  const items = await prisma.inventoryItem.findMany({
    where,
    include: itemInclude,
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })

  return NextResponse.json({
    items: items.map((i) => ({ ...i, categoryPath: categoryPath(allCategories, i.categoryId) })),
  })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const name = body.name?.trim()
  if (!name) return NextResponse.json({ error: '품목명을 입력해주세요.' }, { status: 400 })

  const itemCode = await nextItemCode()

  const item = await prisma.inventoryItem.create({
    data: {
      itemCode,
      name,
      categoryId: body.categoryId ?? null,
      spec: body.spec?.trim() || null,
      unit: body.unit?.trim() || 'EA',
      isSerialManaged: !!body.isSerialManaged,
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
    action: 'CREATE',
    resource: 'inventory_item',
    resourceId: item.id,
    resourceLabel: `${item.itemCode} ${item.name}`,
    after: item,
  })

  return NextResponse.json({ item }, { status: 201 })
}
