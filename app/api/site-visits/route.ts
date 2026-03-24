import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

const PAGE_SIZE = 20

const include = {
  hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true } },
  daewoongUser: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  status: { select: { id: true, name: true, color: true } },
} as const

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = parseInt(searchParams.get('limit') ?? String(PAGE_SIZE))

  const [siteVisits, total] = await Promise.all([
    prisma.siteVisit.findMany({
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include,
    }),
    prisma.siteVisit.count(),
  ])

  return NextResponse.json({
    siteVisits,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const {
    hospitalCode,
    daewoongStaffId,
    assigneeId,
    requestDate,
    visitDate,
    replyDate,
    statusId,
    installPlanUrl,
    installPlanFileId,
    floorPlanUrl,
    floorPlanFileId,
    notes,
  } = body

  if (!hospitalCode) {
    return NextResponse.json({ error: '병원을 선택해주세요.' }, { status: 400 })
  }

  const siteVisit = await prisma.siteVisit.create({
    data: {
      hospitalCode,
      daewoongUserId: daewoongStaffId || null,
      assigneeId: assigneeId || null,
      requestDate: requestDate ? new Date(requestDate) : null,
      visitDate: visitDate ? new Date(visitDate) : null,
      replyDate: replyDate ? new Date(replyDate) : null,
      statusId: statusId ? Number(statusId) : null,
      installPlanUrl: installPlanUrl || null,
      installPlanFileId: installPlanFileId || null,
      floorPlanUrl: floorPlanUrl || null,
      floorPlanFileId: floorPlanFileId || null,
      notes: notes || null,
    },
    include,
  })

  return NextResponse.json({ siteVisit }, { status: 201 })
}
