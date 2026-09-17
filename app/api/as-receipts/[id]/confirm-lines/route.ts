import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { confirmAsDrafts, AsServiceError } from '@/lib/asReceiptService'
import { toRegistryErrorResponse } from '@/lib/deviceRegistry'
import { notifyTicketChanged } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'
type Params = { params: { id: string } }

/**
 * AS접수 3. AS상세내역 [최종확정] (2026-09-14) — 초안이 있는 전 라인을 한 트랜잭션으로 확정 (resolveAsLines 경유)
 * POST { effectiveDate? } — 분실·취소 라인 처리일 / 발송일 미기입 발송 라인의 기본일 (기본 오늘)
 * 확정 후 라인은 변경 불가. 기기현황 이벤트·전 라인 종결 시 '발송완료' 자동 전이는 기존 규칙과 동일
 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  let result
  try {
    result = await confirmAsDrafts(id, { userId: user.userId, name: user.name }, {
      effectiveDate: typeof body.effectiveDate === 'string' ? body.effectiveDate : null,
    })
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    const r = toRegistryErrorResponse(e) // RegistryError·RegistryTxAbort(2026-09-17) 공통
    if (r) return NextResponse.json(r.body, { status: r.status })
    throw e
  }

  const asReceipt = await prisma.asReceipt.findUnique({ where: { id }, select: { asCode: true, ticketId: true } })
  await logAudit({
    req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'as_receipt',
    resourceId: asReceipt?.asCode ?? id, resourceLabel: `${asReceipt?.asCode ?? id} 라인 최종확정`,
    after: { confirmed: result.confirmed, warnings: result.warnings, autoCompleted: result.autoCompleted, effectiveDate: body.effectiveDate ?? null },
  })
  if (asReceipt?.ticketId) {
    syncTicketClocksSafe(asReceipt.ticketId)
    notifyTicketChanged({ ticketId: asReceipt.ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})
  }
  return NextResponse.json({ success: true, confirmed: result.confirmed, warnings: result.warnings, autoCompleted: result.autoCompleted })
}
