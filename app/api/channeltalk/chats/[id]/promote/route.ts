/** POST /api/channeltalk/chats/[id]/promote — 상담을 VOC로 수동 승격 (USER 이상). 컷오버·태그 조건 무시(사용자 판단), 이미 연결이면 409 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isUserOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { promoteChat } from '@/lib/channeltalk/vocPromote'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isUserOrAbove(user.role)) return NextResponse.json({ error: 'VOC 생성 권한이 없습니다.' }, { status: 403 })
  const chat = await prisma.channeltalkUserChat.findUnique({ where: { id: params.id }, select: { id: true, vocLink: { select: { voc: { select: { vocCode: true } } } } } })
  if (!chat) return NextResponse.json({ error: '상담을 찾을 수 없습니다.' }, { status: 404 })
  if (chat.vocLink) return NextResponse.json({ error: `이미 ${chat.vocLink.voc.vocCode}에 연결된 상담입니다.` }, { status: 409 })
  try {
    const r = await promoteChat(chat.id, { actorId: user.userId, manual: true })
    await prisma.channeltalkUserChat.update({ where: { id: chat.id }, data: { vocExcludedAt: null, vocExcludedById: null } })
    await logAudit({ req: request, actor: auditActorFromJWT(user), action: 'CREATE', resource: 'voc_receipt', resourceId: r.vocCode, resourceLabel: `${r.vocCode} (채널톡 상담 ${chat.id} 수동 승격)`, after: { chatId: chat.id, reason: r.reason } })
    return NextResponse.json(r, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '승격 실패' }, { status: 400 })
  }
}
