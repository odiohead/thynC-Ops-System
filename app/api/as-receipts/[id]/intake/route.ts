import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { intakeAsLines, AsServiceError } from '@/lib/asReceiptService'
import { notifyTicketChanged } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'
type Params = { params: { id: string } }

/**
 * AS접수 입고처리 (2026-09-11 — as_work_design.md §14)
 * POST { serials: string[] | serialsText: string, receivedAt?, checkedAt? }
 * 실물 시리얼을 접수 라인과 대조: 일치 → 정상입고, 접수됐으나 없음 → 미입고, 접수에 없음 → 미식별입고 라인. 누적 실행 가능.
 * 헤더 입고일(최초)·확인일 갱신, 상태 '입고' 자동(이전 단계일 때). 권한: USER 이상 전원
 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const body = await request.json()
  const serials: string[] = Array.isArray(body.serials)
    ? body.serials.map(String)
    : typeof body.serialsText === 'string' ? body.serialsText.split(/[\r\n,]+/) : []

  let result
  try {
    result = await intakeAsLines(id, { userId: user.userId, name: user.name }, {
      serials,
      receivedAt: typeof body.receivedAt === 'string' ? body.receivedAt : null,
      checkedAt: typeof body.checkedAt === 'string' ? body.checkedAt : null,
    })
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }

  const asReceipt = await prisma.asReceipt.findUnique({ where: { id }, select: { asCode: true, ticketId: true } })
  await logAudit({
    req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'as_receipt',
    resourceId: asReceipt?.asCode ?? id, resourceLabel: `${asReceipt?.asCode ?? id} 입고처리`,
    after: { serials, receivedAt: body.receivedAt, checkedAt: body.checkedAt, ...result },
  })
  if (asReceipt?.ticketId) {
    syncTicketClocksSafe(asReceipt.ticketId)
    notifyTicketChanged({ ticketId: asReceipt.ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})
  }
  return NextResponse.json({ success: true, ...result })
}
