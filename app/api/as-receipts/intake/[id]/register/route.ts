/**
 * 등록대기 → AS접수 등록 (as_channeltalk_intake_design.md §5) — 수동 등록(POST /api/as-receipts)과 같은 검증·생성 경로, source INTAKE_QUEUE, 상담 LINKED
 * 권한: VIEWER 제외(수동 등록과 동일)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { createAsReceipt, AsServiceError, type LineInput } from '@/lib/asReceiptService'
import { toRegistryErrorResponse } from '@/lib/deviceRegistry'
import { notifyTicketCreated } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })
  const link = await prisma.asIntakeLink.findUnique({ where: { id }, select: { id: true, chatId: true, state: true, chat: { select: { vocLink: { select: { vocId: true } } } } } })
  if (!link) return NextResponse.json({ error: '등록대기 항목을 찾을 수 없습니다.' }, { status: 404 })
  if (link.state !== 'PENDING') return NextResponse.json({ error: '이미 처리된 항목입니다.' }, { status: 409 })

  const body = await request.json().catch(() => ({}))
  const items: LineInput[] = Array.isArray(body.items)
    ? (body.items as Record<string, unknown>[]).map((r) => ({ serial: String(r.serial ?? ''), symptom: typeof r.symptom === 'string' ? r.symptom : null, wardName: typeof r.wardName === 'string' ? r.wardName : null, deviceKind: typeof r.deviceKind === 'string' ? r.deviceKind : null }))
    : []
  const receiptDate = body.receiptDate ? new Date(body.receiptDate) : new Date(NaN)
  const noteParts = [`[채널톡 상담 ${link.chatId}] 등록대기에서 등록`]
  if (typeof body.note === 'string' && body.note.trim()) noteParts.push(body.note.trim())
  let result!: Awaited<ReturnType<typeof createAsReceipt>>
  try {
    result = await createAsReceipt(
      {
        hospitalCode: typeof body.hospitalCode === 'string' ? body.hospitalCode : '',
        category: typeof body.category === 'string' ? body.category : 'FAULT',
        receiptDate,
        reporterName: typeof body.reporterName === 'string' ? body.reporterName : null,
        pickupMethod: body.pickupMethod ?? null,
        pickedUpAt: body.pickedUpAt ? new Date(body.pickedUpAt) : null,
        preReplace: body.preReplace === true,
        destType: typeof body.destType === 'string' && body.destType ? body.destType : null,
        destInfo: typeof body.destInfo === 'string' ? body.destInfo : null,
        pickupDestDiffers: body.pickupDestDiffers === true,
        pickupDestInfo: typeof body.pickupDestInfo === 'string' ? body.pickupDestInfo : null,
        note: noteParts.join('\n'),
        lines: items,
        source: 'INTAKE_QUEUE',
        vocId: link.chat.vocLink?.vocId ?? null,
      },
      { userId: user.userId, name: user.name }
    )
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    const r = toRegistryErrorResponse(e)
    if (r) return NextResponse.json(r.body, { status: r.status })
    throw e
  }
  await prisma.asIntakeLink.update({ where: { id }, data: { state: 'LINKED', receiptId: result.id, decidedById: user.userId, decidedAt: new Date(), failClass: null } })
  await logAudit({ req: request, actor: auditActorFromJWT(user), action: 'CREATE', resource: 'as_receipt', resourceId: result.asCode, resourceLabel: `${result.asCode} ${result.hospitalName} (등록대기 — 채널톡 상담 ${link.chatId})` })
  syncTicketClocksSafe(result.ticketId)
  notifyTicketCreated({ ticketId: result.ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})
  return NextResponse.json({ id: result.id, asCode: result.asCode, warnings: result.warnings }, { status: 201 })
}
