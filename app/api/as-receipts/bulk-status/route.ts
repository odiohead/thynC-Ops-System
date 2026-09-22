import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isUserOrAbove } from '@/lib/auth'
import { hasPermission } from '@/lib/appRoles'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { canEditAsReceipt, asStatusChangeData } from '@/lib/asReceipt'
import { AS_BULK_STATUS_MAX } from '@/lib/asReceiptShared'
import { syncAsReceiptToTicket } from '@/lib/ticket-domains/asReceipt'
import { todayKst } from '@/lib/deviceRegistryShared'
import { notifyTicketChanged } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'

/**
 * AS접수 상태 일괄변경 (2026-09-21 사용자 요청 — 목록 체크박스 선택 → 상태 적용)
 * body { ids: number[], statusId: number } — 접수별로 PUT 단건과 같은 규칙(권한 canEditAsReceipt · statusChangedAt · 완료일 자동 · 티켓 동기화 · 감사).
 * 접수마다 개별 트랜잭션 — 일부 실패해도 나머지는 반영하고 skipped[]로 사유 보고.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const ids = Array.isArray(body.ids) ? Array.from(new Set((body.ids as unknown[]).map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0))) : []
  const sid = Number(body.statusId)
  if (!ids.length) return NextResponse.json({ error: '선택된 접수가 없습니다.' }, { status: 400 })
  if (ids.length > AS_BULK_STATUS_MAX) return NextResponse.json({ error: `한 번에 최대 ${AS_BULK_STATUS_MAX}건까지 변경할 수 있습니다.` }, { status: 400 })
  const next = Number.isInteger(sid)
    ? await prisma.statusCode.findFirst({ where: { id: sid, category: 'AS_STATUS' }, select: { id: true, name: true, ticketStatus: true } })
    : null
  if (!next) return NextResponse.json({ error: '상태가 올바르지 않습니다.' }, { status: 400 })

  const adminPerm = isUserOrAbove(user.role) && (await hasPermission(user, 'as_receipt.admin'))
  const receipts = await prisma.asReceipt.findMany({
    where: { id: { in: ids } },
    include: { status: { select: { id: true, name: true, ticketStatus: true } } },
  })
  const byId = new Map(receipts.map((r) => [r.id, r]))
  const today = todayKst()

  const updated: string[] = []
  const unchanged: string[] = []
  const skipped: { asCode: string; reason: string }[] = []

  for (const id of ids) {
    const existing = byId.get(id)
    if (!existing) {
      skipped.push({ asCode: `#${id}`, reason: '접수를 찾을 수 없습니다.' })
      continue
    }
    if (!canEditAsReceipt(user, existing, adminPerm)) {
      skipped.push({ asCode: existing.asCode, reason: '수정 권한 없음 (완료·취소 건은 ADMIN 또는 AS 관리 권한만)' })
      continue
    }
    const data = asStatusChangeData(existing, next, today)
    if (!Object.keys(data).length) {
      unchanged.push(existing.asCode)
      continue
    }
    try {
      const after = await prisma.$transaction(
        async (tx) => {
          const row = await tx.asReceipt.update({ where: { id }, data, include: { status: { select: { id: true, name: true } } } })
          await syncAsReceiptToTicket(tx, id, user.userId) // 규칙 3 — 연결 티켓 status는 어댑터만 갱신
          return row
        },
        { timeout: 30000, maxWait: 10000 },
      )
      updated.push(existing.asCode)
      await logAudit({
        req: request,
        actor: auditActorFromJWT(user),
        action: 'UPDATE',
        resource: 'as_receipt',
        resourceId: existing.asCode,
        resourceLabel: `${existing.asCode} 상태 일괄변경 → ${next.name}`,
        before: { statusId: existing.statusId, status: existing.status?.name ?? null, resolvedAt: existing.resolvedAt },
        after: { statusId: after.statusId, status: after.status?.name ?? null, resolvedAt: after.resolvedAt },
      })
      if (existing.ticketId) {
        syncTicketClocksSafe(existing.ticketId)
        notifyTicketChanged({ ticketId: existing.ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})
      }
    } catch (e) {
      console.error(`[as] 상태 일괄변경 실패 (${existing.asCode}):`, e)
      skipped.push({ asCode: existing.asCode, reason: e instanceof Error ? e.message : '변경에 실패했습니다.' })
    }
  }

  return NextResponse.json({ status: next.name, updated, unchanged, skipped })
}
