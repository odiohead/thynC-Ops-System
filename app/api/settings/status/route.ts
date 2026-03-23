import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function GET() {
  const [statusCodes, grouped] = await Promise.all([
    prisma.statusCode.findMany({ where: { category: 'HOSPITAL' }, orderBy: { order: 'asc' } }),
    prisma.hospital.groupBy({ by: ['status'], _count: { id: true } }),
  ])

  const usageMap = new Map(grouped.map((g) => [g.status, g._count.id]))

  return NextResponse.json({
    statusCodes: statusCodes.map((sc) => ({
      ...sc,
      usageCount: usageMap.get(sc.name) ?? 0,
    })),
  })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { name, order, color } = await request.json()

  if (!name?.trim()) {
    return NextResponse.json({ error: '상태명을 입력해주세요.' }, { status: 400 })
  }

  const existing = await prisma.statusCode.findFirst({ where: { name, category: 'HOSPITAL' } })
  if (existing) {
    return NextResponse.json({ error: '이미 존재하는 상태명입니다.' }, { status: 409 })
  }

  const statusCode = await prisma.statusCode.create({
    data: { name: name.trim(), order: order ?? 0, color: color ?? null, category: 'HOSPITAL' },
  })

  return NextResponse.json({ statusCode }, { status: 201 })
}
