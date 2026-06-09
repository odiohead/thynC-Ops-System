import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const favorites = await prisma.wikiFavorite.findMany({
    where: { userId: authUser.userId },
    orderBy: { createdAt: 'desc' },
    select: {
      createdAt: true,
      page: {
        select: {
          id: true,
          title: true,
          updatedAt: true,
          author: { select: { name: true } },
          lastEditor: { select: { name: true } },
        },
      },
    },
  })

  return NextResponse.json({
    favorites: favorites.map((f) => ({ favoritedAt: f.createdAt, ...f.page })),
  })
}
