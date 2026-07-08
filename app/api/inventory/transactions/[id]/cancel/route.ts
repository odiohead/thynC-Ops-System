import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { canManageStock, cancelInventoryTransaction, InventoryError } from '@/lib/inventory'

type Params = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await canManageStock(user))) {
    return NextResponse.json({ error: '재고 처리 권한이 없습니다.' }, { status: 403 })
  }

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  try {
    const tx = await cancelInventoryTransaction(id, user.userId)

    await logAudit({
      req,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'inventory_tx',
      resourceId: tx.id,
      resourceLabel: `${tx.txCode} 취소 [${tx.txType}] ${tx.item.name}`,
      after: { canceledAt: tx.canceledAt },
    })

    return NextResponse.json({ transaction: tx })
  } catch (e) {
    if (e instanceof InventoryError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    console.error('Inventory transaction cancel error:', e)
    return NextResponse.json({ error: '취소 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
