import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [items, unreadCount] = await Promise.all([
    prisma.wikiNotification.findMany({
      where: { userId: authUser.userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        type: true,
        pageId: true,
        pageTitle: true,
        actorName: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.wikiNotification.count({ where: { userId: authUser.userId, readAt: null } }),
  ])

  return NextResponse.json({ items, unreadCount })
}

// 읽음 처리: { ids?: string[] } 없으면 전체 읽음
export async function PATCH(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const ids = Array.isArray(body.ids) ? (body.ids as string[]) : null

  await prisma.wikiNotification.updateMany({
    where: {
      userId: authUser.userId,
      readAt: null,
      ...(ids ? { id: { in: ids } } : {}),
    },
    data: { readAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
