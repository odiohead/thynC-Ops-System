import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

type Ctx = { params: { id: string } }

export async function GET(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const comments = await prisma.wikiComment.findMany({
    where: { pageId: params.id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      body: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, name: true } },
    },
  })
  return NextResponse.json({ comments })
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const text = (body.body as string | undefined)?.trim()
  if (!text) return NextResponse.json({ error: 'body 필수' }, { status: 400 })

  const page = await prisma.wikiPage.findUnique({
    where: { id: params.id },
    select: { id: true },
  })
  if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 })

  const created = await prisma.wikiComment.create({
    data: { pageId: params.id, authorId: authUser.userId, body: text },
    select: {
      id: true,
      body: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, name: true } },
    },
  })
  return NextResponse.json({ comment: created }, { status: 201 })
}
