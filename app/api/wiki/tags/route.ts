import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') ?? '').trim()

  const tags = await prisma.wikiTag.findMany({
    where: q ? { name: { contains: q, mode: 'insensitive' } } : {},
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { pages: true } } },
  })

  return NextResponse.json({ tags })
}

export async function POST(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { name, color } = body as { name?: string; color?: string }
  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  try {
    const tag = await prisma.wikiTag.create({
      data: { name: name.trim(), color: color ?? null },
      select: { id: true, name: true, color: true },
    })
    return NextResponse.json({ tag }, { status: 201 })
  } catch (e) {
    const err = e as { code?: string }
    if (err.code === 'P2002') return NextResponse.json({ error: '이미 존재하는 태그명입니다.' }, { status: 409 })
    throw e
  }
}
