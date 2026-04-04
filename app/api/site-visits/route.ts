import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

const PAGE_SIZE = 20

const include = {
  hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true, address: true } },
  daewoongUser: { select: { id: true, name: true } },
  assignees: { include: { user: { select: { id: true, name: true } } } },
  status: { select: { id: true, name: true, color: true } },
  files: { orderBy: { uploadedAt: 'asc' as const } },
} as const

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = parseInt(searchParams.get('limit') ?? String(PAGE_SIZE))
  const hospitalCode = searchParams.get('hospitalCode') ?? ''

  const where = {
    ...(hospitalCode && { hospitalCode }),
  }

  const [siteVisits, total] = await Promise.all([
    prisma.siteVisit.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include,
    }),
    prisma.siteVisit.count({ where }),
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
    daewoongUserId,
    assigneeIds,
    requestDate,
    visitDate,
    replyDate,
    statusId,
    notes,
    files,
  } = body

  if (!hospitalCode) {
    return NextResponse.json({ error: '병원을 선택해주세요.' }, { status: 400 })
  }

  const siteVisit = await prisma.siteVisit.create({
    data: {
      hospitalCode,
      daewoongUserId: daewoongUserId || null,
      requestDate: requestDate ? new Date(requestDate) : null,
      visitDate: visitDate ? new Date(visitDate) : null,
      replyDate: replyDate ? new Date(replyDate) : null,
      statusId: statusId ? Number(statusId) : null,
      notes: notes || null,
      ...(Array.isArray(files) && files.length > 0 && {
        files: {
          create: files.map((f: { fileCategory: string; s3Key: string; fileName: string }) => ({
            fileCategory: f.fileCategory,
            fileName: f.fileName,
            s3Key: f.s3Key,
          })),
        },
      }),
    },
    include,
  })

  // assignees 생성
  if (Array.isArray(assigneeIds) && assigneeIds.length > 0) {
    await prisma.siteVisitAssignee.createMany({
      data: assigneeIds.map((userId: string) => ({
        siteVisitId: siteVisit.id,
        userId,
      })),
    })
  }

  return NextResponse.json({ siteVisit }, { status: 201 })
}
