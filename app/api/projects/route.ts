import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createDriveFolder } from '@/lib/googleDrive'

const PAGE_SIZE = 20

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = parseInt(searchParams.get('limit') ?? String(PAGE_SIZE))
  const hospitalCode = searchParams.get('hospitalCode') ?? ''

  const where = {
    ...(hospitalCode && { hospitalCode }),
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
        buildStatus: {
          select: { id: true, label: true, color: true },
        },
        devices: {
          include: {
            deviceInfo: {
              select: { deviceModel: true, deviceName: true, sortOrder: true },
            },
          },
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
    buildStatusId,
    issueNote,
  } = body

  if (!hospitalCode?.trim()) {
    return NextResponse.json({ error: '병원 코드는 필수입니다.' }, { status: 400 })
  }

  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode } })
  if (!hospital) {
    return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })
  }

  const hospitalMeta = await prisma.hospitalMeta.findUnique({ where: { hospitalCode } })
  if (!hospitalMeta?.driveProjectFolderId) {
    return NextResponse.json(
      { error: '해당 병원에 Drive 프로젝트 폴더가 설정되어 있지 않습니다. 병원 상세 페이지에서 먼저 Drive 폴더를 등록해 주세요.' },
      { status: 400 }
    )
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
      buildStatusId: buildStatusId ? Number(buildStatusId) : null,
      issueNote: issueNote ?? null,
    },
    include: {
      hospital: true,
      builder: { select: { id: true, name: true, email: true } },
    },
  })

  // Drive 폴더 자동 생성
  let driveFolderId: string | null = null
  let driveWarning: string | undefined
  try {
    const folderName = `${projectCode}_${hospitalName}`
    driveFolderId = await createDriveFolder(folderName, hospitalMeta.driveProjectFolderId)
    await prisma.project.update({ where: { id: project.id }, data: { driveFolderId } })
  } catch (e) {
    console.error('Drive folder creation failed:', e)
    driveWarning = 'Drive 폴더 생성에 실패했습니다. 프로젝트는 생성되었으나 파일 업로드를 위해 Drive 폴더를 수동으로 연결해주세요.'
  }

  return NextResponse.json(
    { project: { ...project, driveFolderId }, ...(driveWarning ? { driveWarning } : {}) },
    { status: 201 }
  )
}
