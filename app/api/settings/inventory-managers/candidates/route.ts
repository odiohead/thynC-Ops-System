import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = Math.max(1, parseInt(searchParams.get('limit') ?? '20'))

  // 이미 등록된 재고 담당자 제외
  const registered = await prisma.inventoryManager.findMany({ select: { userId: true } })
  const registeredIds = registered.map((m) => m.userId)

  const where = {
    isActive: true,
    id: { notIn: registeredIds.length > 0 ? registeredIds : [''] },
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
