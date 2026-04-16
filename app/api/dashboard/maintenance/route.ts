import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const IN_PROGRESS_STATUSES = ['접수', '처리중']

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 진행중 건수 (접수 + 처리중)
  const inProgressCount = await prisma.maintenance.count({
    where: {
      status: { name: { in: IN_PROGRESS_STATUSES } },
    },
  })

  // 상태별 세부 건수
  const statusCounts = await prisma.$queryRaw<
    { name: string; count: bigint }[]
  >`
    SELECT sc.name, COUNT(*)::bigint as count
    FROM maintenances m
    JOIN status_codes sc ON sc.id = m.status_id
    GROUP BY sc.name, sc.sort_order
    ORDER BY sc.sort_order
  `

  const byStatus = statusCounts.map((r) => ({
    status: r.name,
    count: Number(r.count),
  }))

  // 최근 12주 주간 등록건수 (reported_at 기준, 월요일 시작)
  const weeksAgo = 12
  const now = new Date()
  // 이번주 월요일 구하기
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayOfWeek = today.getDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const thisMonday = new Date(today)
  thisMonday.setDate(today.getDate() + mondayOffset)

  const startDate = new Date(thisMonday)
  startDate.setDate(thisMonday.getDate() - (weeksAgo - 1) * 7)

  const weeklyRaw = await prisma.$queryRaw<
    { week_start: Date; count: bigint }[]
  >`
    SELECT date_trunc('week', reported_at)::date as week_start, COUNT(*)::bigint as count
    FROM maintenances
    WHERE reported_at >= ${startDate}
    GROUP BY week_start
    ORDER BY week_start
  `

  // 12주 전체 슬롯 채우기 (데이터 없는 주도 0으로)
  const weekly: { weekStart: string; label: string; count: number }[] = []
  for (let i = 0; i < weeksAgo; i++) {
    const ws = new Date(startDate)
    ws.setDate(startDate.getDate() + i * 7)
    const key = ws.toISOString().slice(0, 10)
    const m = ws.getMonth() + 1
    const d = ws.getDate()
    const label = `${m}/${d}`

    const found = weeklyRaw.find(
      (r) => new Date(r.week_start).toISOString().slice(0, 10) === key
    )
    weekly.push({ weekStart: key, label, count: found ? Number(found.count) : 0 })
  }

  return NextResponse.json({ inProgressCount, byStatus, weekly })
}
