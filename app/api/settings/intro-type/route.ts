import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'

export async function GET() {
  const introTypes = await prisma.statusCode.findMany({
    where: { category: 'INTRO_TYPE' },
    orderBy: { order: 'asc' },
  })
  return NextResponse.json({ introTypes })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, order, color } = await request.json()

  if (!name?.trim()) {
    return NextResponse.json({ error: '도입형태명을 입력해주세요.' }, { status: 400 })
  }

  const existing = await prisma.statusCode.findFirst({ where: { name, category: 'INTRO_TYPE' } })
  if (existing) {
    return NextResponse.json({ error: '이미 존재하는 도입형태입니다.' }, { status: 409 })
  }

  const introType = await prisma.statusCode.create({
    data: { name: name.trim(), order: order ?? 0, color: color ?? null, category: 'INTRO_TYPE' },
  })

  return NextResponse.json({ introType }, { status: 201 })
}
