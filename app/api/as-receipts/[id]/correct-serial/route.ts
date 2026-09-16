import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isUserOrAbove } from '@/lib/auth'
import { hasPermission } from '@/lib/appRoles'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { canEditAsReceipt } from '@/lib/asReceipt'
import { correctAsLineSerial, AsServiceError } from '@/lib/asReceiptService'
import { RegistryError } from '@/lib/deviceRegistry'
import { notifyTicketChanged } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'
type Params = { params: { id: string } }

/**
 * AS접수 라인 시리얼 보정 (2026-09-15)
 * POST { itemId, serial } — 인입 시리얼 오타를 라인 단위로 고침. 미종결 라인만. 원 시리얼은 receiptSerialNo 보존,
 * 새 시리얼로 원장 재매칭·AS 표시, 이전 시리얼의 AS 표시(이 접수 참조) 해제. 권한: 접수 수정 권한(canEditAsReceipt)과 동일
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

  const body = await request.json()
  let result
  try {
    result = await correctAsLineSerial(id, { userId: user.userId, name: user.name }, { itemId: Number(body.itemId), serial: String(body.serial ?? '') })
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof RegistryError) return NextResponse.json(e.toJSON(), { status: e.status })
    throw e
  }

  await logAudit({
    req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'as_receipt',
    resourceId: existing.asCode, resourceLabel: `${existing.asCode} 시리얼 보정`,
    after: { itemId: body.itemId, ...result },
  })
  if (existing.ticketId) {
    syncTicketClocksSafe(existing.ticketId)
    notifyTicketChanged({ ticketId: existing.ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})
  }
  return NextResponse.json({ success: true, ...result })
}
