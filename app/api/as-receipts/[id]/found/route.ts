import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { markAsLineFound, AsServiceError } from '@/lib/asReceiptService'
import { toRegistryErrorResponse } from '@/lib/deviceRegistry'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'
type Params = { params: { id: string } }

/**
 * 분실기기 되찾음 (2026-11-10 — projects/as_lost_found_design.md §3)
 * POST { itemId, foundAt?, wardName?, recallTrackingNo?, memo? } — 분실 접수 · 교체 확정 라인 · 교체기기가 원장 별도 유닛인 라인만.
 * 라인 REPLACE → FOUND, 교체기기 RECOVER(RETURN) · 되찾은 기기 재배치(IN_USE). 분실 한도 분자에서 즉시 제외. 헤더 상태 불변(종결 접수도 허용 — 사후 사건).
 * 권한: VIEWER 제외 USER 이상(회수기기 처리·폐기와 동일 축).
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
    result = await markAsLineFound(id, { userId: user.userId, name: user.name }, {
      itemId: Number(body.itemId), foundAt: str(body.foundAt), wardName: str(body.wardName), recallTrackingNo: str(body.recallTrackingNo), memo: str(body.memo),
    })
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    const r = toRegistryErrorResponse(e)
    if (r) return NextResponse.json(r.body, { status: r.status })
    throw e
  }

  const asReceipt = await prisma.asReceipt.findUnique({ where: { id }, select: { asCode: true, ticketId: true } })
  await logAudit({
    req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'as_receipt',
    resourceId: asReceipt?.asCode ?? id, resourceLabel: `${asReceipt?.asCode ?? id} 되찾음`,
    after: { itemId: result.itemId, serialNo: result.serialNo, newSerialNo: result.newSerialNo, foundAt: result.foundAt, wardName: result.wardName, recallTrackingNo: str(body.recallTrackingNo)?.trim() || null, memo: str(body.memo)?.trim() || null, warnings: result.warnings },
  })
  if (asReceipt?.ticketId) syncTicketClocksSafe(asReceipt.ticketId)
  return NextResponse.json({ success: true, ...result })
}
