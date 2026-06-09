import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

/**
 * @ mention 자동완성용 — 병원·프로젝트 검색 통합 결과.
 */
export async function GET(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') ?? '').trim()
  const LIMIT_PER_TYPE = 5

  const [hospitals, projects] = await Promise.all([
    prisma.hospital.findMany({
      where: q
        ? {
            OR: [
              { hospitalName: { contains: q, mode: 'insensitive' } },
              { hiraHospitalName: { contains: q, mode: 'insensitive' } },
              { hospitalCode: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {},
      take: LIMIT_PER_TYPE,
      orderBy: { hospitalName: 'asc' },
      select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true },
    }),
    prisma.project.findMany({
      where: q
        ? {
            OR: [
              { projectName: { contains: q, mode: 'insensitive' } },
              { projectCode: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {},
      take: LIMIT_PER_TYPE,
      orderBy: { projectName: 'asc' },
      select: { projectCode: true, projectName: true },
    }),
  ])

  const items = [
    ...hospitals.map((h) => ({
      type: 'hospital' as const,
      code: h.hospitalCode,
      label: h.hospitalName || h.hiraHospitalName,
    })),
    ...projects.map((p) => ({
      type: 'project' as const,
      code: p.projectCode,
      label: p.projectName,
    })),
  ]

  return NextResponse.json({ items })
}
