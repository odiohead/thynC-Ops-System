import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { reopenAsReceipt, AsServiceError } from '@/lib/asReceiptService'
import { notifyTicketChanged } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'
type Params = { params: { id: string } }

/**
 * AS접수 리오픈 (2026-09-11) — 완료·취소 접수를 비종결 상태로 되돌림(헤더만, 라인·기기현황 이벤트 불변)
 * POST { reason, statusId? } — 사유 필수(비고 이력). 권한: USER 이상 전원(종결 후 수정을 열어주는 진입점)
 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const body = await request.json()
  let result
  try {
    result = await reopenAsReceipt(id, { userId: user.userId, name: user.name }, {
      reason: typeof body.reason === 'string' ? body.reason : '',
      statusId: body.statusId == null ? null : Number(body.statusId),
    })
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }

  const asReceipt = await prisma.asReceipt.findUnique({ where: { id }, select: { asCode: true, ticketId: true } })
  await logAudit({
    req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'as_receipt',
    resourceId: asReceipt?.asCode ?? id, resourceLabel: `${asReceipt?.asCode ?? id} 리오픈`,
    after: { reason: body.reason, statusId: body.statusId, ...result },
  })
  if (asReceipt?.ticketId) {
    syncTicketClocksSafe(asReceipt.ticketId)
    notifyTicketChanged({ ticketId: asReceipt.ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})
  }
  return NextResponse.json({ success: true, ...result })
}
