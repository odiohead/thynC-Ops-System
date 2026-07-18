import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { TOOL_LABELS } from '@/lib/ai/tools'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

/** 세션 메시지 전체 조회 — 본인 세션만 */
export async function GET(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const session = await prisma.aiChatSession.findUnique({
    where: { id: params.id },
    include: { hospital: { select: { hospitalName: true } } },
  })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (session.userId !== authUser.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const messages = await prisma.aiChatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, content: true, toolCalls: true, createdAt: true },
  })

  return NextResponse.json({
    session: {
      id: session.id,
      title: session.title,
      hospitalCode: session.hospitalCode,
      hospitalName: session.hospital?.hospitalName ?? null,
    },
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      // 도구 호출 기록 → 표시용 라벨 (UI의 "🔍 ... 중" 라인 복원)
      tools: Array.isArray(m.toolCalls)
        ? (m.toolCalls as { name?: string }[]).map((t) => TOOL_LABELS[t.name ?? ''] ?? t.name ?? '조회')
        : [],
      createdAt: m.createdAt,
    })),
  })
}

/** 세션 삭제 — 본인 또는 ADMIN */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const session = await prisma.aiChatSession.findUnique({ where: { id: params.id } })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (session.userId !== authUser.userId && !isAdminOrAbove(authUser.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await prisma.aiChatSession.delete({ where: { id: params.id } })
  return new NextResponse(null, { status: 204 })
}
