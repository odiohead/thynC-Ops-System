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
    const { registryCancelled, registryWarnings, ...tx } = await cancelInventoryTransaction(id, user.userId, user.name)

    await logAudit({
      req,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'inventory_tx',
      resourceId: tx.id,
      resourceLabel: `${tx.txCode} 취소 [${tx.txType}] ${tx.item.name}`,
      after: {
        canceledAt: tx.canceledAt,
        ...(registryCancelled.length > 0 ? { registryCancelled: registryCancelled.map((c) => ({ serialNo: c.serialNo, hospitalCode: c.hospitalCode, eventIds: c.cancelledEventIds, restored: c.restored })) } : {}),
      },
    })
    // 기기현황 쪽 취소 기록 — 화면의 '이벤트 취소'와 같은 모양(기기별 1행)
    for (const c of registryCancelled) {
      await logAudit({
        req,
        actor: auditActorFromJWT(user),
        action: 'DELETE',
        resource: 'hospital_device_event',
        resourceId: c.eventId,
        resourceLabel: `${c.serialNo} 등록 취소 — 전표 ${tx.txCode} 취소${c.cancelledEventIds.length > 1 ? ` (+${c.cancelledEventIds.length - 1}건 짝 취소)` : ''}`,
        before: { anchorEventId: c.eventId, serialNo: c.serialNo, events: c.cancelledEvents },
        after: { cancelledEventIds: c.cancelledEventIds, restored: c.restored, viaInventoryTx: tx.txCode },
      })
    }

    return NextResponse.json({
      transaction: tx,
      // 함께 취소된 기기현황 등록 (없으면 빈 배열) — 화면이 안내한다
      registryCancelled: registryCancelled.map((c) => ({ serialNo: c.serialNo, hospitalCode: c.hospitalCode, restored: c.restored })),
      registryWarnings,
    })
  } catch (e) {
    if (e instanceof InventoryError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    console.error('Inventory transaction cancel error:', e)
    return NextResponse.json({ error: '취소 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
