import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManageStock } from '@/lib/inventory'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// PUT — '동일 LOT NO 제품 출고완료' 수동 체크 토글 (입고 전표 × LOT 단위)
//
// 자동 판정(LOT 잔량 0)은 원본 수기 대장과 값이 달라져 수동 체크로 확정했다 (2026-08-04 사용자 결정).
export async function PUT(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await canManageStock(user))) {
    return NextResponse.json({ error: '입출고대장 수정 권한이 없습니다.' }, { status: 403 })
  }

  const body = await req.json()
  const transactionId = parseInt(body.transactionId)
  const lotNo = typeof body.lotNo === 'string' ? body.lotNo : ''
  const checked = !!body.checked

  if (isNaN(transactionId)) return NextResponse.json({ error: '전표를 지정하세요.' }, { status: 400 })

  const tx = await prisma.inventoryTransaction.findUnique({
    where: { id: transactionId },
    select: { id: true, txCode: true, txType: true },
  })
  if (!tx) return NextResponse.json({ error: '전표를 찾을 수 없습니다.' }, { status: 404 })
  if (tx.txType !== 'IN') {
    return NextResponse.json({ error: '입고 전표에만 표기할 수 있습니다.' }, { status: 400 })
  }

  const now = new Date()
  const check = await prisma.udiLedgerCheck.upsert({
    where: { transactionId_lotNo: { transactionId, lotNo } },
    create: { transactionId, lotNo, checked, checkedById: user.userId, checkedAt: checked ? now : null },
    update: { checked, checkedById: user.userId, checkedAt: checked ? now : null },
  })

  await logAudit({
    req,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'inventory:udi_ledger_check',
    resourceId: transactionId,
    resourceLabel: `${tx.txCode} / LOT ${lotNo || '(없음)'} — 출고완료 ${checked ? '표기' : '해제'}`,
    after: check,
  })

  return NextResponse.json({ check })
}
