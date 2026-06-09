import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'

type Ctx = { params: { id: string } }

export async function PUT(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await prisma.wikiComment.findUnique({ where: { id: params.id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // 본인 댓글이거나 ADMIN 이상만 수정 가능
  if (existing.authorId !== authUser.userId && !isAdminOrAbove(authUser.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const text = (body.body as string | undefined)?.trim()
  if (!text) return NextResponse.json({ error: 'body 필수' }, { status: 400 })

  const updated = await prisma.wikiComment.update({
    where: { id: params.id },
    data: { body: text },
    select: {
      id: true,
      body: true,
      updatedAt: true,
      author: { select: { id: true, name: true } },
    },
  })
  return NextResponse.json({ comment: updated })
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await prisma.wikiComment.findUnique({ where: { id: params.id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (existing.authorId !== authUser.userId && !isAdminOrAbove(authUser.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await prisma.wikiComment.delete({ where: { id: params.id } })
  return new NextResponse(null, { status: 204 })
}
