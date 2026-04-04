import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const hospitalCode = searchParams.get('hospitalCode') ?? ''
  const search = searchParams.get('search') ?? ''
  const buildStatusId = searchParams.get('buildStatusId') ?? ''
  const contractorId = searchParams.get('contractorId') ?? ''
  const builderId = searchParams.get('builderId') ?? ''
  const orderBy = searchParams.get('orderBy') ?? 'startDate'
  const order = (searchParams.get('order') ?? 'desc') as 'asc' | 'desc'

  // startDate DESC: null이 맨 위 (구축시작일 미입력 프로젝트 먼저)
  const startDateNulls = order === 'desc' ? 'first' : 'last'
  const orderByMap: Record<string, object> = {
    contractDate: { contractDate: { sort: order, nulls: 'last' } },
    startDate: { startDate: { sort: order, nulls: startDateNulls } },
  }
  const orderByClause = orderByMap[orderBy] ?? { startDate: { sort: 'desc', nulls: 'first' } }

  const where = {
    ...(hospitalCode && { hospitalCode }),
    ...(search && {
      OR: [
        { projectName: { contains: search, mode: 'insensitive' as const } },
        { hospital: { hospitalName: { contains: search, mode: 'insensitive' as const } } },
      ],
    }),
    ...(buildStatusId && { buildStatusId: Number(buildStatusId) }),
    ...(contractorId && { constructorId: Number(contractorId) }),
    ...(builderId && { assignees: { some: { userId: builderId } } }),
  }

  const projects = await prisma.project.findMany({
    where,
    orderBy: orderByClause,
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
      assignees: {
        include: { user: { select: { id: true, name: true } } },
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
  })

  // 보류 상태 항목은 배열 맨 뒤로 정렬
  const sorted = [...projects].sort((a, b) => {
    const aHold = a.buildStatus?.label === '보류' ? 1 : 0
    const bHold = b.buildStatus?.label === '보류' ? 1 : 0
    return aHold - bHold
  })

  return NextResponse.json({
    projects: sorted,
    total: sorted.length,
  })
}

export async function POST(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser || authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await request.json()
  const {
    hospitalCode,
    contractDate,
    introTypeId,
    wardCount,
    bedCount,
    gatewayCount,
    hasSurvey,
    hasOrder,
    assigneeIds,
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
      introTypeId: introTypeId ? Number(introTypeId) : null,
      wardCount: wardCount != null ? Number(wardCount) : null,
      bedCount: bedCount != null ? Number(bedCount) : null,
      gatewayCount: gatewayCount != null ? Number(gatewayCount) : null,
      hasSurvey: hasSurvey ?? false,
      hasOrder: hasOrder ?? false,
      builderNameManual: builderNameManual ?? null,
      constructorId: constructorId ? Number(constructorId) : null,
      startDate: startDate ? new Date(startDate) : null,
      endDateExpected: endDateExpected ? new Date(endDateExpected) : null,
      buildStatusId: buildStatusId ? Number(buildStatusId) : null,
      issueNote: issueNote ?? null,
    },
    include: {
      hospital: true,
      assignees: { include: { user: { select: { id: true, name: true } } } },
    },
  })

  // assignees 생성
  if (Array.isArray(assigneeIds) && assigneeIds.length > 0) {
    await prisma.projectAssignee.createMany({
      data: assigneeIds.map((userId: string) => ({
        projectCode: project.projectCode,
        userId,
      })),
    })
  }

  return NextResponse.json({ project }, { status: 201 })
}
