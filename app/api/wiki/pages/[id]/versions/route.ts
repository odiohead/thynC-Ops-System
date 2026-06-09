import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

type Ctx = { params: { id: string } }

export async function GET(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const versions = await prisma.wikiVersion.findMany({
    where: { pageId: params.id },
    orderBy: { savedAt: 'desc' },
    select: {
      id: true,
      title: true,
      savedAt: true,
      savedBy: { select: { id: true, name: true } },
    },
  })
  return NextResponse.json({ versions })
}
