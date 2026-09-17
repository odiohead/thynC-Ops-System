import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { scrapAsLineDevice, AsServiceError } from '@/lib/asReceiptService'
import { toRegistryErrorResponse } from '@/lib/deviceRegistry'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'
type Params = { params: { id: string } }

/**
 * AS접수 라인 기기 폐기 (2026-09-17 — device_condition_location_design.md §7.1, A-5)
 * POST { itemId, memo } — 입고된 라인·분실/취소/미회수 제외·원장 연결 라인만. 기기 SCRAPPED·위치 없음(SCRAP), 라인 repaired_at/by NULL.
 * 배치 ACTIVE 기기는 409 '배치 중 기기는 먼저 회수하세요'(I-3 — 회수·교체 확정 후에만). memo 필수(오폐기 완화책 — 되돌림은 admin CORRECT·LIFO 취소).
 * 권한: VIEWER 제외 USER 이상(AS 업무 권한과 동일 — 사용자 결정 A-5). 종결 접수도 허용(수리완료 체크와 동일 — 선교체 구기기는 완료 후 판정).
 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const memo = typeof body.memo === 'string' ? body.memo : ''
  let result
  try {
    result = await scrapAsLineDevice(id, { userId: user.userId, name: user.name }, { itemId: Number(body.itemId), memo })
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    const r = toRegistryErrorResponse(e) // RegistryError(배치 ACTIVE 409 등)·RegistryTxAbort 공통
    if (r) return NextResponse.json(r.body, { status: r.status })
    throw e
  }

  const asReceipt = await prisma.asReceipt.findUnique({ where: { id }, select: { asCode: true, ticketId: true } })
  await logAudit({
    req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'as_receipt',
    resourceId: asReceipt?.asCode ?? id, resourceLabel: `${asReceipt?.asCode ?? id} 폐기`,
    after: { itemId: result.itemId, serialNo: result.serialNo, memo: memo.trim(), condition: result.condition, warnings: result.warnings },
  })
  if (asReceipt?.ticketId) syncTicketClocksSafe(asReceipt.ticketId)
  return NextResponse.json({ success: true, ...result })
}
