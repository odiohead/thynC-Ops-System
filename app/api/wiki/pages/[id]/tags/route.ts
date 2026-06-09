import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

type Ctx = { params: { id: string } }

export async function GET(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rels = await prisma.wikiPageTag.findMany({
    where: { pageId: params.id },
    orderBy: { addedAt: 'asc' },
    include: { tag: true },
  })
  return NextResponse.json({ tags: rels.map((r) => r.tag) })
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { tagId, name } = body as { tagId?: string; name?: string }

  // 새 이름으로 생성 또는 기존 tagId 사용
  let resolvedTagId = tagId
  if (!resolvedTagId && name?.trim()) {
    const existing = await prisma.wikiTag.findUnique({ where: { name: name.trim() } })
    if (existing) {
      resolvedTagId = existing.id
    } else {
      const created = await prisma.wikiTag.create({
        data: { name: name.trim() },
        select: { id: true },
      })
      resolvedTagId = created.id
    }
  }
  if (!resolvedTagId) {
    return NextResponse.json({ error: 'tagId 또는 name 필수' }, { status: 400 })
  }

  try {
    await prisma.wikiPageTag.create({ data: { pageId: params.id, tagId: resolvedTagId } })
  } catch (e) {
    const err = e as { code?: string }
    if (err.code === 'P2002') return NextResponse.json({ error: '이미 연결됨' }, { status: 409 })
    if (err.code === 'P2003') return NextResponse.json({ error: '페이지 또는 태그가 존재하지 않음' }, { status: 404 })
    throw e
  }

  const tag = await prisma.wikiTag.findUnique({ where: { id: resolvedTagId } })
  return NextResponse.json({ tag }, { status: 201 })
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const tagId = searchParams.get('tagId')
  if (!tagId) return NextResponse.json({ error: 'tagId 필수' }, { status: 400 })

  await prisma.wikiPageTag
    .delete({ where: { pageId_tagId: { pageId: params.id, tagId } } })
    .catch((e) => {
      if ((e as { code?: string }).code === 'P2025') return null
      throw e
    })
  return new NextResponse(null, { status: 204 })
}
