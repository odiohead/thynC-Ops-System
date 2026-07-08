import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

const childSelect = {
  id: true, itemCode: true, name: true, spec: true, unit: true, isSerialManaged: true, isActive: true,
}

/** 주자재의 부자재 구성 목록 + 이 품목이 부자재로 소속된 주자재 목록 */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const [components, usedIn] = await Promise.all([
    prisma.inventoryItemComponent.findMany({
      where: { parentItemId: id },
      include: { child: { select: childSelect } },
      orderBy: [{ sortOrder: 'asc' }, { childItemId: 'asc' }],
    }),
    prisma.inventoryItemComponent.findMany({
      where: { childItemId: id },
      include: { parent: { select: childSelect } },
      orderBy: { parentItemId: 'asc' },
    }),
  ])

  return NextResponse.json({
    components: components.map((c) => ({ childItemId: c.childItemId, quantity: c.quantity, sortOrder: c.sortOrder, item: c.child })),
    usedIn: usedIn.map((c) => ({ parentItemId: c.parentItemId, quantity: c.quantity, item: c.parent })),
  })
}

/** 부자재 추가 — 1단계 깊이만 허용 (주자재는 부자재가 될 수 없고, 부자재는 주자재가 될 수 없음) */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parentId = parseInt(params.id)
  if (isNaN(parentId)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const body = await req.json()
  const childId = parseInt(body.childItemId)
  const quantity = Math.trunc(Number(body.quantity ?? 1))
  if (isNaN(childId)) return NextResponse.json({ error: '부자재 품목을 선택하세요.' }, { status: 400 })
  if (childId === parentId) return NextResponse.json({ error: '자기 자신을 부자재로 등록할 수 없습니다.' }, { status: 400 })
  if (!Number.isFinite(quantity) || quantity <= 0) return NextResponse.json({ error: '구성 수량은 1 이상이어야 합니다.' }, { status: 400 })

  const [parent, child] = await Promise.all([
    prisma.inventoryItem.findUnique({ where: { id: parentId }, select: { id: true, name: true, itemCode: true } }),
    prisma.inventoryItem.findUnique({ where: { id: childId }, select: { id: true, name: true } }),
  ])
  if (!parent) return NextResponse.json({ error: '주자재 품목을 찾을 수 없습니다.' }, { status: 404 })
  if (!child) return NextResponse.json({ error: '부자재 품목을 찾을 수 없습니다.' }, { status: 404 })

  // 1단계 깊이 강제
  const [parentIsChild, childIsParent, dup] = await Promise.all([
    prisma.inventoryItemComponent.count({ where: { childItemId: parentId } }),
    prisma.inventoryItemComponent.count({ where: { parentItemId: childId } }),
    prisma.inventoryItemComponent.findUnique({ where: { parentItemId_childItemId: { parentItemId: parentId, childItemId: childId } } }),
  ])
  if (parentIsChild > 0) return NextResponse.json({ error: '이 품목은 이미 다른 주자재의 부자재라서 주자재가 될 수 없습니다.' }, { status: 409 })
  if (childIsParent > 0) return NextResponse.json({ error: '부자재로 등록하려는 품목이 이미 주자재(하위 부자재 보유)입니다.' }, { status: 409 })
  if (dup) return NextResponse.json({ error: '이미 등록된 부자재입니다.' }, { status: 409 })

  const mapping = await prisma.inventoryItemComponent.create({
    data: { parentItemId: parentId, childItemId: childId, quantity, sortOrder: body.sortOrder ?? 0 },
  })

  await logAudit({
    req,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'inventory_item',
    resourceId: parentId,
    resourceLabel: `${parent.itemCode} ${parent.name} 부자재 추가: ${child.name} × ${quantity}`,
    after: mapping,
  })

  return NextResponse.json({ mapping }, { status: 201 })
}

/** 구성 수량 수정 */
export async function PUT(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parentId = parseInt(params.id)
  const body = await req.json()
  const childId = parseInt(body.childItemId)
  const quantity = Math.trunc(Number(body.quantity))
  if (isNaN(parentId) || isNaN(childId)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })
  if (!Number.isFinite(quantity) || quantity <= 0) return NextResponse.json({ error: '구성 수량은 1 이상이어야 합니다.' }, { status: 400 })

  const key = { parentItemId_childItemId: { parentItemId: parentId, childItemId: childId } }
  const existing = await prisma.inventoryItemComponent.findUnique({ where: key })
  if (!existing) return NextResponse.json({ error: '매핑을 찾을 수 없습니다.' }, { status: 404 })

  const mapping = await prisma.inventoryItemComponent.update({ where: key, data: { quantity } })

  await logAudit({
    req,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'inventory_item',
    resourceId: parentId,
    resourceLabel: `부자재 구성 수량 변경 (${parentId}→${childId}: ${existing.quantity}→${quantity})`,
    before: existing,
    after: mapping,
  })

  return NextResponse.json({ mapping })
}

/** 부자재 매핑 해제 (?childItemId=) */
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parentId = parseInt(params.id)
  const childId = parseInt(new URL(req.url).searchParams.get('childItemId') ?? '')
  if (isNaN(parentId) || isNaN(childId)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const key = { parentItemId_childItemId: { parentItemId: parentId, childItemId: childId } }
  const existing = await prisma.inventoryItemComponent.findUnique({ where: key, include: { child: { select: { name: true } } } })
  if (!existing) return NextResponse.json({ error: '매핑을 찾을 수 없습니다.' }, { status: 404 })

  await prisma.inventoryItemComponent.delete({ where: key })

  await logAudit({
    req,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'inventory_item',
    resourceId: parentId,
    resourceLabel: `부자재 해제: ${existing.child.name}`,
    before: existing,
  })

  return NextResponse.json({ success: true })
}
