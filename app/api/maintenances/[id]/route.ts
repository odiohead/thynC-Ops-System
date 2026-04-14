import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { deleteFromS3 } from '@/lib/s3'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

const include = {
  hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true, sidoName: true, sigunguName: true, address: true, status: true } },
  type: { select: { id: true, name: true, color: true } },
  status: { select: { id: true, name: true, color: true } },
  assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
  files: { orderBy: { uploadedAt: 'asc' as const } },
} as const

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const maintenance = await prisma.maintenance.findUnique({ where: { id }, include })
  if (!maintenance) return NextResponse.json({ error: '유지보수를 찾을 수 없습니다.' }, { status: 404 })

  return NextResponse.json({ maintenance })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const existing = await prisma.maintenance.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: '유지보수를 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const {
    hospitalCode,
    typeId,
    statusId,
    priority,
    title,
    reporterName,
    isRemote,
    reportedAt,
    visitDate,
    resolvedAt,
    symptoms,
    cause,
    resolution,
    notes,
    assigneeIds,
  } = body

  await prisma.maintenance.update({
    where: { id },
    data: {
      ...(hospitalCode !== undefined && { hospitalCode }),
      ...(typeId !== undefined && { typeId: typeId ? Number(typeId) : null }),
      ...(statusId !== undefined && { statusId: statusId ? Number(statusId) : null }),
      ...(priority !== undefined && { priority }),
      ...(title !== undefined && { title: title.trim() }),
      ...(reporterName !== undefined && { reporterName: reporterName || null }),
      ...(isRemote !== undefined && { isRemote }),
      ...(reportedAt !== undefined && { reportedAt: reportedAt ? new Date(reportedAt) : null }),
      ...(visitDate !== undefined && { visitDate: visitDate ? new Date(visitDate) : null }),
      ...(resolvedAt !== undefined && { resolvedAt: resolvedAt ? new Date(resolvedAt) : null }),
      ...(symptoms !== undefined && { symptoms: symptoms || null }),
      ...(cause !== undefined && { cause: cause || null }),
      ...(resolution !== undefined && { resolution: resolution || null }),
      ...(notes !== undefined && { notes: notes || null }),
    },
  })

  // assigneeIds가 전달되면 N:M 테이블 갱신
  if (Array.isArray(assigneeIds)) {
    await prisma.$transaction([
      prisma.maintenanceAssignee.deleteMany({ where: { maintenanceId: id } }),
      prisma.maintenanceAssignee.createMany({
        data: assigneeIds.map((userId: string) => ({
          maintenanceId: id,
          userId,
        })),
      }),
    ])
  }

  const updated = await prisma.maintenance.findUnique({ where: { id }, include })

  // Task 레코드 동기화
  if (existing.maintenanceCode) {
    const taskUpdate: Record<string, unknown> = {}
    if (title !== undefined) taskUpdate.title = title.trim()
    if (hospitalCode !== undefined) taskUpdate.hospitalCode = hospitalCode || null
    // 완료 동기화: status name = '완료' → isCompleted
    if (statusId !== undefined) {
      const isCompleted = updated?.status?.name === '완료'
      taskUpdate.isCompleted = isCompleted
      taskUpdate.completedAt = isCompleted ? new Date() : null
    }
    if (Object.keys(taskUpdate).length > 0) {
      await prisma.task.updateMany({
        where: { refCode: existing.maintenanceCode, taskType: 'MAINTENANCE' },
        data: taskUpdate,
      })
    }
  }

  return NextResponse.json({ maintenance: updated })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const existing = await prisma.maintenance.findUnique({
    where: { id },
    include: { files: true },
  })
  if (!existing) return NextResponse.json({ error: '유지보수를 찾을 수 없습니다.' }, { status: 404 })

  // S3 파일 삭제
  for (const file of existing.files) {
    try {
      await deleteFromS3(file.s3Key)
    } catch {
      // S3 삭제 실패해도 DB 삭제는 진행
    }
  }

  // Task 레코드 삭제
  if (existing.maintenanceCode) {
    await prisma.task.deleteMany({
      where: { refCode: existing.maintenanceCode, taskType: 'MAINTENANCE' },
    })
  }

  await prisma.maintenance.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
