import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

type Ctx = { params: { id: string } }

export async function GET(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const fav = await prisma.wikiFavorite.findUnique({
    where: { userId_pageId: { userId: authUser.userId, pageId: params.id } },
    select: { createdAt: true },
  })
  return NextResponse.json({ favorited: !!fav })
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await prisma.wikiFavorite.create({
      data: { userId: authUser.userId, pageId: params.id },
    })
  } catch (e) {
    const err = e as { code?: string }
    if (err.code === 'P2002') return NextResponse.json({ favorited: true })
    if (err.code === 'P2003') return NextResponse.json({ error: '페이지 없음' }, { status: 404 })
    throw e
  }
  return NextResponse.json({ favorited: true })
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.wikiFavorite
    .delete({ where: { userId_pageId: { userId: authUser.userId, pageId: params.id } } })
    .catch((e) => {
      if ((e as { code?: string }).code === 'P2025') return null
      throw e
    })
  return NextResponse.json({ favorited: false })
}
