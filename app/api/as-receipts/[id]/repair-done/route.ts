import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { setAsLineRepaired, AsServiceError } from '@/lib/asReceiptService'
import { toRegistryErrorResponse } from '@/lib/deviceRegistry'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'
type Params = { params: { id: string } }

/**
 * AS접수 라인 수리완료 체크/해제 (2026-09-17 — device_condition_location_design.md §7.1·§7.2)
 * POST { itemId, repaired: boolean } — 입고된 라인(D5)만, 분실·취소·미회수 라인 제외. 결과 확정 라인(수리반환·교체 — 선교체)도 가능.
 * 라인 repaired_at/by + 기기 condition REPAIRED(REPAIR_DONE) / 해제는 CORRECT. outcome·헤더 상태·완료 판정에는 개입하지 않음(제3축).
 * 권한: VIEWER 제외 USER 이상(ship-info 골격). **종결 접수(완료·취소)도 허용(A-2)** — 다른 라인 API의 409 규약과 다름
 * (완료 전 사후 입고된 선교체 REPLACE·RECEIVED 라인 실존, 선교체 구기기는 접수 완료 후 수리됨). 그래서 canEditAsReceipt 미사용.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const repaired = body.repaired === true
  let result
  try {
    result = await setAsLineRepaired(id, { userId: user.userId, name: user.name }, { itemId: Number(body.itemId), repaired })
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    const r = toRegistryErrorResponse(e) // RegistryError·RegistryTxAbort 공통 — 409 '동시에 변경되어 다시 시도하세요' 등
    if (r) return NextResponse.json(r.body, { status: r.status })
    throw e
  }

  const asReceipt = await prisma.asReceipt.findUnique({ where: { id }, select: { asCode: true, ticketId: true } })
  // 감사 라벨 접미어 '수리완료' / '수리완료 해제' — 타임라인(summarizeAudit)이 접미어로 분기
  await logAudit({
    req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'as_receipt',
    resourceId: asReceipt?.asCode ?? id, resourceLabel: `${asReceipt?.asCode ?? id} ${repaired ? '수리완료' : '수리완료 해제'}`,
    after: { itemId: result.itemId, serialNo: result.serialNo, repaired: result.repaired, repairedAt: result.repairedAt, condition: result.condition, warnings: result.warnings },
  })
  if (asReceipt?.ticketId) syncTicketClocksSafe(asReceipt.ticketId) // 라인 토글은 티켓 시그니처를 바꾸지 않아 notifyTicketChanged 생략(ship-info 선례)
  return NextResponse.json({ success: true, ...result })
}
