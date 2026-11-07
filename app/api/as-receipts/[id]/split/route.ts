import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isUserOrAbove } from '@/lib/auth'
import { hasPermission } from '@/lib/appRoles'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { canEditAsReceipt } from '@/lib/asReceipt'
import { splitAsReceipt, AsServiceError, type SplitGroupInput } from '@/lib/asReceiptService'
import { toRegistryErrorResponse } from '@/lib/deviceRegistry'
import { syncCombinedPackByTracking } from '@/lib/asReceiptSearch'
import { notifyTicketCreated, notifyTicketChanged } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'
type Params = { params: { id: string } }

/**
 * AS접수 분할 (2026-11-07 — projects/as_receipt_split_design.md §6·§7)
 * body { mode:'WARD'|'CATEGORY', groups:[{ key, itemIds[], destInfo?, category? }] } → 201 { children, warnings }
 * 권한: 수정 권한과 동일(canEditAsReceipt) — 종결 접수는 서비스가 409
 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const existing = await prisma.asReceipt.findUnique({
    where: { id },
    include: { status: { select: { id: true, name: true, ticketStatus: true } }, hospital: { select: { hospitalName: true } }, items: { select: { id: true, serialNo: true, wardName: true, outcome: true }, orderBy: { id: 'asc' } } },
  })
  if (!existing) return NextResponse.json({ error: 'AS접수를 찾을 수 없습니다.' }, { status: 404 })
  const adminPerm = isUserOrAbove(user.role) && (await hasPermission(user, 'as_receipt.admin'))
  if (!canEditAsReceipt(user, existing, adminPerm)) return NextResponse.json({ error: '분할 권한이 없습니다.' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const groups: SplitGroupInput[] = Array.isArray(body.groups)
    ? (body.groups as Record<string, unknown>[]).map((g) => ({
        key: typeof g.key === 'string' ? g.key : '',
        itemIds: Array.isArray(g.itemIds) ? (g.itemIds as unknown[]).map((v) => Number(v)) : [],
        destInfo: typeof g.destInfo === 'string' ? g.destInfo : null,
        category: typeof g.category === 'string' ? g.category : null,
      }))
    : []

  let result: Awaited<ReturnType<typeof splitAsReceipt>>
  try {
    result = await splitAsReceipt(id, { userId: user.userId, name: user.name }, { mode: body.mode, groups })
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    const r = toRegistryErrorResponse(e) // 원장 ref 정정 실패 → 409 (tx 롤백)
    if (r) return NextResponse.json(r.body, { status: r.status })
    throw e
  }

  // 감사 — 원본 UPDATE(라벨 접미사 '분할' — 타임라인 분기 키, 입고처리·원장 확정과 같은 패턴) + 자식 CREATE
  const movedIds = new Set(groups.flatMap((g) => g.itemIds))
  const after = await prisma.asReceipt.findMany({ where: { id: { in: result.children.map((c) => c.id) } }, include: { items: { select: { id: true, serialNo: true, wardName: true }, orderBy: { id: 'asc' } } } })
  const actor = auditActorFromJWT(user)
  await logAudit({
    req: request, actor, action: 'UPDATE', resource: 'as_receipt', resourceId: existing.asCode, resourceLabel: `${existing.asCode} 분할`,
    before: { items: existing.items },
    after: { mode: body.mode, items: existing.items.filter((i) => !movedIds.has(i.id)), children: result.children.map((c) => ({ ...c, serials: after.find((a) => a.id === c.id)?.items.map((i) => i.serialNo) ?? [] })), warnings: result.warnings },
  })
  for (const c of result.children) {
    const row = after.find((a) => a.id === c.id)
    await logAudit({ req: request, actor, action: 'CREATE', resource: 'as_receipt', resourceId: c.asCode, resourceLabel: `${c.asCode} ${existing.hospital.hospitalName} (분할 ← ${existing.asCode} · ${c.key})`, after: row ?? { id: c.id, asCode: c.asCode } })
  }

  // best-effort 후처리 — 합포장 자동 태그·SLA 시계·Slack(티켓 파이프라인 단일 소스)
  for (const c of result.children) {
    const row = after.find((a) => a.id === c.id)
    if (row?.pickupTrackingNo) await syncCombinedPackByTracking(c.id, row.pickupTrackingNo).catch((e) => console.warn('[as] 분할 합포장 자동 태그 실패:', e))
    syncTicketClocksSafe(c.ticketId)
    notifyTicketCreated({ ticketId: c.ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})
  }
  if (existing.ticketId) {
    syncTicketClocksSafe(existing.ticketId)
    notifyTicketChanged({ ticketId: existing.ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})
  }
  return NextResponse.json({ children: result.children, warnings: result.warnings }, { status: 201 })
}
