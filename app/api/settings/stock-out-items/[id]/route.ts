/**
 * 출고 품목 노출 토글 (projects/stock_out_v2_design.md §6) — ADMIN 이상
 * PUT /api/settings/stock-out-items/[inventoryItemId] { purpose, enabled } → stock_out_item_purposes INSERT/DELETE (멱등)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { isStockOutPurpose, STOCK_OUT_PURPOSE_LABELS } from '@/lib/stockOutShared'

type Params = { params: { id: string } }

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })
  const body = await request.json().catch(() => ({}))
  const { purpose, enabled } = body as { purpose?: unknown; enabled?: unknown }
  if (!isStockOutPurpose(purpose)) return NextResponse.json({ error: '업무 구분이 올바르지 않습니다.' }, { status: 400 })
  if (typeof enabled !== 'boolean') return NextResponse.json({ error: 'enabled는 true/false여야 합니다.' }, { status: 400 })

  const item = await prisma.inventoryItem.findUnique({ where: { id }, select: { id: true, name: true, modelName: true, inventory: { select: { name: true } } } })
  if (!item) return NextResponse.json({ error: '자재관리 품목을 찾을 수 없습니다.' }, { status: 404 })

  const key = { inventoryItemId_purpose: { inventoryItemId: id, purpose } }
  const existed = !!(await prisma.stockOutItemPurpose.findUnique({ where: key }))
  if (enabled && !existed) await prisma.stockOutItemPurpose.create({ data: { inventoryItemId: id, purpose } })
  if (!enabled && existed) await prisma.stockOutItemPurpose.delete({ where: key })

  if (existed !== enabled) {
    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'setting:stock_out_item_purpose',
      resourceId: id,
      resourceLabel: `${item.inventory.name} / ${item.name}${item.modelName ? ` (${item.modelName})` : ''} — ${STOCK_OUT_PURPOSE_LABELS[purpose]} ${enabled ? '노출' : '숨김'}`,
      before: { purpose, enabled: existed },
      after: { purpose, enabled },
    })
  }
  return NextResponse.json({ inventoryItemId: id, purpose, enabled })
}
