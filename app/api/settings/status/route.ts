import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const [statusCodes, grouped] = await Promise.all([
    prisma.statusCode.findMany({ orderBy: { order: 'asc' } }),
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
  const { name, order } = await request.json()

  if (!name?.trim()) {
    return NextResponse.json({ error: '상태명을 입력해주세요.' }, { status: 400 })
  }

  const existing = await prisma.statusCode.findUnique({ where: { name } })
  if (existing) {
    return NextResponse.json({ error: '이미 존재하는 상태명입니다.' }, { status: 409 })
  }

  const statusCode = await prisma.statusCode.create({
    data: { name: name.trim(), order: order ?? 0 },
  })

  return NextResponse.json({ statusCode }, { status: 201 })
}
