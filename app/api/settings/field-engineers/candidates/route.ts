import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'

const VALID_WORK_TYPES = ['PROJECT', 'INSTALL_PLAN', 'MAINTENANCE'] as const
type WorkType = typeof VALID_WORK_TYPES[number]

function parseWorkType(raw: string | null): WorkType {
  if (raw && (VALID_WORK_TYPES as readonly string[]).includes(raw)) return raw as WorkType
  return 'PROJECT'
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = Math.max(1, parseInt(searchParams.get('limit') ?? '20'))
  const workType = parseWorkType(searchParams.get('workType'))

  const registeredIds = await prisma.fieldEngineer.findMany({
    where: { workType },
    select: { userId: true },
  })
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
