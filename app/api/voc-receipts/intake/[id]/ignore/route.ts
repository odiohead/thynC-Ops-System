/** 등록대기 [VOC 아님] — IGNORED(사유). body { reason: NOT_VOC|DUPLICATE|TEST|OTHER, undo?: true } */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { VOC_INTAKE_IGNORE_REASONS } from '@/lib/vocIntakeShared'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })
  const body = await request.json().catch(() => ({}))
  const item = await prisma.vocIntakeItem.findUnique({ where: { id }, select: { state: true, chatId: true, sourceRef: true } })
  if (!item) return NextResponse.json({ error: '등록대기 항목을 찾을 수 없습니다.' }, { status: 404 })
  if (body.undo === true) {
    if (item.state !== 'IGNORED') return NextResponse.json({ error: '제외 상태가 아닙니다.' }, { status: 409 })
    await prisma.vocIntakeItem.update({ where: { id }, data: { state: 'PENDING', ignoreReason: null, decidedById: user.userId, decidedAt: new Date() } })
    return NextResponse.json({ ok: true, state: 'PENDING' })
  }
  if (item.state !== 'PENDING') return NextResponse.json({ error: '이미 처리된 항목입니다.' }, { status: 409 })
  const reason = String(body.reason ?? '')
  if (!(VOC_INTAKE_IGNORE_REASONS as readonly string[]).includes(reason)) return NextResponse.json({ error: '사유를 선택하세요.' }, { status: 400 })
  await prisma.vocIntakeItem.update({ where: { id }, data: { state: 'IGNORED', ignoreReason: reason, decidedById: user.userId, decidedAt: new Date() } })
  await logAudit({ req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'voc_intake_item', resourceId: String(id), resourceLabel: `VOC 등록대기 제외 (${reason}) — ${item.chatId ? `채널톡 상담 ${item.chatId}` : item.sourceRef ?? ''}` })
  return NextResponse.json({ ok: true, state: 'IGNORED' })
}
