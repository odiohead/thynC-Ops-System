import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { setAsLineRepairResult, AsServiceError } from '@/lib/asReceiptService'
import { isAsSettableRepairResult, AS_REPAIR_RESULT_LABELS } from '@/lib/asReceiptShared'
import { toRegistryErrorResponse } from '@/lib/deviceRegistry'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'
type Params = { params: { id: string } }

/**
 * AS접수 라인 회수기기 처리 지정/해제 (2026-09-17 수리완료 체크 → 2026-11-02 3택 — device_condition_location_design.md §7.1·§7.2)
 * POST { itemId, result: 'REPAIRED'|'NO_FAULT'|null } — 수리 / 문제없음 / 해제. 폐기는 scrap-line(확인·사유 필수). 구 형식 { repaired: boolean }도 수용(true → 수리, false → 해제).
 * 입고된 라인(D5)만, 분실·취소·미회수 라인 제외. 결과 확정 라인(수리반환·교체 — 선교체)도 가능. 폐기된 라인은 400.
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
  // result 키가 있으면 그것을, 없으면 구 형식 repaired(boolean)를 쓴다
  let target: 'REPAIRED' | 'NO_FAULT' | null
  if ('result' in body) {
    if (body.result !== null && !isAsSettableRepairResult(body.result)) return NextResponse.json({ error: '회수기기 처리 값이 올바르지 않습니다 (REPAIRED/NO_FAULT/null — 폐기는 scrap-line)' }, { status: 400 })
    target = body.result
  } else target = body.repaired === true ? 'REPAIRED' : null
  let result
  try {
    result = await setAsLineRepairResult(id, { userId: user.userId, name: user.name }, { itemId: Number(body.itemId), result: target })
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    const r = toRegistryErrorResponse(e) // RegistryError·RegistryTxAbort 공통 — 409 '동시에 변경되어 다시 시도하세요' 등
    if (r) return NextResponse.json(r.body, { status: r.status })
    throw e
  }

  const asReceipt = await prisma.asReceipt.findUnique({ where: { id }, select: { asCode: true, ticketId: true } })
  // 감사 라벨 접미어 '회수처리' (2026-11-02, after.repairResult로 값 구분) — 타임라인(summarizeAudit)이 접미어로 분기. 구 접미어 '수리완료'/'수리완료 해제'는 과거 이력 표시용으로 타임라인에 남아 있음
  await logAudit({
    req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'as_receipt',
    resourceId: asReceipt?.asCode ?? id, resourceLabel: `${asReceipt?.asCode ?? id} 회수처리`,
    after: { itemId: result.itemId, serialNo: result.serialNo, repairResult: result.repairResult, repairResultLabel: result.repairResult ? AS_REPAIR_RESULT_LABELS[result.repairResult] : '해제', repairedAt: result.repairedAt, condition: result.condition, warnings: result.warnings },
  })
  if (asReceipt?.ticketId) syncTicketClocksSafe(asReceipt.ticketId) // 라인 토글은 티켓 시그니처를 바꾸지 않아 notifyTicketChanged 생략(ship-info 선례)
  return NextResponse.json({ success: true, ...result })
}
