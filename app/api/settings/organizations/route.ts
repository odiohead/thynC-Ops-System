import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const organizations = await prisma.organization.findMany({
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { users: true } } },
  })

  return NextResponse.json({ organizations })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, code, sortOrder, isActive } = await request.json()

  if (!name?.trim() || !code?.trim()) {
    return NextResponse.json({ error: '이름과 코드는 필수입니다.' }, { status: 400 })
  }

  const existing = await prisma.organization.findUnique({ where: { code: code.trim() } })
  if (existing) {
    return NextResponse.json({ error: '이미 사용 중인 코드입니다.' }, { status: 409 })
  }

  const organization = await prisma.organization.create({
    data: {
      name: name.trim(),
      code: code.trim().toUpperCase(),
      sortOrder: sortOrder ?? 0,
      isActive: isActive !== false,
    },
    include: { _count: { select: { users: true } } },
  })

  return NextResponse.json({ organization }, { status: 201 })
}
