/** POST /api/channeltalk/chats/[id]/exclude { excluded: boolean } — 자동 승격 수동 제외/해제 (USER 이상). 연결된 상담은 제외 불가 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isUserOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isUserOrAbove(user.role)) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  const excluded = body.excluded === true
  const chat = await prisma.channeltalkUserChat.findUnique({ where: { id: params.id }, select: { id: true, vocExcludedAt: true, vocLink: { select: { vocId: true } } } })
  if (!chat) return NextResponse.json({ error: '상담을 찾을 수 없습니다.' }, { status: 404 })
  if (excluded && chat.vocLink) return NextResponse.json({ error: 'VOC에 연결된 상담은 제외할 수 없습니다.' }, { status: 409 })
  const updated = await prisma.channeltalkUserChat.update({
    where: { id: chat.id },
    data: excluded ? { vocExcludedAt: new Date(), vocExcludedById: user.userId } : { vocExcludedAt: null, vocExcludedById: null },
    select: { vocExcludedAt: true, vocExcludedBy: { select: { id: true, name: true } } },
  })
  await logAudit({ req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'channeltalk_chat', resourceId: chat.id, resourceLabel: `채널톡 상담 VOC ${excluded ? '제외' : '제외 해제'}`, before: { excluded: !!chat.vocExcludedAt }, after: { excluded } })
  return NextResponse.json(updated)
}
