import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// 역할 멤버 추가 후보 검색 (SUPER_ADMIN 전용) — 활성 사용자 중 해당 역할 미보유자

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user || !isSuperAdmin(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const roleId = parseInt(searchParams.get('roleId') ?? '')
  const search = searchParams.get('search') ?? ''
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = Math.max(1, parseInt(searchParams.get('limit') ?? '10'))

  if (isNaN(roleId)) return NextResponse.json({ error: 'roleId가 필요합니다.' }, { status: 400 })

  // 이미 이 역할을 보유한 사용자 제외
  const registered = await prisma.appUserRole.findMany({
    where: { roleId },
    select: { userId: true },
  })
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
