/**
 * 등록대기 → VOC 등록 (projects/voc_sheet_import_design.md §4) — 수동 등록(POST /api/voc-receipts)과 같은 검증, lib/vocImport 경로(접수·완료 시각 보정, 상담 연결)
 * 권한: VIEWER 제외. 종결 상태로 등록하면 알림·SLA 생략(과거 이력), 열린 상태면 수동 등록과 동일하게 알림·SLA.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { createVocFromImport, createVocCodeAllocator, plainToHtml } from '@/lib/vocImport'
import { notifyTicketCreated } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })
  const item = await prisma.vocIntakeItem.findUnique({ where: { id }, select: { id: true, source: true, chatId: true, sourceRef: true, state: true, chat: { select: { vocLink: { select: { vocId: true } } } } } })
  if (!item) return NextResponse.json({ error: '등록대기 항목을 찾을 수 없습니다.' }, { status: 404 })
  if (item.state !== 'PENDING') return NextResponse.json({ error: '이미 처리된 항목입니다.' }, { status: 409 })
  if (item.chat?.vocLink) return NextResponse.json({ error: '이 상담은 이미 VOC에 연결돼 있습니다. 새로고침하세요.' }, { status: 409 })

  const body = await request.json().catch(() => ({}))
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 })
  let hospitalCode: string | null = null
  if (typeof body.hospitalCode === 'string' && body.hospitalCode) {
    const h = await prisma.hospital.findUnique({ where: { hospitalCode: body.hospitalCode }, select: { hospitalCode: true } })
    if (!h) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 400 })
    hospitalCode = h.hospitalCode
  }
  async function codeOf(category: string, v: unknown, label: string): Promise<number | null> {
    if (typeof v !== 'number') return null
    const row = await prisma.statusCode.findFirst({ where: { id: v, category }, select: { id: true } })
    if (!row) throw new Error(`${label}이(가) 올바르지 않습니다.`)
    return row.id
  }
  let channelId: number | null, vocTypeId: number | null, statusId: number | null
  try {
    channelId = await codeOf('VOC_CHANNEL', body.channelId, '접수 채널')
    vocTypeId = await codeOf('VOC_TYPE', body.vocTypeId, 'VOC 분류')
    statusId = await codeOf('VOC_STATUS', body.statusId, '상태')
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }) }
  if (!vocTypeId) return NextResponse.json({ error: 'VOC 분류를 선택하세요.' }, { status: 400 })
  const receivedAt = body.receivedAt ? new Date(body.receivedAt) : new Date()
  if (isNaN(receivedAt.getTime())) return NextResponse.json({ error: '접수 일시가 올바르지 않습니다.' }, { status: 400 })
  const resolvedAt = body.resolvedAt ? new Date(body.resolvedAt) : null
  if (resolvedAt && isNaN(resolvedAt.getTime())) return NextResponse.json({ error: '완료일이 올바르지 않습니다.' }, { status: 400 })

  const r = await createVocFromImport({
    title, hospitalCode,
    hospitalNameRaw: typeof body.hospitalNameRaw === 'string' && body.hospitalNameRaw.trim() ? body.hospitalNameRaw.trim() : null,
    content: typeof body.content === 'string' && body.content.trim() ? body.content.trim() : null,
    resolution: plainToHtml(typeof body.resolution === 'string' ? body.resolution : null),
    channelId, vocTypeId, statusId, receivedAt, resolvedAt,
    source: item.source === 'SHEET' ? 'SHEET' : 'CHANNELTALK',
    sourceRef: item.sourceRef,
    vocCode: item.source === 'SHEET' ? await createVocCodeAllocator().allocate(receivedAt) : null, // 시트 이력은 적재분과 같이 접수 월 기준 코드

    chatId: item.chatId, linkReason: 'MANUAL', linkedById: user.userId,
  }, user.userId)
  await prisma.vocIntakeItem.update({ where: { id }, data: { state: 'REGISTERED', vocId: r.id, decidedById: user.userId, decidedAt: new Date(), failClass: null } })
  await logAudit({ req: request, actor: auditActorFromJWT(user), action: 'CREATE', resource: 'voc_receipt', resourceId: r.vocCode, resourceLabel: `${r.vocCode} ${title} (등록대기 #${id}${item.chatId ? ` — 채널톡 상담 ${item.chatId}` : item.sourceRef ? ` — ${item.sourceRef}` : ''})` })
  if (r.ticketStatus !== 'CLOSED' && r.ticketStatus !== 'RESOLVED') {
    syncTicketClocksSafe(r.ticketId)
    notifyTicketCreated({ ticketId: r.ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})
  }
  return NextResponse.json({ id: r.id, vocCode: r.vocCode }, { status: 201 })
}
