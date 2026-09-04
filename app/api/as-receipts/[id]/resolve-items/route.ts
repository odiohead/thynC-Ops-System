import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { resolveAsLines, AsServiceError } from '@/lib/asReceiptService'
import { RegistryError } from '@/lib/deviceRegistry'
import { notifyTicketChanged } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * AS접수 라인 결과 확정 (as_work_design.md §5·§7) — 부분 발송 지원 (결정 6)
 * POST { lines: [{itemId, outcome, newSerial?}], effectiveDate?, shipMethod?, shipTrackingNo? }
 * 수리반환 → clearDeviceAs / 교체 → replaceDevice(fold 자동 해제) / 분실종결 → recoverDevice(LOST) / 라인취소 → clearDeviceAs
 * 전 라인 종결 시 헤더 '완료' 자동 + 티켓 CLOSED (§13-4).
 * 권한: USER 이상 전원 — 별도 처리 풀 없음(1차, 설계 §7)
 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const body = await request.json()

  let result
  try {
    result = await resolveAsLines(id, { userId: user.userId, name: user.name }, {
      lines: Array.isArray(body.lines) ? body.lines : [],
      effectiveDate: typeof body.effectiveDate === 'string' ? body.effectiveDate : null,
      shipMethod: body.shipMethod ?? null,
      shipTrackingNo: typeof body.shipTrackingNo === 'string' ? body.shipTrackingNo : null,
    })
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof RegistryError) return NextResponse.json(e.toJSON(), { status: e.status })
    throw e
  }

  const asReceipt = await prisma.asReceipt.findUnique({
    where: { id },
    select: { asCode: true, ticketId: true },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'as_receipt',
    resourceId: asReceipt?.asCode ?? id,
    resourceLabel: `${asReceipt?.asCode ?? id} 라인 처리`,
    after: { lines: body.lines, warnings: result.warnings, autoCompleted: result.autoCompleted },
  })

  if (asReceipt?.ticketId) {
    syncTicketClocksSafe(asReceipt.ticketId)
    notifyTicketChanged({ ticketId: asReceipt.ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})
  }

  return NextResponse.json({ success: true, warnings: result.warnings, autoCompleted: result.autoCompleted })
}
