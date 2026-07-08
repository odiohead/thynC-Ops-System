import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * 출고 시 병원 연결 후 그 병원의 진행 업무(프로젝트/유지보수/기타업무)를 드롭다운용으로 반환.
 * function_wms.md §6-1
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const hospitalCode = new URL(req.url).searchParams.get('hospitalCode')
  if (!hospitalCode) return NextResponse.json({ works: [] })

  const [projects, maintenances, etcLinks] = await Promise.all([
    prisma.project.findMany({
      where: { hospitalCode },
      select: { projectCode: true, projectName: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.maintenance.findMany({
      where: { hospitalCode },
      select: { maintenanceCode: true, title: true },
      orderBy: { reportedAt: 'desc' },
      take: 50,
    }),
    prisma.etcTaskHospital.findMany({
      where: { hospitalCode },
      select: { etcTask: { select: { etcTaskCode: true, title: true } } },
      orderBy: { etcTaskId: 'desc' },
      take: 50,
    }),
  ])

  const works = [
    ...projects.map((p) => ({ workType: 'PROJECT', refCode: p.projectCode, label: `[프로젝트] ${p.projectName}` })),
    ...maintenances.map((m) => ({ workType: 'MAINTENANCE', refCode: m.maintenanceCode, label: `[유지보수] ${m.title}` })),
    ...etcLinks
      .filter((e) => e.etcTask?.etcTaskCode)
      .map((e) => ({ workType: 'ETC', refCode: e.etcTask!.etcTaskCode!, label: `[기타업무] ${e.etcTask!.title}` })),
  ].filter((w) => w.refCode)

  return NextResponse.json({ works })
}
