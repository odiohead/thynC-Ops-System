import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { setAsLineRepairResult, AsServiceError } from '@/lib/asReceiptService'
import { toRegistryErrorResponse } from '@/lib/deviceRegistry'
import { syncTicketClocksSafe } from '@/lib/sla'
import { AS_QUEUE_BULK_MAX, AS_REPAIR_RESULT_LABELS, isAsSettableRepairResult } from '@/lib/asReceiptShared'

export const dynamic = 'force-dynamic'

/**
 * 수리대기 큐 — 회수기기 처리 일괄 (2026-09-28 수리완료 일괄 → 2026-11-02 수리/문제없음 선택 — as_repair_queue_design.md §5.2)
 * POST { itemIds: number[] ≤100, result?: 'REPAIRED'|'NO_FAULT' (기본 수리) } — 라인별 setAsLineRepairResult(개별 트랜잭션, bulk-status 선례: 일부 실패해도 나머지 반영).
 * 폐기는 일괄 대상이 아니다(확인·사유 필수 — 단건 scrap-line)
 * 감사·비고·기기 REPAIR_DONE 이벤트는 단건 함수가 처리. 응답 { updated, skipped:[{itemId, serialNo, reason}], warnings }
 * 권한: VIEWER 제외 USER 이상 — 단건 repair-done과 동일(접수 종결 무관, A-2)
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  const ids = Array.isArray(body.itemIds) ? Array.from(new Set((body.itemIds as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0))) : []
  if (!ids.length) return NextResponse.json({ error: 'itemIds가 필요합니다.' }, { status: 400 })
  if (ids.length > AS_QUEUE_BULK_MAX) return NextResponse.json({ error: `한 번에 ${AS_QUEUE_BULK_MAX}건까지 처리할 수 있습니다.` }, { status: 400 })
  const target = body.result === undefined ? 'REPAIRED' : body.result
  if (!isAsSettableRepairResult(target)) return NextResponse.json({ error: '일괄 처리 값은 수리(REPAIRED) 또는 문제없음(NO_FAULT)만 가능합니다.' }, { status: 400 })

  const lines = await prisma.asReceiptItem.findMany({ where: { id: { in: ids } }, select: { id: true, serialNo: true, receiptId: true, repairedAt: true, receipt: { select: { asCode: true, ticketId: true } } } })
  const byId = new Map(lines.map((l) => [l.id, l]))
  const actor = { userId: user.userId, name: user.name }
  let updated = 0
  const skipped: { itemId: number; serialNo: string | null; reason: string }[] = []
  const warnings: string[] = []
  const touchedTickets = new Set<number>()
  for (const itemId of ids) {
    const line = byId.get(itemId)
    if (!line) { skipped.push({ itemId, serialNo: null, reason: '라인을 찾을 수 없습니다.' }); continue }
    if (line.repairedAt) { skipped.push({ itemId, serialNo: line.serialNo, reason: '이미 회수처리됨' }); continue }
    try {
      const r = await setAsLineRepairResult(line.receiptId, actor, { itemId, result: target })
      updated++
      warnings.push(...(r.warnings ?? [])) // 서비스 경고는 이미 시리얼 접두 포함
      await logAudit({
        req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'as_receipt',
        resourceId: line.receipt.asCode, resourceLabel: `${line.receipt.asCode} 회수처리`, // 단건과 같은 접미어 — 타임라인 분기 유지
        after: { itemId: r.itemId, serialNo: r.serialNo, repairResult: r.repairResult, repairResultLabel: r.repairResult ? AS_REPAIR_RESULT_LABELS[r.repairResult] : '해제', repairedAt: r.repairedAt, condition: r.condition, warnings: r.warnings, via: 'queue-bulk' },
      })
      if (line.receipt.ticketId) touchedTickets.add(line.receipt.ticketId)
    } catch (e) {
      const msg = e instanceof AsServiceError ? e.message : (toRegistryErrorResponse(e)?.body as { error?: string } | undefined)?.error
      if (!msg) throw e
      skipped.push({ itemId, serialNo: line.serialNo, reason: msg })
    }
  }
  touchedTickets.forEach((t) => syncTicketClocksSafe(t))
  return NextResponse.json({ success: true, updated, skipped, warnings })
}
