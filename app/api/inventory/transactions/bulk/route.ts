import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { canManageStock, planInventoryTransaction, applyInventoryTransaction, InventoryError } from '@/lib/inventory'

export const dynamic = 'force-dynamic'

interface BulkLine {
  itemId: number
  warehouseId: number
  quantity?: number
  serials?: string[]
  lotBySerial?: Record<string, string | null>
  lotNo?: string | null
}

/**
 * 다품목 일괄 입출고 — 입고/출고만. 인벤토리·유형·요청자·출고처·일자는 공통, 위치·품목·수량/시리얼·LOT는 줄별.
 * 각 줄을 planInventoryTransaction으로 검증한 뒤 단일 트랜잭션에서 전부 적용(전부 성공/전부 롤백).
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await canManageStock(user))) {
    return NextResponse.json({ error: '재고 처리 권한이 없습니다. (재고 담당자 또는 관리자만 가능)' }, { status: 403 })
  }

  const body = await req.json()
  const txType = body.txType
  if (txType !== 'IN' && txType !== 'OUT') {
    return NextResponse.json({ error: '일괄 처리는 입고 또는 출고만 지원합니다.' }, { status: 400 })
  }
  const lines: BulkLine[] = Array.isArray(body.lines) ? body.lines : []
  if (lines.length === 0) {
    return NextResponse.json({ error: '품목을 1개 이상 추가하세요.' }, { status: 400 })
  }

  const reasonId = body.reasonId ?? null
  const requester = body.requester ? String(body.requester).trim() : null
  const destination = body.destination ? String(body.destination).trim() : null
  const txDate = body.txDate ?? null

  // 1) 줄별 검증·계획 (쓰기 없음) — 실패 시 어느 줄인지 알려준다
  const plans: Awaited<ReturnType<typeof planInventoryTransaction>>[] = []
  try {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (!l.itemId || !l.warehouseId) {
        return NextResponse.json({ error: `${i + 1}번째 줄: 품목·위치를 선택하세요.` }, { status: 400 })
      }
      const serials = Array.isArray(l.serials) ? l.serials.map((s) => s.trim()).filter(Boolean) : []
      const quantity = l.quantity != null ? Number(l.quantity) : serials.length
      plans.push(
        await planInventoryTransaction({
          txType,
          reasonId,
          itemId: Number(l.itemId),
          warehouseId: Number(l.warehouseId),
          quantity,
          requester,
          destination,
          txDate,
          serials,
          lotBySerial: l.lotBySerial ?? undefined,
          lotNo: l.lotNo ?? null,
          unitIds: [],
          components: [],
        }),
      )
    }
  } catch (e) {
    if (e instanceof InventoryError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('Bulk transaction plan error:', e)
    return NextResponse.json({ error: '일괄 처리 검증 중 오류가 발생했습니다.' }, { status: 500 })
  }

  // 2) 단일 트랜잭션에서 전부 적용 (txCode 중복 시 재시도)
  let created
  for (let attempt = 0; ; attempt++) {
    try {
      created = await prisma.$transaction(async (client) => {
        const out = []
        for (const plan of plans) out.push((await applyInventoryTransaction(client, plan, user.userId))!)
        return out
      })
      break
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && attempt < 2) continue
      if (e instanceof InventoryError) return NextResponse.json({ error: e.message }, { status: e.status })
      console.error('Bulk transaction apply error:', e)
      return NextResponse.json({ error: '일괄 처리 중 오류가 발생했습니다.' }, { status: 500 })
    }
  }

  const totalQty = created.reduce((s, c) => s + c.quantity, 0)
  await logAudit({
    req,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'inventory_tx',
    resourceLabel: `일괄 ${txType === 'IN' ? '입고' : '출고'} ${created.length}품목 (총 ${totalQty})`,
    after: { codes: created.map((c) => c.txCode) },
  })

  return NextResponse.json(
    {
      created: created.length,
      transactions: created.map((c) => ({ id: c.id, txCode: c.txCode, item: c.item.name, quantity: c.quantity })),
    },
    { status: 201 },
  )
}
