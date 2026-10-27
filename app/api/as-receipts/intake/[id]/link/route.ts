/** 등록대기 [기존 접수에 연결] — 생성 없이 LINKED. body { receiptId } (ALREADY_EXISTS 후보 또는 사용자가 고른 접수) */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { appendAsNote } from '@/lib/asReceiptShared'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  const body = await request.json().catch(() => ({}))
  const receiptId = Number(body.receiptId)
  if (isNaN(id) || !Number.isInteger(receiptId)) return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  const link = await prisma.asIntakeLink.findUnique({ where: { id }, select: { state: true, chatId: true, chat: { select: { vocLink: { select: { vocId: true } } } } } })
  if (!link) return NextResponse.json({ error: '등록대기 항목을 찾을 수 없습니다.' }, { status: 404 })
  if (link.state !== 'PENDING') return NextResponse.json({ error: '이미 처리된 항목입니다.' }, { status: 409 })
  const rec = await prisma.asReceipt.findUnique({ where: { id: receiptId }, select: { id: true, asCode: true, note: true, vocId: true } })
  if (!rec) return NextResponse.json({ error: '접수를 찾을 수 없습니다.' }, { status: 404 })
  await prisma.$transaction([
    prisma.asReceipt.update({ where: { id: rec.id }, data: { note: appendAsNote(rec.note, `[채널톡 상담 ${link.chatId}] 등록대기에서 기존 접수 연결`), vocId: rec.vocId ?? link.chat.vocLink?.vocId ?? null } }),
    prisma.asIntakeLink.update({ where: { id }, data: { state: 'LINKED', receiptId: rec.id, decidedById: user.userId, decidedAt: new Date(), failClass: null } }),
  ])
  await logAudit({ req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'as_receipt', resourceId: rec.asCode, resourceLabel: `${rec.asCode} 채널톡 상담 연결 (등록대기 ${id})` })
  return NextResponse.json({ ok: true, receiptId: rec.id, asCode: rec.asCode })
}
