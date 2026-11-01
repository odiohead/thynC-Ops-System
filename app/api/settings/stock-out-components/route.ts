/**
 * 출고요청 구성 안내 설정 (projects/stock_out_v2_design.md §13·§14) — ADMIN 이상 쓰기
 * stock_out_item_components: 주 품목(예: 대웅제약재고 thynC 시스템 XX) 1개당 부자재(예: 운영팀재고) 포함 수량. 인벤토리 제한 없음(안내 전용).
 * GET    → 주 품목별 부자재 목록
 * PUT    { parentItemId, childItemId, quantity } → 업서트
 * DELETE ?parentItemId=&childItemId= → 1행 삭제 (childItemId 생략 시 주 품목 구성 전체 삭제)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const itemSelect = { id: true, itemCode: true, name: true, modelName: true, isActive: true, inventory: { select: { id: true, name: true } } } as const

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const rows = await prisma.stockOutItemComponent.findMany({
    include: { parent: { select: itemSelect }, child: { select: itemSelect } },
    orderBy: [{ parentItemId: 'asc' }, { sortOrder: 'asc' }, { childItemId: 'asc' }],
  })
  const parents: { parent: typeof rows[number]['parent']; children: { item: typeof rows[number]['child']; quantity: number; sortOrder: number }[] }[] = []
  for (const r of rows) {
    let p = parents.find((x) => x.parent.id === r.parentItemId)
    if (!p) { p = { parent: r.parent, children: [] }; parents.push(p) }
    p.children.push({ item: r.child, quantity: r.quantity, sortOrder: r.sortOrder })
  }
  parents.sort((a, b) => a.parent.inventory.id - b.parent.inventory.id || a.parent.name.localeCompare(b.parent.name, 'ko'))
  return NextResponse.json({ parents })
}

export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  const parentItemId = Number(body.parentItemId)
  const childItemId = Number(body.childItemId)
  const quantity = Math.trunc(Number(body.quantity ?? 1))
  if (!Number.isInteger(parentItemId) || !Number.isInteger(childItemId)) return NextResponse.json({ error: '품목이 올바르지 않습니다.' }, { status: 400 })
  if (parentItemId === childItemId) return NextResponse.json({ error: '자기 자신을 구성품으로 넣을 수 없습니다.' }, { status: 400 })
  if (!Number.isFinite(quantity) || quantity <= 0) return NextResponse.json({ error: '포함 수량은 1 이상의 정수여야 합니다.' }, { status: 400 })

  const [parent, child] = await Promise.all([
    prisma.inventoryItem.findUnique({ where: { id: parentItemId }, select: itemSelect }),
    prisma.inventoryItem.findUnique({ where: { id: childItemId }, select: itemSelect }),
  ])
  if (!parent) return NextResponse.json({ error: '주 품목을 찾을 수 없습니다.' }, { status: 404 })
  if (!child) return NextResponse.json({ error: '구성품 품목을 찾을 수 없습니다.' }, { status: 404 })
  // 1단계 깊이 — 구성품이 다시 주 품목이면 포함 수량 계산이 재귀가 되므로 금지
  const childIsParent = await prisma.stockOutItemComponent.count({ where: { parentItemId: childItemId } })
  if (childIsParent > 0) return NextResponse.json({ error: '이미 주 품목으로 구성을 가진 품목은 구성품이 될 수 없습니다.' }, { status: 409 })
  const parentIsChild = await prisma.stockOutItemComponent.count({ where: { childItemId: parentItemId } })
  if (parentIsChild > 0) return NextResponse.json({ error: '다른 주 품목의 구성품인 품목은 주 품목이 될 수 없습니다.' }, { status: 409 })

  const key = { parentItemId_childItemId: { parentItemId, childItemId } }
  const before = await prisma.stockOutItemComponent.findUnique({ where: key })
  const maxOrder = before ? null : await prisma.stockOutItemComponent.aggregate({ where: { parentItemId }, _max: { sortOrder: true } })
  const row = await prisma.stockOutItemComponent.upsert({
    where: key,
    create: { parentItemId, childItemId, quantity, sortOrder: (maxOrder?._max.sortOrder ?? 0) + 1 },
    update: { quantity },
  })
  await logAudit({
    req: request, actor: auditActorFromJWT(user), action: before ? 'UPDATE' : 'CREATE', resource: 'setting:stock_out_item_component',
    resourceId: `${parentItemId}:${childItemId}`,
    resourceLabel: `${parent.inventory.name} / ${parent.name} ← ${child.inventory.name} / ${child.name} × ${quantity}`,
    before: before ?? undefined, after: row,
  })
  return NextResponse.json({ component: { parentItemId, childItemId, quantity: row.quantity, sortOrder: row.sortOrder } }, { status: before ? 200 : 201 })
}

export async function DELETE(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sp = request.nextUrl.searchParams
  const parentItemId = Number(sp.get('parentItemId'))
  const childRaw = sp.get('childItemId')
  const childItemId = childRaw ? Number(childRaw) : null
  if (!Number.isInteger(parentItemId) || (childItemId !== null && !Number.isInteger(childItemId))) return NextResponse.json({ error: '품목이 올바르지 않습니다.' }, { status: 400 })
  const where = childItemId === null ? { parentItemId } : { parentItemId, childItemId }
  const rows = await prisma.stockOutItemComponent.findMany({ where, include: { parent: { select: { name: true } }, child: { select: { name: true } } } })
  if (rows.length === 0) return NextResponse.json({ error: '구성 행이 없습니다.' }, { status: 404 })
  await prisma.stockOutItemComponent.deleteMany({ where })
  await logAudit({
    req: request, actor: auditActorFromJWT(user), action: 'DELETE', resource: 'setting:stock_out_item_component',
    resourceId: childItemId === null ? String(parentItemId) : `${parentItemId}:${childItemId}`,
    resourceLabel: `${rows[0].parent.name} 구성 ${childItemId === null ? `전체 ${rows.length}행` : `← ${rows[0].child.name}`} 삭제`,
    before: rows.map((r) => ({ childItemId: r.childItemId, quantity: r.quantity })),
  })
  return NextResponse.json({ deleted: rows.length })
}
