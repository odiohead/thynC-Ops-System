import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '@/lib/googleCalendar'

type Params = { params: { id: string } }

const include = {
  hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true, sidoName: true, sigunguName: true, address: true, status: true } },
  daewoongUser: { select: { id: true, name: true } },
  assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
  status: { select: { id: true, name: true, color: true } },
  files: { orderBy: { uploadedAt: 'asc' as const } },
} as const

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const siteVisit = await prisma.siteVisit.findUnique({ where: { id }, include })
  if (!siteVisit) return NextResponse.json({ error: '답사를 찾을 수 없습니다.' }, { status: 404 })

  return NextResponse.json({ siteVisit })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const body = await request.json()
  const {
    hospitalCode,
    daewoongUserId,
    assigneeIds,
    requestDate,
    visitDate,
    replyDate,
    statusId,
    installPlanS3Key,
    floorPlanS3Key,
    notes,
  } = body

  if (!hospitalCode) {
    return NextResponse.json({ error: '병원을 선택해주세요.' }, { status: 400 })
  }

  const existing = await prisma.siteVisit.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: '답사를 찾을 수 없습니다.' }, { status: 404 })

  await prisma.siteVisit.update({
    where: { id },
    data: {
      hospitalCode,
      daewoongUserId: daewoongUserId || null,
      requestDate: requestDate ? new Date(requestDate) : null,
      visitDate: visitDate ? new Date(visitDate) : null,
      replyDate: replyDate ? new Date(replyDate) : null,
      statusId: statusId ? Number(statusId) : null,
      installPlanS3Key: installPlanS3Key !== undefined ? (installPlanS3Key || null) : undefined,
      floorPlanS3Key: floorPlanS3Key !== undefined ? (floorPlanS3Key || null) : undefined,
      notes: notes !== undefined ? (notes || null) : undefined,
    },
  })

  // assigneeIds가 전달되면 N:M 테이블 갱신
  if (Array.isArray(assigneeIds)) {
    await prisma.$transaction([
      prisma.siteVisitAssignee.deleteMany({ where: { siteVisitId: id } }),
      prisma.siteVisitAssignee.createMany({
        data: assigneeIds.map((userId: string) => ({
          siteVisitId: id,
          userId,
        })),
      }),
    ])
  }

  // 갱신된 데이터 다시 조회
  const updated = await prisma.siteVisit.findUnique({ where: { id }, include })

  // Task 완료 동기화: '회신완료' → 완료
  if (statusId !== undefined && updated?.siteVisitCode) {
    const isCompleted = updated.status?.name === '회신완료'
    await prisma.task.updateMany({
      where: { refCode: updated.siteVisitCode, taskType: 'SITE_VISIT' },
      data: { isCompleted, completedAt: isCompleted ? new Date() : null },
    })
  }

  // Google Calendar 동기화 (비차단)
  const calendarChanged = visitDate !== undefined || assigneeIds !== undefined
  if (updated && calendarChanged) {
    const hasVisitDate = !!updated.visitDate
    const hasEventId = !!updated.calendarEventId
    const hospitalName = updated.hospital.hospitalName ?? updated.hospital.hiraHospitalName ?? ''
    const assigneeEmails = updated.assignees
      .map((a: { user: { email?: string } }) => a.user.email)
      .filter(Boolean) as string[]

    if (hasEventId && !hasVisitDate) {
      await deleteCalendarEvent('site-visit', updated.calendarEventId!)
      await prisma.siteVisit.update({ where: { id }, data: { calendarEventId: null } })
    } else if (hasEventId && hasVisitDate) {
      await updateCalendarEvent('site-visit', updated.calendarEventId!, {
        summary: `[답사] ${hospitalName}`,
        description: `답사 코드: ${updated.siteVisitCode}`,
        startDate: updated.visitDate!,
        attendeeEmails: assigneeEmails,
      })
    } else if (!hasEventId && hasVisitDate) {
      const eventId = await createCalendarEvent('site-visit', {
        summary: `[답사] ${hospitalName}`,
        description: `답사 코드: ${updated.siteVisitCode}`,
        startDate: updated.visitDate!,
        attendeeEmails: assigneeEmails,
      })
      if (eventId) {
        await prisma.siteVisit.update({ where: { id }, data: { calendarEventId: eventId } })
      }
    }
  }

  return NextResponse.json({ siteVisit: updated })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!isAdminOrAbove(user.role)) return NextResponse.json({ error: '삭제 권한이 없습니다. 관리자(ADMIN)에게 문의하세요.' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const existing = await prisma.siteVisit.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: '답사를 찾을 수 없습니다.' }, { status: 404 })

  // Google Calendar 이벤트 삭제 (비차단)
  if (existing.calendarEventId) {
    await deleteCalendarEvent('site-visit', existing.calendarEventId)
  }

  await prisma.siteVisit.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
