import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = Math.max(1, parseInt(searchParams.get('limit') ?? '20'))

  const registeredIds = await prisma.fieldEngineer.findMany({ select: { userId: true } })
  const registeredUserIds = registeredIds.map((fe) => fe.userId)

  const where = {
    organization: { code: 'SEERS' },
    isActive: true,
    id: { notIn: registeredUserIds.length > 0 ? registeredUserIds : [''] },
    ...(search
      ? { OR: [{ name: { contains: search } }, { email: { contains: search } }] }
      : {}),
  }

  const [data, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        organization: { select: { name: true } },
        department: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.user.count({ where }),
  ])

  return NextResponse.json({ data, total, page, limit })
}
