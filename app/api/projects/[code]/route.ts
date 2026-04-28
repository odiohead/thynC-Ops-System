import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '@/lib/googleCalendar'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

type Params = { params: { code: string } }

const projectInclude = {
  hospital: { include: { meta: true } },
  assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
  contractor: { select: { id: true, code: true, name: true } },
  buildStatus: { select: { id: true, label: true, color: true } },
  introType: { select: { id: true, name: true } },
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
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const existing = await prisma.project.findUnique({ where: { projectCode: params.code } })
  if (!existing) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()

  // VIEWER는 issueNote만 수정 가능
  if (authUser.role === 'VIEWER') {
    const { issueNote, remark } = body
    const project = await prisma.project.update({
      where: { projectCode: params.code },
      data: {
        issueNote: issueNote !== undefined ? issueNote : undefined,
        remark: remark !== undefined ? remark : undefined,
      },
      include: projectInclude,
    })
    await logAudit({
      req: request,
      actor: auditActorFromJWT(authUser),
      action: 'UPDATE',
      resource: 'project',
      resourceId: params.code,
      resourceLabel: existing.projectName,
      before: { issueNote: existing.issueNote, remark: existing.remark },
      after: { issueNote: project.issueNote, remark: project.remark },
    })
    revalidatePath('/projects')
    return NextResponse.json({ project })
  }

  const {
    contractDate,
    contractType,
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
    introTypeId,
    issueNote,
    remark,
  } = body

  await prisma.project.update({
    where: { projectCode: params.code },
    data: {
      contractDate: contractDate !== undefined ? (contractDate ? new Date(contractDate) : null) : undefined,
      contractType: contractType !== undefined ? (contractType || null) : undefined,
      wardCount: wardCount !== undefined ? (wardCount != null ? Number(wardCount) : null) : undefined,
      bedCount: bedCount !== undefined ? (bedCount != null ? Number(bedCount) : null) : undefined,
      gatewayCount: gatewayCount !== undefined ? (gatewayCount != null ? Number(gatewayCount) : null) : undefined,
      hasSurvey: hasSurvey !== undefined ? hasSurvey : undefined,
      hasOrder: hasOrder !== undefined ? hasOrder : undefined,
      builderNameManual: builderNameManual !== undefined ? builderNameManual : undefined,
      constructorId: constructorId !== undefined ? (constructorId ? Number(constructorId) : null) : undefined,
      startDate: startDate !== undefined ? (startDate ? new Date(startDate) : null) : undefined,
      endDateExpected: endDateExpected !== undefined ? (endDateExpected ? new Date(endDateExpected) : null) : undefined,
      buildStatusId: buildStatusId !== undefined ? (buildStatusId ? Number(buildStatusId) : null) : undefined,
      introTypeId: introTypeId !== undefined ? (introTypeId ? Number(introTypeId) : null) : undefined,
      issueNote: issueNote !== undefined ? issueNote : undefined,
      remark: remark !== undefined ? remark : undefined,
    },
  })

  // assigneeIds가 전달되면 N:M 테이블 갱신
  if (Array.isArray(assigneeIds)) {
    await prisma.$transaction([
      prisma.projectAssignee.deleteMany({ where: { projectCode: params.code } }),
      prisma.projectAssignee.createMany({
        data: assigneeIds.map((userId: string) => ({
          projectCode: params.code,
          userId,
        })),
      }),
    ])
  }

  // 갱신된 데이터 다시 조회
  const updated = await prisma.project.findUnique({
    where: { projectCode: params.code },
    include: projectInclude,
  })

  // Task 완료 동기화: buildStatus 라벨에 '완료' 포함 → 완료
  if (buildStatusId !== undefined && updated) {
    const bsLabel = updated.buildStatus?.label ?? ''
    const isCompleted = bsLabel.includes('완료')
    await prisma.task.updateMany({
      where: { refCode: params.code, taskType: 'PROJECT' },
      data: { isCompleted, completedAt: isCompleted ? new Date() : null },
    })
  }

  // Google Calendar 동기화 (비차단)
  const calendarChanged = startDate !== undefined || endDateExpected !== undefined || Array.isArray(assigneeIds)
  if (updated && calendarChanged) {
    const hasStartDate = !!updated.startDate
    const hasEventId = !!updated.calendarEventId

    // 담당자 이메일 조회
    const assigneeEmails = updated.assignees
      .map((a: { user: { email?: string } }) => a.user.email)
      .filter(Boolean) as string[]

    if (hasEventId && !hasStartDate) {
      await deleteCalendarEvent('project', updated.calendarEventId!)
      await prisma.project.update({
        where: { projectCode: params.code },
        data: { calendarEventId: null },
      })
    } else if (hasEventId && hasStartDate) {
      await updateCalendarEvent('project', updated.calendarEventId!, {
        summary: updated.projectName,
        description: `프로젝트 코드: ${updated.projectCode}`,
        startDate: updated.startDate!,
        endDate: updated.endDateExpected,
        attendeeEmails: assigneeEmails,
      })
    } else if (!hasEventId && hasStartDate) {
      const eventId = await createCalendarEvent('project', {
        summary: updated.projectName,
        description: `프로젝트 코드: ${updated.projectCode}`,
        startDate: updated.startDate!,
        endDate: updated.endDateExpected,
        attendeeEmails: assigneeEmails,
      })
      if (eventId) {
        await prisma.project.update({
          where: { projectCode: params.code },
          data: { calendarEventId: eventId },
        })
      }
    }
  }

  await logAudit({
    req: request,
    actor: auditActorFromJWT(authUser),
    action: 'UPDATE',
    resource: 'project',
    resourceId: params.code,
    resourceLabel: updated?.projectName ?? existing.projectName,
    before: existing,
    after: updated,
  })

  revalidatePath('/projects')
  return NextResponse.json({ project: updated })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!isAdminOrAbove(authUser.role)) return NextResponse.json({ error: '삭제 권한이 없습니다. 관리자(ADMIN)에게 문의하세요.' }, { status: 403 })
  const existing = await prisma.project.findUnique({ where: { projectCode: params.code } })
  if (!existing) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })

  // Google Calendar 이벤트 삭제 (비차단)
  if (existing.calendarEventId) {
    await deleteCalendarEvent('project', existing.calendarEventId)
  }

  // 연관 데이터 먼저 삭제
  await prisma.projectDevice.deleteMany({ where: { projectId: existing.id } })
  await prisma.projectFile.deleteMany({ where: { projectId: existing.id } })
  await prisma.project.delete({ where: { projectCode: params.code } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(authUser),
    action: 'DELETE',
    resource: 'project',
    resourceId: params.code,
    resourceLabel: existing.projectName,
    before: existing,
  })

  return NextResponse.json({ success: true })
}
