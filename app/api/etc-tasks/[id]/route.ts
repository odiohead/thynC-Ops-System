import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { notifyTaskStatusChanged } from '@/lib/notify'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { deleteFromS3 } from '@/lib/s3'
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '@/lib/googleCalendar'
import { normalizeVisits, visitKey, ymd } from '@/lib/maintenanceVisit'
import { etcTaskVisitEventPayload } from '@/lib/etcTask'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

const include = {
  status: { select: { id: true, name: true, color: true } },
  assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
  hospitals: { include: { hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true, address: true } } } },
  files: { orderBy: { uploadedAt: 'asc' as const } },
  visits: { orderBy: { sortOrder: 'asc' as const } },
} as const

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const etcTask = await prisma.etcTask.findUnique({ where: { id }, include })
  if (!etcTask) return NextResponse.json({ error: '기타업무를 찾을 수 없습니다.' }, { status: 404 })

  return NextResponse.json({ etcTask })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const existing = await prisma.etcTask.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: '기타업무를 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const {
    title,
    statusId,
    priority,
    reportedAt,
    resolvedAt,
    note,
    assigneeIds,
    hospitalCodes,
    visits,
  } = body

  await prisma.etcTask.update({
    where: { id },
    data: {
      ...(title !== undefined && { title: title.trim() }),
      ...(statusId !== undefined && { statusId: statusId ? Number(statusId) : null }),
      // 상태 실변경 시 단계 진입 시각 기록 (단계 체류 지연 감지)
      ...(statusId !== undefined && (statusId ? Number(statusId) : null) !== existing.statusId && { statusChangedAt: new Date() }),
      ...(priority !== undefined && { priority }),
      ...(reportedAt !== undefined && { reportedAt: reportedAt ? new Date(reportedAt) : null }),
      ...(resolvedAt !== undefined && { resolvedAt: resolvedAt ? new Date(resolvedAt) : null }),
      ...(note !== undefined && { note: note || null }),
    },
  })

  // assigneeIds가 전달되면 N:M 테이블 갱신
  if (Array.isArray(assigneeIds)) {
    await prisma.$transaction([
      prisma.etcTaskAssignee.deleteMany({ where: { etcTaskId: id } }),
      prisma.etcTaskAssignee.createMany({
        data: assigneeIds.map((userId: string) => ({
          etcTaskId: id,
          userId,
        })),
      }),
    ])
  }

  // hospitalCodes가 전달되면 병원 연결 갱신
  if (Array.isArray(hospitalCodes)) {
    await prisma.$transaction([
      prisma.etcTaskHospital.deleteMany({ where: { etcTaskId: id } }),
      prisma.etcTaskHospital.createMany({
        data: Array.from(new Set(hospitalCodes as string[])).map((hospitalCode) => ({
          etcTaskId: id,
          hospitalCode,
        })),
      }),
    ])
  }

  // 업무기간 reconcile — (시작,종료) 키로 매칭하여 삭제/유지/추가. 캘린더 이벤트ID는 유지 항목 보존
  const deletedVisitEventIds: string[] = []
  if (Array.isArray(visits)) {
    const normalizedVisits = normalizeVisits(visits)
    const existingVisits = await prisma.etcTaskVisit.findMany({ where: { etcTaskId: id } })
    const existingByKey = new Map(existingVisits.map((v) => [visitKey(ymd(v.startDate), ymd(v.endDate)), v]))
    const newByKey = new Map(normalizedVisits.map((v) => [visitKey(v.startDate, v.endDate), v]))

    const toDelete = existingVisits.filter((v) => !newByKey.has(visitKey(ymd(v.startDate), ymd(v.endDate))))
    for (const v of toDelete) {
      if (v.calendarEventId) deletedVisitEventIds.push(v.calendarEventId)
    }
    if (toDelete.length > 0) {
      await prisma.etcTaskVisit.deleteMany({ where: { id: { in: toDelete.map((v) => v.id) } } })
    }
    for (const v of normalizedVisits) {
      const existingVisit = existingByKey.get(visitKey(v.startDate, v.endDate))
      if (existingVisit) {
        if (existingVisit.sortOrder !== v.sortOrder) {
          await prisma.etcTaskVisit.update({ where: { id: existingVisit.id }, data: { sortOrder: v.sortOrder } })
        }
      } else {
        await prisma.etcTaskVisit.create({
          data: {
            etcTaskId: id,
            startDate: new Date(v.startDate),
            endDate: new Date(v.endDate),
            sortOrder: v.sortOrder,
          },
        })
      }
    }
  }

  const updated = await prisma.etcTask.findUnique({ where: { id }, include })

  // Task 레코드 동기화
  if (existing.etcTaskCode) {
    const taskUpdate: Record<string, unknown> = {}
    if (title !== undefined) taskUpdate.title = title.trim()
    // 완료 동기화: status name = '완료' → isCompleted
    if (statusId !== undefined) {
      const isCompleted = updated?.status?.name === '완료'
      taskUpdate.isCompleted = isCompleted
      taskUpdate.completedAt = isCompleted ? new Date() : null
      // Slack 알림 (상태 변경) — best-effort. 실제 상태 변경 시에만 발송
      if (existing.etcTaskCode) notifyTaskStatusChanged({ taskType: 'ETC', refCode: existing.etcTaskCode, actorName: user.name }).catch(() => {})
    }
    if (Object.keys(taskUpdate).length > 0) {
      await prisma.task.updateMany({
        where: { refCode: existing.etcTaskCode, taskType: 'ETC' },
        data: taskUpdate,
      })
    }
  }

  // Google Calendar 동기화 (비차단) — 업무기간 항목별 1개씩
  for (const eventId of deletedVisitEventIds) {
    await deleteCalendarEvent('etc-task', eventId)
  }
  const calendarMetaChanged = title !== undefined || assigneeIds !== undefined
  if (updated && (Array.isArray(visits) || calendarMetaChanged)) {
    const assigneeEmails = updated.assignees
      .map((a: { user: { email?: string } }) => a.user.email)
      .filter(Boolean) as string[]

    for (const visit of updated.visits) {
      const payload = etcTaskVisitEventPayload({
        title: updated.title,
        etcTaskCode: updated.etcTaskCode,
        startDate: ymd(visit.startDate),
        endDate: ymd(visit.endDate),
        attendeeEmails: assigneeEmails,
      })
      if (!visit.calendarEventId) {
        const eventId = await createCalendarEvent('etc-task', payload)
        if (eventId) {
          await prisma.etcTaskVisit.update({ where: { id: visit.id }, data: { calendarEventId: eventId } })
        }
      } else if (calendarMetaChanged) {
        await updateCalendarEvent('etc-task', visit.calendarEventId, payload)
      }
    }
  }

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'etc_task',
    resourceId: existing.etcTaskCode ?? String(id),
    resourceLabel: updated?.title ?? existing.title,
    before: existing,
    after: updated,
  })

  return NextResponse.json({ etcTask: updated })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!isAdminOrAbove(user.role)) return NextResponse.json({ error: '삭제 권한이 없습니다. 관리자(ADMIN)에게 문의하세요.' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const existing = await prisma.etcTask.findUnique({
    where: { id },
    include: { files: true, visits: true },
  })
  if (!existing) return NextResponse.json({ error: '기타업무를 찾을 수 없습니다.' }, { status: 404 })

  // Google Calendar 이벤트 삭제 (비차단) — 업무기간 항목별
  for (const visit of existing.visits) {
    if (visit.calendarEventId) await deleteCalendarEvent('etc-task', visit.calendarEventId)
  }

  // S3 파일 삭제
  for (const file of existing.files) {
    try {
      await deleteFromS3(file.s3Key)
    } catch {
      // S3 삭제 실패해도 DB 삭제는 진행
    }
  }

  // Task 레코드 삭제
  if (existing.etcTaskCode) {
    await prisma.task.deleteMany({
      where: { refCode: existing.etcTaskCode, taskType: 'ETC' },
    })
  }

  await prisma.etcTask.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'etc_task',
    resourceId: existing.etcTaskCode ?? String(id),
    resourceLabel: existing.title,
    before: existing,
  })

  return NextResponse.json({ success: true })
}
