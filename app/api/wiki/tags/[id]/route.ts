import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

type Ctx = { params: { id: string } }

export async function PUT(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { name, color, sortOrder } = body as { name?: string; color?: string | null; sortOrder?: number }

  try {
    const tag = await prisma.wikiTag.update({
      where: { id: params.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(color !== undefined && { color }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
    })
    return NextResponse.json({ tag })
  } catch (e) {
    const err = e as { code?: string }
    if (err.code === 'P2002') return NextResponse.json({ error: '이미 존재하는 태그명' }, { status: 409 })
    if (err.code === 'P2025') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    throw e
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await prisma.wikiTag.delete({ where: { id: params.id } }).catch((e) => {
    if ((e as { code?: string }).code === 'P2025') return null
    throw e
  })
  return new NextResponse(null, { status: 204 })
}
