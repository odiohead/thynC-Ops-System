import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isUserOrAbove } from '@/lib/auth'
import { hasPermission } from '@/lib/appRoles'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { canEditAsReceipt } from '@/lib/asReceipt'
import { correctAsLineReplacement, AsServiceError } from '@/lib/asReceiptService'
import { toRegistryErrorResponse } from '@/lib/deviceRegistry'

export const dynamic = 'force-dynamic'
type Params = { params: { id: string } }

/**
 * AS접수 교체기 정정 (2026-11-23 — projects/as_replacement_correct_design.md)
 * POST { itemId, serial, reason? } — 교체로 확정한 라인의 교체 발송기기를 잘못 적었을 때 고친다.
 * 잘못된 교체의 기기현황 기록을 취소하고 맞는 교체기로 교체를 다시 기록한다(처음부터 맞게 넣은 것과 같은 결과).
 * 접수 상태·발송 정보는 그대로. 권한: 접수 수정 권한(canEditAsReceipt)과 동일 — 완료된 접수는 ADMIN 이상 또는 as_receipt.admin
 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const existing = await prisma.asReceipt.findUnique({ where: { id }, include: { status: { select: { id: true, name: true, ticketStatus: true } } } })
  if (!existing) return NextResponse.json({ error: 'AS접수를 찾을 수 없습니다.' }, { status: 404 })
  const adminPerm = isUserOrAbove(user.role) && (await hasPermission(user, 'as_receipt.admin'))
  if (!canEditAsReceipt(user, existing, adminPerm)) return NextResponse.json({ error: '수정 권한이 없습니다.' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  let result
  try {
    result = await correctAsLineReplacement(id, { userId: user.userId, name: user.name }, { itemId: Number(body.itemId), newSerial: String(body.serial ?? ''), reason: typeof body.reason === 'string' ? body.reason : null })
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    const r = toRegistryErrorResponse(e)
    if (r) return NextResponse.json(r.body, { status: r.status })
    throw e
  }

  await logAudit({
    req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'as_receipt',
    resourceId: existing.asCode, resourceLabel: `${existing.asCode} 교체기 정정`,
    before: { itemId: body.itemId, serialNo: result.serialNo, newSerialNo: result.previousNewSerialNo },
    after: { itemId: body.itemId, serialNo: result.serialNo, newSerialNo: result.newSerialNo, registryChanged: result.registryChanged, reason: typeof body.reason === 'string' ? body.reason.slice(0, 200) : null },
  })
  return NextResponse.json({ success: true, ...result })
}
