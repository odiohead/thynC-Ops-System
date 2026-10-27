/** 등록대기 [AS 아님] — IGNORED(사유). 재태깅돼도 재진입하지 않음. body { reason: PROGRESS|ACCESSORY|DUPLICATE|OTHER, undo?: true } */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { AS_INTAKE_IGNORE_REASONS } from '@/lib/channeltalk/asIntakeShared'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })
  const body = await request.json().catch(() => ({}))
  const link = await prisma.asIntakeLink.findUnique({ where: { id }, select: { state: true, chatId: true, receiptId: true } })
  if (!link) return NextResponse.json({ error: '등록대기 항목을 찾을 수 없습니다.' }, { status: 404 })
  if (body.undo === true) {
    if (link.state !== 'IGNORED') return NextResponse.json({ error: '제외 상태가 아닙니다.' }, { status: 409 })
    await prisma.asIntakeLink.update({ where: { id }, data: { state: 'PENDING', ignoreReason: null, decidedById: user.userId, decidedAt: new Date() } })
    return NextResponse.json({ ok: true, state: 'PENDING' })
  }
  if (link.state !== 'PENDING') return NextResponse.json({ error: '이미 처리된 항목입니다.' }, { status: 409 })
  const reason = String(body.reason ?? '')
  if (!(AS_INTAKE_IGNORE_REASONS as readonly string[]).includes(reason)) return NextResponse.json({ error: '사유를 선택하세요.' }, { status: 400 })
  await prisma.asIntakeLink.update({ where: { id }, data: { state: 'IGNORED', ignoreReason: reason, decidedById: user.userId, decidedAt: new Date() } })
  await logAudit({ req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'as_intake_link', resourceId: String(id), resourceLabel: `등록대기 제외 (${reason}) — 채널톡 상담 ${link.chatId}` })
  return NextResponse.json({ ok: true, state: 'IGNORED' })
}
