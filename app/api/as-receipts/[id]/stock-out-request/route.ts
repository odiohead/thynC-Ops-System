import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { createStockOutForAsLines, AsServiceError } from '@/lib/asReceiptService'
import { notifyTicketCreated } from '@/lib/notify'
import { notifyStockOutCreated } from '@/lib/stockOutNotify'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'
type Params = { params: { id: string } }

/**
 * 분실 AS → 출고요청 생성 (2026-11-10 — projects/as_lost_stock_out_link_design.md §4)
 * POST { itemIds, requestDate, shipAddress?, recipient?, note? } — 분실 접수의 미종결·미잠금 라인만. 판매용·'분실기기 제공'·납품처=접수 병원 출고 티켓 생성 + 라인 잠금.
 * 권한: VIEWER 제외 USER 이상(라인 처리와 동일 축).
 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })
  const body = await request.json().catch(() => ({}))
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  let result
  try {
    result = await createStockOutForAsLines(id, { userId: user.userId, name: user.name }, {
      itemIds: Array.isArray(body.itemIds) ? body.itemIds.map((v: unknown) => Number(v)) : [],
      requestDate: str(body.requestDate) ?? '', shipAddress: str(body.shipAddress), recipient: str(body.recipient), note: str(body.note),
    })
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }
  const asReceipt = await prisma.asReceipt.findUnique({ where: { id }, select: { asCode: true, ticketId: true, hospital: { select: { hospitalName: true } } } })
  await logAudit({
    req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'as_receipt',
    resourceId: asReceipt?.asCode ?? id, resourceLabel: `${asReceipt?.asCode ?? id} 출고요청`,
    after: { requestId: result.requestId, sorCode: result.sorCode, itemCount: result.itemCount, serials: result.serials, groups: result.groups },
  })
  await logAudit({
    req: request, actor: auditActorFromJWT(user), action: 'CREATE', resource: 'stock_out_request',
    resourceId: result.sorCode, resourceLabel: `${result.sorCode} ${asReceipt?.hospital?.hospitalName ?? ''} 분실기기 제공 (AS ${asReceipt?.asCode ?? id})`,
    after: { asReceiptId: id, itemCount: result.itemCount, serials: result.serials },
  })
  syncTicketClocksSafe(result.ticketId)
  if (asReceipt?.ticketId) syncTicketClocksSafe(asReceipt.ticketId)
  notifyTicketCreated({ ticketId: result.ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})
  notifyStockOutCreated(result.requestId).catch(() => {})
  return NextResponse.json({ success: true, ...result }, { status: 201 })
}
