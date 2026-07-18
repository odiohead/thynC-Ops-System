import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/** 내 AI 어시스턴트 세션 목록 (최근순 50개) */
export async function GET(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sessions = await prisma.aiChatSession.findMany({
    where: { userId: authUser.userId },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      title: true,
      hospitalCode: true,
      hospital: { select: { hospitalName: true } },
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  })

  return NextResponse.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.title || '(제목 없음)',
      hospitalCode: s.hospitalCode,
      hospitalName: s.hospital?.hospitalName ?? null,
      updatedAt: s.updatedAt,
      messageCount: s._count.messages,
    })),
  })
}
