import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: { code: string } }

const projectInclude = {
  hospital: { include: { meta: true } },
  builder: { select: { id: true, name: true, email: true } },
  contractor: { select: { id: true, code: true, name: true } },
  buildStatus: { select: { id: true, label: true, color: true } },
  devices: {
    include: { deviceInfo: true },
    orderBy: { deviceInfo: { sortOrder: 'asc' } },
  },
  files: {
    orderBy: { uploadedAt: 'asc' as const },
  },
} as const

export async function GET(_req: NextRequest, { params }: Params) {
  const project = await prisma.project.findUnique({
    where: { projectCode: params.code },
    include: projectInclude,
  })

  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })

  return NextResponse.json({ project })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const existing = await prisma.project.findUnique({ where: { projectCode: params.code } })
  if (!existing) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const {
    contractDate,
    contractType,
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

  const project = await prisma.project.update({
    where: { projectCode: params.code },
    data: {
      contractDate: contractDate !== undefined ? (contractDate ? new Date(contractDate) : null) : undefined,
      contractType: contractType !== undefined ? (contractType || null) : undefined,
      wardCount: wardCount !== undefined ? (wardCount != null ? Number(wardCount) : null) : undefined,
      bedCount: bedCount !== undefined ? (bedCount != null ? Number(bedCount) : null) : undefined,
      gatewayCount: gatewayCount !== undefined ? (gatewayCount != null ? Number(gatewayCount) : null) : undefined,
      hasSurvey: hasSurvey !== undefined ? hasSurvey : undefined,
      hasOrder: hasOrder !== undefined ? hasOrder : undefined,
      builderUserId: builderUserId !== undefined ? builderUserId : undefined,
      builderNameManual: builderNameManual !== undefined ? builderNameManual : undefined,
      constructorId: constructorId !== undefined ? (constructorId ? Number(constructorId) : null) : undefined,
      startDate: startDate !== undefined ? (startDate ? new Date(startDate) : null) : undefined,
      endDateExpected: endDateExpected !== undefined ? (endDateExpected ? new Date(endDateExpected) : null) : undefined,
      buildStatusId: buildStatusId !== undefined ? (buildStatusId ? Number(buildStatusId) : null) : undefined,
      issueNote: issueNote !== undefined ? issueNote : undefined,
    },
    include: projectInclude,
  })

  return NextResponse.json({ project })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const existing = await prisma.project.findUnique({ where: { projectCode: params.code } })
  if (!existing) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })

  // 연관 데이터 먼저 삭제
  await prisma.projectDevice.deleteMany({ where: { projectId: existing.id } })
  await prisma.projectFile.deleteMany({ where: { projectId: existing.id } })
  await prisma.project.delete({ where: { projectCode: params.code } })

  return NextResponse.json({ success: true })
}
