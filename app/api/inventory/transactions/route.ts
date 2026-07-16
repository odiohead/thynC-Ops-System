import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { canManageStock, createInventoryTransaction, InventoryError } from '@/lib/inventory'
import { txInclude, buildTxWhere } from '@/lib/inventoryQuery'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50')))

  const where = buildTxWhere(searchParams)

  const [data, total] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where,
      include: txInclude,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.inventoryTransaction.count({ where }),
  ])

  return NextResponse.json({ data, total, page, limit })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await canManageStock(user))) {
    return NextResponse.json({ error: '재고 처리 권한이 없습니다. (재고 담당자 또는 관리자만 가능)' }, { status: 403 })
  }

  const body = await req.json()

  try {
    const tx = await createInventoryTransaction(
      {
        txType: body.txType,
        reasonId: body.reasonId ?? null,
        itemId: body.itemId,
        warehouseId: body.warehouseId,
        toWarehouseId: body.toWarehouseId ?? null,
        quantity: body.quantity,
        destination: body.destination ?? null,
        hospitalCode: body.hospitalCode ?? null,
        workType: body.workType ?? null,
        refCode: body.refCode ?? null,
        note: body.note ?? null,
        serials: body.serials ?? [],
        unitIds: body.unitIds ?? [],
        components: body.components ?? [],
      },
      user.userId,
    )

    await logAudit({
      req,
      actor: auditActorFromJWT(user),
      action: 'CREATE',
      resource: 'inventory_tx',
      resourceId: tx!.id,
      resourceLabel: `${tx!.txCode} [${tx!.txType}] ${tx!.item.name} ${tx!.quantity}${tx!.childTxs.length > 0 ? ` (부자재 ${tx!.childTxs.length}종 세트출고)` : ''}`,
      after: tx,
    })

    return NextResponse.json({ transaction: tx }, { status: 201 })
  } catch (e) {
    if (e instanceof InventoryError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    console.error('Inventory transaction error:', e)
    return NextResponse.json({ error: '전표 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
