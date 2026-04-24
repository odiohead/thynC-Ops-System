import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'

interface Params { params: { id: string } }

export async function GET(request: NextRequest, { params }: Params) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  const installPlan = await prisma.installPlan.findUnique({
    where: { id },
    include: {
      hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true, sidoName: true, sigunguName: true, address: true, status: true } },
      assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  })

  if (!installPlan) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ installPlan })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  const body = await request.json()
  const { hospitalCode, requestDate, writeStatus, replyStatus, assigneeIds, replyDate, note } = body

  await prisma.installPlan.update({
    where: { id },
    data: {
      hospitalCode: hospitalCode || null,
      requestDate: requestDate ? new Date(requestDate) : null,
      writeStatus: writeStatus ?? '-',
      replyStatus: replyStatus ?? '-',
      replyDate: replyDate ? new Date(replyDate) : null,
      note: note || null,
      updatedAt: new Date(),
    },
  })

  // assigneeIds가 전달되면 N:M 테이블 갱신
  if (Array.isArray(assigneeIds)) {
    await prisma.$transaction([
      prisma.installPlanAssignee.deleteMany({ where: { installPlanId: id } }),
      prisma.installPlanAssignee.createMany({
        data: assigneeIds.map((userId: string) => ({
          installPlanId: id,
          userId,
        })),
      }),
    ])
  }

  // 갱신된 데이터 다시 조회
  const updated = await prisma.installPlan.findUnique({
    where: { id },
    include: {
      hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true, sidoName: true, sigunguName: true, address: true, status: true } },
      assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  })

  // Task 완료 동기화: writeStatus='완료' AND replyStatus='완료' → 완료
  if ((writeStatus !== undefined || replyStatus !== undefined) && updated?.planCode) {
    const isCompleted = updated.writeStatus === '완료' && updated.replyStatus === '완료'
    await prisma.task.updateMany({
      where: { refCode: updated.planCode, taskType: 'INSTALL_PLAN' },
      data: { isCompleted, completedAt: isCompleted ? new Date() : null },
    })
  }

  return NextResponse.json({ installPlan: updated })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!isAdminOrAbove(authUser.role)) return NextResponse.json({ error: '삭제 권한이 없습니다. 관리자(ADMIN)에게 문의하세요.' }, { status: 403 })

  const id = parseInt(params.id)
  const existing = await prisma.installPlan.findUnique({
    where: { id },
    select: { planCode: true },
  })

  if (existing?.planCode) {
    await prisma.task.deleteMany({
      where: { refCode: existing.planCode, taskType: 'INSTALL_PLAN' },
    })
  }

  await prisma.installPlan.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
