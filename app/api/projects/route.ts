import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const PAGE_SIZE = 20

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = parseInt(searchParams.get('limit') ?? String(PAGE_SIZE))
  const hospitalCode = searchParams.get('hospitalCode') ?? ''
  const isCompletedParam = searchParams.get('isCompleted')

  const where = {
    ...(hospitalCode && { hospitalCode }),
    ...(isCompletedParam !== null && { isCompleted: isCompletedParam === 'true' }),
  }

  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        hospital: {
          select: {
            hospitalCode: true,
            hospitalName: true,
            hiraHospitalName: true,
            sidoName: true,
            sigunguName: true,
          },
        },
        builder: {
          select: { id: true, name: true, email: true },
        },
        contractor: {
          select: { id: true, code: true, name: true },
        },
        devices: {
          include: { deviceInfo: true },
          orderBy: { deviceInfo: { sortOrder: 'asc' } },
        },
        files: {
          orderBy: { uploadedAt: 'asc' },
        },
      },
    }),
    prisma.project.count({ where }),
  ])

  return NextResponse.json({
    projects,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const {
    hospitalCode,
    contractDate,
    wardCount,
    bedCount,
    gatewayCount,
    hasSurvey,
    hasOrder,
    builderUserId,
    builderNameManual,
    constructorId,
    startDate,
    endDateExpected,
    isCompleted,
    issueNote,
  } = body

  if (!hospitalCode?.trim()) {
    return NextResponse.json({ error: '병원 코드는 필수입니다.' }, { status: 400 })
  }

  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode } })
  if (!hospital) {
    return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })
  }

  // orderNumber: 해당 병원의 기존 프로젝트 수 + 1
  const existingCount = await prisma.project.count({ where: { hospitalCode } })
  const orderNumber = existingCount + 1

  // projectCode: PRJ-YYYYMM-NNNN
  const baseDate = contractDate ? new Date(contractDate) : new Date()
  const yyyymm = `${baseDate.getFullYear()}${String(baseDate.getMonth() + 1).padStart(2, '0')}`
  const prefix = `PRJ-${yyyymm}-`
  const existing = await prisma.project.findMany({
    where: { projectCode: { startsWith: prefix } },
    select: { projectCode: true },
  })
  const maxSeq = existing.reduce((max, p) => {
    const match = p.projectCode.match(/^PRJ-\d{6}-(\d{4})$/)
    return match ? Math.max(max, parseInt(match[1])) : max
  }, 0)
  const projectCode = `${prefix}${String(maxSeq + 1).padStart(4, '0')}`

  // projectName: "{hospitalName} {orderNumber}차"
  const hospitalName = hospital.hospitalName || hospital.hiraHospitalName
  const projectName = `${hospitalName} ${orderNumber}차`

  const project = await prisma.project.create({
    data: {
      projectCode,
      projectName,
      hospitalCode,
      orderNumber,
      contractDate: contractDate ? new Date(contractDate) : null,
      wardCount: wardCount != null ? Number(wardCount) : null,
      bedCount: bedCount != null ? Number(bedCount) : null,
      gatewayCount: gatewayCount != null ? Number(gatewayCount) : null,
      hasSurvey: hasSurvey ?? false,
      hasOrder: hasOrder ?? false,
      builderUserId: builderUserId ?? null,
      builderNameManual: builderNameManual ?? null,
      constructorId: constructorId ? Number(constructorId) : null,
      startDate: startDate ? new Date(startDate) : null,
      endDateExpected: endDateExpected ? new Date(endDateExpected) : null,
      isCompleted: isCompleted ?? false,
      issueNote: issueNote ?? null,
    },
    include: {
      hospital: true,
      builder: { select: { id: true, name: true, email: true } },
    },
  })

  return NextResponse.json({ project }, { status: 201 })
}
