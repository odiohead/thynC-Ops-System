import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const activeOnly = searchParams.get('activeOnly') === 'true'
  const inventoryId = searchParams.get('inventoryId') // 인벤토리별 위치 조회

  const warehouses = await prisma.warehouse.findMany({
    where: {
      ...(activeOnly ? { isActive: true } : {}),
      ...(inventoryId ? { inventoryId: parseInt(inventoryId) } : {}),
    },
    orderBy: [{ inventoryId: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
  })
  return NextResponse.json({ warehouses })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, memo, sortOrder, isActive, inventoryId: invIdRaw } = await request.json()
  if (!name?.trim()) {
    return NextResponse.json({ error: '위치명을 입력해주세요.' }, { status: 400 })
  }

  // 위치는 인벤토리에 귀속 — 필수
  const inventoryId = parseInt(invIdRaw)
  if (isNaN(inventoryId)) return NextResponse.json({ error: '인벤토리를 선택해주세요.' }, { status: 400 })
  const inventory = await prisma.inventory.findUnique({ where: { id: inventoryId } })
  if (!inventory) return NextResponse.json({ error: '인벤토리를 찾을 수 없습니다.' }, { status: 404 })

  const existing = await prisma.warehouse.findUnique({
    where: { inventoryId_name: { inventoryId, name: name.trim() } },
  })
  if (existing) {
    return NextResponse.json({ error: '이 인벤토리에 이미 존재하는 위치명입니다.' }, { status: 409 })
  }

  const warehouse = await prisma.warehouse.create({
    data: {
      name: name.trim(),
      inventoryId,
      memo: memo?.trim() || null,
      sortOrder: sortOrder ?? 0,
      isActive: isActive ?? true,
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:warehouse',
    resourceId: warehouse.id,
    resourceLabel: `${inventory.name} · ${warehouse.name}`,
    after: warehouse,
  })

  return NextResponse.json({ warehouse }, { status: 201 })
}
