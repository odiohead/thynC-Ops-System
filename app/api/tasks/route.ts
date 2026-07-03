import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search') ?? ''
  const taskType = searchParams.get('taskType') ?? ''

  const where = {
    ...(taskType && { taskType }),
    ...(search && {
      OR: [
        { title: { contains: search, mode: 'insensitive' as const } },
        { taskCode: { contains: search, mode: 'insensitive' as const } },
        { refCode: { contains: search, mode: 'insensitive' as const } },
        {
          hospital: {
            OR: [
              { hospitalName: { contains: search, mode: 'insensitive' as const } },
              { hiraHospitalName: { contains: search, mode: 'insensitive' as const } },
            ],
          },
        },
      ],
    }),
  }

  const tasks = await prisma.task.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true } },
    },
  })

  // 원본 레코드 id lookup (상세 페이지 이동용)
  const refCodes = tasks.map((t) => t.refCode)
  const [siteVisits, installPlans, maintenances, etcTasks] = await Promise.all([
    prisma.siteVisit.findMany({
      where: { siteVisitCode: { in: refCodes } },
      select: { id: true, siteVisitCode: true },
    }),
    prisma.installPlan.findMany({
      where: { planCode: { in: refCodes } },
      select: { id: true, planCode: true },
    }),
    prisma.maintenance.findMany({
      where: { maintenanceCode: { in: refCodes } },
      select: { id: true, maintenanceCode: true },
    }),
    prisma.etcTask.findMany({
      where: { etcTaskCode: { in: refCodes } },
      select: { id: true, etcTaskCode: true },
    }),
  ])

  const refIdMap = new Map<string, number>()
  for (const sv of siteVisits) if (sv.siteVisitCode) refIdMap.set(sv.siteVisitCode, sv.id)
  for (const ip of installPlans) if (ip.planCode) refIdMap.set(ip.planCode, ip.id)
  for (const m of maintenances) if (m.maintenanceCode) refIdMap.set(m.maintenanceCode, m.id)
  for (const e of etcTasks) if (e.etcTaskCode) refIdMap.set(e.etcTaskCode, e.id)

  const tasksWithRefId = tasks.map((t) => ({
    ...t,
    refId: refIdMap.get(t.refCode) ?? null,
  }))

  return NextResponse.json({ tasks: tasksWithRefId })
}
