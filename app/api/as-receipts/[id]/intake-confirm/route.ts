import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { confirmAsIntake, AsServiceError, type IntakeConfirmAction } from '@/lib/asReceiptService'
import { RegistryError } from '@/lib/deviceRegistry'
import { notifyTicketChanged } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'
type Params = { params: { id: string } }

const TYPES = ['REMAP', 'MARK_RECEIVED', 'NOT_RECEIVED', 'ACCEPT_EXTRA', 'DISCARD_EXTRA'] as const

/**
 * AS접수 입고 대조 — 접수자 확인 (2026-09-11 — as_work_design.md §14)
 * POST { type: REMAP|MARK_RECEIVED|NOT_RECEIVED|ACCEPT_EXTRA|DISCARD_EXTRA, itemId, extraItemId?, comment?, deviceKind? }
 * 권한: USER 이상 전원 (사용자 결정 — 별도 권한키 없음)
 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const body = await request.json()
  if (!TYPES.includes(body.type)) return NextResponse.json({ error: '확인 동작이 올바르지 않습니다.' }, { status: 400 })
  const action = {
    type: body.type, itemId: Number(body.itemId), extraItemId: Number(body.extraItemId),
    comment: typeof body.comment === 'string' ? body.comment : '', deviceKind: typeof body.deviceKind === 'string' ? body.deviceKind : null,
  } as IntakeConfirmAction

  let result
  try {
    result = await confirmAsIntake(id, { userId: user.userId, name: user.name }, action)
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof RegistryError) return NextResponse.json(e.toJSON(), { status: e.status })
    throw e
  }

  const asReceipt = await prisma.asReceipt.findUnique({ where: { id }, select: { asCode: true, ticketId: true } })
  await logAudit({
    req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'as_receipt',
    resourceId: asReceipt?.asCode ?? id, resourceLabel: `${asReceipt?.asCode ?? id} 입고 확인(${body.type})`,
    after: { ...body, ...result },
  })
  if (asReceipt?.ticketId) {
    syncTicketClocksSafe(asReceipt.ticketId)
    notifyTicketChanged({ ticketId: asReceipt.ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})
  }
  return NextResponse.json({ success: true, ...result })
}
