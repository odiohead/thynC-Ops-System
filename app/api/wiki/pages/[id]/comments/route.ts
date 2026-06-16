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
    select: { id: true, title: true, authorId: true, lastEditorId: true },
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

  // 알림: 페이지 작성자 + 최근 수정자에게 (본인 제외, 중복 제거). 비차단
  const recipients = new Set<string>()
  if (page.authorId && page.authorId !== authUser.userId) recipients.add(page.authorId)
  if (page.lastEditorId && page.lastEditorId !== authUser.userId) recipients.add(page.lastEditorId)
  if (recipients.size > 0) {
    prisma.wikiNotification
      .createMany({
        data: Array.from(recipients).map((uid) => ({
          userId: uid,
          pageId: params.id,
          type: 'comment',
          actorId: authUser.userId,
          actorName: authUser.name,
          pageTitle: page.title,
        })),
      })
      .catch((e) => console.error('[wiki] 알림 생성 실패:', e))
  }

  return NextResponse.json({ comment: created }, { status: 201 })
}
