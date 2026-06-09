import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

type Ctx = { params: { id: string; refId: string } }

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const ref = await prisma.wikiPageReference.findUnique({
    where: { id: params.refId },
    select: { id: true, pageId: true },
  })
  if (!ref || ref.pageId !== params.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await prisma.wikiPageReference.delete({ where: { id: params.refId } })
  return new NextResponse(null, { status: 204 })
}
