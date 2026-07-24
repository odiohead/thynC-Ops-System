import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { notifyTicketChanged } from '@/lib/notify'
import { syncEtcTaskToTicket } from '@/lib/ticketDomain'
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

  // 티켓 동기화 (P6 편입 — 상태·우선순위·담당·제목·병원 반영)
  await prisma.$transaction(async (tx) => {
    await syncEtcTaskToTicket(tx, id, user.userId)
  })

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

  // Slack 알림 (P11 티켓 파이프라인) — sig 비교로 실변경만 발송, best-effort
  if (existing.ticketId) {
    notifyTicketChanged({ ticketId: existing.ticketId, actorName: user.name }).catch(() => {})
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

  await prisma.etcTask.delete({ where: { id } })

  // 연결 티켓도 삭제 (P6 편입 — 생명주기 공유)
  if (existing.ticketId) {
    await prisma.ticket.delete({ where: { id: existing.ticketId } }).catch(() => {})
  }

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
