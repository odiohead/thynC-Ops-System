/**
 * 출고요청 시스템 구성 설정 (projects/stock_out_v2_design.md §13·§14 — 2026-11-12 개편) — ADMIN 이상 쓰기
 * 구성품 종류는 고정(`stock_out_component_kinds` — scripts/seed-stock-out-component-kinds.sql로 등록)이고, 여기서는 **수량만** 바꾼다.
 * stock_out_item_components: 시스템(parent) × 구성품 종류(child) 전 조합, 수량 0 = 미포함.
 * GET → { kinds: [{itemId, name, modelName, sourceName, sourceInventory}], parents: [{ parent, quantities: { [kindItemId]: n } }] }
 * PUT { parentItemId, childItemId, quantity } → 수량 변경 (0 이상 정수). 종류·시스템 추가/삭제는 지원하지 않음
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
  const [kinds, rows] = await Promise.all([
    prisma.stockOutComponentKind.findMany({
      select: { itemId: true, sortOrder: true, item: { select: itemSelect }, source: { select: itemSelect } },
      orderBy: [{ sortOrder: 'asc' }, { itemId: 'asc' }],
    }),
    prisma.stockOutItemComponent.findMany({ include: { parent: { select: itemSelect } }, orderBy: [{ parentItemId: 'asc' }] }),
  ])
  const kindIds = new Set(kinds.map((k) => k.itemId))
  const parents: { parent: typeof rows[number]['parent']; quantities: Record<number, number> }[] = []
  for (const r of rows) {
    if (!kindIds.has(r.childItemId)) continue // 종류로 등록되지 않은 옛 구성 행은 무시 (시드 실행 전)
    let p = parents.find((x) => x.parent.id === r.parentItemId)
    if (!p) { p = { parent: r.parent, quantities: {} }; parents.push(p) }
    p.quantities[r.childItemId] = r.quantity
  }
  // 이름의 숫자 순(시스템10 → 100)
  parents.sort((a, b) => a.parent.inventory.id - b.parent.inventory.id || a.parent.name.localeCompare(b.parent.name, 'ko', { numeric: true }))
  return NextResponse.json({
    kinds: kinds.map((k) => ({ itemId: k.itemId, itemCode: k.item.itemCode, name: k.item.name, modelName: k.item.modelName, inventoryName: k.item.inventory.name, sourceItemCode: k.source.itemCode, sourceInventoryName: k.source.inventory.name })),
    parents,
  })
}

export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  const parentItemId = Number(body.parentItemId)
  const childItemId = Number(body.childItemId)
  const quantity = Number(body.quantity)
  if (!Number.isInteger(parentItemId) || !Number.isInteger(childItemId)) return NextResponse.json({ error: '품목이 올바르지 않습니다.' }, { status: 400 })
  if (!Number.isInteger(quantity) || quantity < 0) return NextResponse.json({ error: '수량은 0 이상의 정수여야 합니다. (0 = 미포함)' }, { status: 400 })

  const key = { parentItemId_childItemId: { parentItemId, childItemId } }
  const [before, kind] = await Promise.all([
    prisma.stockOutItemComponent.findUnique({ where: key, include: { parent: { select: itemSelect }, child: { select: itemSelect } } }),
    prisma.stockOutComponentKind.findUnique({ where: { itemId: childItemId }, select: { itemId: true } }),
  ])
  // 수량만 수정 — 시스템·구성품 종류는 고정 (행이 없는 조합 = 등록되지 않은 시스템 또는 종류)
  if (!before || !kind) return NextResponse.json({ error: '등록된 시스템·구성품 조합이 아닙니다. 구성품 종류와 시스템은 고정이며 수량만 바꿀 수 있습니다.' }, { status: 404 })

  const row = await prisma.stockOutItemComponent.update({ where: key, data: { quantity } })
  await logAudit({
    req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'setting:stock_out_item_component',
    resourceId: `${parentItemId}:${childItemId}`,
    resourceLabel: `${before.parent.name} ← ${before.child.name} × ${quantity}`,
    before: { quantity: before.quantity }, after: { quantity: row.quantity },
  })
  return NextResponse.json({ component: { parentItemId, childItemId, quantity: row.quantity } })
}
