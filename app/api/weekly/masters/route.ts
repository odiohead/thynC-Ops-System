import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { checkWeeklyAccess, WEEKLY_ALLOWED_ORG_CODES } from '@/lib/weeklyAccess'
import type { WeeklyMastersResponse } from '@/lib/weekly'

export const dynamic = 'force-dynamic'

/**
 * 주간업무 폼 마스터 — 병원·담당자(SEERS 활성 사용자)·담당 팀(SEERS 부서) (weekly_ops_design.md §5)
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkWeeklyAccess(user)
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const [hospitals, users, teams] = await Promise.all([
    prisma.hospital.findMany({
      select: { hospitalCode: true, hospitalName: true },
      orderBy: { hospitalName: 'asc' },
    }),
    prisma.user.findMany({
      where: { isActive: true, organization: { code: { in: [...WEEKLY_ALLOWED_ORG_CODES] } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.department.findMany({
      where: { organization: { code: { in: [...WEEKLY_ALLOWED_ORG_CODES] } } },
      select: { id: true, name: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
  ])

  const response: WeeklyMastersResponse = { hospitals, users, teams }
  return NextResponse.json(response)
}
