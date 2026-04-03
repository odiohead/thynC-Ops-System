import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = Math.max(1, parseInt(searchParams.get('limit') ?? '20'))

  const where = search
    ? { user: { OR: [{ name: { contains: search } }, { email: { contains: search } }] } }
    : undefined

  const [data, total] = await Promise.all([
    prisma.fieldEngineer.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            organization: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.fieldEngineer.count({ where }),
  ])

  return NextResponse.json({ data, total, page, limit })
}

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser(req)
  if (!authUser || !isAdminOrAbove(authUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId가 필요합니다.' }, { status: 400 })

  const existing = await prisma.fieldEngineer.findUnique({ where: { userId } })
  if (existing) return NextResponse.json({ error: '이미 등록된 필드 엔지니어입니다.' }, { status: 409 })

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    include: { organization: { select: { code: true } } },
  })
  if (!targetUser) return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 })
  if (targetUser.organization?.code !== 'SEERS') {
    return NextResponse.json({ error: 'SEERS 소속 사용자만 등록할 수 있습니다.' }, { status: 400 })
  }

  const fieldEngineer = await prisma.fieldEngineer.create({
    data: { userId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          organization: { select: { name: true } },
          department: { select: { name: true } },
        },
      },
    },
  })
  return NextResponse.json(fieldEngineer, { status: 201 })
}
