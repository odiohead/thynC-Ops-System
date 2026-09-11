import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { confirmAsRegistry, AsServiceError } from '@/lib/asReceiptService'
import { RegistryError } from '@/lib/deviceRegistry'
import { notifyTicketChanged } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'
type Params = { params: { id: string } }

/**
 * AS접수 원장 정합 확정 (2026-09-11 — as_work_design.md §15)
 * POST { itemId, modelInput?, productType?, wardName? } — 미등록 신규 등록 / 회수·미배치 재등록 / 타병원 이관 → 접수 병원 ACTIVE 배치 + 라인 연결 + AS 표시
 * 권한: USER 이상 전원
 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const body = await request.json()
  let result
  try {
    result = await confirmAsRegistry(id, { userId: user.userId, name: user.name }, {
      itemId: Number(body.itemId),
      modelInput: typeof body.modelInput === 'string' ? body.modelInput : null,
      productType: typeof body.productType === 'string' ? body.productType : null,
      wardName: typeof body.wardName === 'string' ? body.wardName : null,
    })
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof RegistryError) return NextResponse.json(e.toJSON(), { status: e.status })
    throw e
  }

  const asReceipt = await prisma.asReceipt.findUnique({ where: { id }, select: { asCode: true, ticketId: true } })
  await logAudit({
    req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'as_receipt',
    resourceId: asReceipt?.asCode ?? id, resourceLabel: `${asReceipt?.asCode ?? id} 원장 확정`,
    after: { ...body, ...result },
  })
  if (asReceipt?.ticketId) {
    syncTicketClocksSafe(asReceipt.ticketId)
    notifyTicketChanged({ ticketId: asReceipt.ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})
  }
  return NextResponse.json({ success: true, ...result })
}
