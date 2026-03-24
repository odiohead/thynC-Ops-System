import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function GET() {
  const [buildStatuses, grouped] = await Promise.all([
    prisma.buildStatus.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.project.groupBy({ by: ['buildStatusId'], _count: { id: true } }),
  ])

  const usageMap = new Map(
    grouped
      .filter((g) => g.buildStatusId !== null)
      .map((g) => [g.buildStatusId!, g._count.id])
  )

  return NextResponse.json({
    buildStatuses: buildStatuses.map((bs) => ({
      ...bs,
      usageCount: usageMap.get(bs.id) ?? 0,
    })),
  })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { label, color, sortOrder } = await request.json()

  if (!label?.trim()) {
    return NextResponse.json({ error: '상태명을 입력해주세요.' }, { status: 400 })
  }

  const buildStatus = await prisma.buildStatus.create({
    data: { label: label.trim(), color: color ?? null, sortOrder: sortOrder ?? 0 },
  })

  return NextResponse.json({ buildStatus }, { status: 201 })
}
