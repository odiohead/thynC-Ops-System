import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { setAsLineRepaired, AsServiceError } from '@/lib/asReceiptService'
import { toRegistryErrorResponse } from '@/lib/deviceRegistry'
import { syncTicketClocksSafe } from '@/lib/sla'
import { AS_QUEUE_BULK_MAX } from '@/lib/asReceiptShared'

export const dynamic = 'force-dynamic'

/**
 * 수리대기 큐 — 수리완료 일괄 체크 (2026-09-28 — as_repair_queue_design.md §5.2)
 * POST { itemIds: number[] } ≤100 — 라인별 setAsLineRepaired(개별 트랜잭션, bulk-status 선례: 일부 실패해도 나머지 반영)
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
    if (line.repairedAt) { skipped.push({ itemId, serialNo: line.serialNo, reason: '이미 수리완료' }); continue }
    try {
      const r = await setAsLineRepaired(line.receiptId, actor, { itemId, repaired: true })
      updated++
      warnings.push(...(r.warnings ?? [])) // 서비스 경고는 이미 시리얼 접두 포함
      await logAudit({
        req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'as_receipt',
        resourceId: line.receipt.asCode, resourceLabel: `${line.receipt.asCode} 수리완료`, // 단건과 같은 접미어 — 타임라인 분기 유지
        after: { itemId: r.itemId, serialNo: r.serialNo, repaired: r.repaired, repairedAt: r.repairedAt, condition: r.condition, warnings: r.warnings, via: 'queue-bulk' },
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
