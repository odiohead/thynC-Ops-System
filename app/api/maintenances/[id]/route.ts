import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { notifyTicketChanged } from '@/lib/notify'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { deleteFromS3 } from '@/lib/s3'
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '@/lib/googleCalendar'
import { normalizeVisits, visitEventPayload, visitKey, ymd } from '@/lib/maintenanceVisit'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { syncMaintenanceToTicket } from '@/lib/ticketDomain'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

const include = {
  hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true, sidoName: true, sigunguName: true, address: true, status: true } },
  type: { select: { id: true, name: true, color: true } },
  status: { select: { id: true, name: true, color: true } },
  assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
  files: { orderBy: { uploadedAt: 'asc' as const } },
  visits: { orderBy: { sortOrder: 'asc' as const } },
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
    visits,
    resolvedAt,
    symptoms,
    resolution,
    assigneeIds,
  } = body

  await prisma.maintenance.update({
    where: { id },
    data: {
      ...(hospitalCode !== undefined && { hospitalCode }),
      ...(typeId !== undefined && { typeId: typeId ? Number(typeId) : null }),
      ...(statusId !== undefined && { statusId: statusId ? Number(statusId) : null }),
      // 상태 실변경 시 단계 진입 시각 기록 (단계 체류 지연 감지)
      ...(statusId !== undefined && (statusId ? Number(statusId) : null) !== existing.statusId && { statusChangedAt: new Date() }),
      ...(priority !== undefined && { priority }),
      ...(title !== undefined && { title: title.trim() }),
      ...(reporterName !== undefined && { reporterName: reporterName || null }),
      ...(isRemote !== undefined && { isRemote }),
      ...(reportedAt !== undefined && { reportedAt: reportedAt ? new Date(reportedAt) : null }),
      ...(resolvedAt !== undefined && { resolvedAt: resolvedAt ? new Date(resolvedAt) : null }),
      ...(symptoms !== undefined && { symptoms: symptoms || null }),
      ...(resolution !== undefined && { resolution: resolution || null }),
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

  // 티켓 동기화 (P5 편입 — 상태·우선순위·유형·담당·제목 반영)
  await prisma.$transaction(async (tx) => {
    await syncMaintenanceToTicket(tx, id, user.userId)
  })

  // 방문일정 reconcile — (시작,종료) 키로 매칭하여 삭제/유지/추가. 캘린더 이벤트ID는 유지 항목 보존
  const deletedVisitEventIds: string[] = []
  if (Array.isArray(visits)) {
    const normalizedVisits = normalizeVisits(visits)
    const existingVisits = await prisma.maintenanceVisit.findMany({ where: { maintenanceId: id } })
    const existingByKey = new Map(existingVisits.map((v) => [visitKey(ymd(v.startDate), ymd(v.endDate)), v]))
    const newByKey = new Map(normalizedVisits.map((v) => [visitKey(v.startDate, v.endDate), v]))

    // 삭제: 기존에 있으나 새 목록에 없는 항목 (캘린더 이벤트도 정리)
    const toDelete = existingVisits.filter((v) => !newByKey.has(visitKey(ymd(v.startDate), ymd(v.endDate))))
    for (const v of toDelete) {
      if (v.calendarEventId) deletedVisitEventIds.push(v.calendarEventId)
    }
    if (toDelete.length > 0) {
      await prisma.maintenanceVisit.deleteMany({ where: { id: { in: toDelete.map((v) => v.id) } } })
    }
    // 유지: sortOrder만 갱신
    for (const v of normalizedVisits) {
      const existing = existingByKey.get(visitKey(v.startDate, v.endDate))
      if (existing) {
        if (existing.sortOrder !== v.sortOrder) {
          await prisma.maintenanceVisit.update({ where: { id: existing.id }, data: { sortOrder: v.sortOrder } })
        }
      } else {
        // 추가 (캘린더 이벤트는 아래에서 생성)
        await prisma.maintenanceVisit.create({
          data: {
            maintenanceId: id,
            startDate: new Date(v.startDate),
            endDate: new Date(v.endDate),
            sortOrder: v.sortOrder,
          },
        })
      }
    }
  }

  const updated = await prisma.maintenance.findUnique({ where: { id }, include })

  // Slack 알림 (P11 티켓 파이프라인) — sig 비교로 실변경(상태·배정·Sev)만 발송, best-effort
  if (existing.ticketId) {
    notifyTicketChanged({ ticketId: existing.ticketId, actorName: user.name }).catch(() => {})
  }

  // Google Calendar 동기화 (비차단) — 방문 항목별 1개씩
  // 삭제된 방문 항목의 이벤트 제거
  for (const eventId of deletedVisitEventIds) {
    await deleteCalendarEvent('maintenance', eventId)
  }
  const calendarMetaChanged = title !== undefined || assigneeIds !== undefined
  if (updated && (Array.isArray(visits) || calendarMetaChanged)) {
    const hospitalName = updated.hospital.hospitalName ?? updated.hospital.hiraHospitalName ?? ''
    const assigneeEmails = updated.assignees
      .map((a: { user: { email?: string } }) => a.user.email)
      .filter(Boolean) as string[]

    for (const visit of updated.visits) {
      const payload = visitEventPayload({
        hospitalName,
        title: updated.title,
        maintenanceCode: updated.maintenanceCode,
        startDate: ymd(visit.startDate),
        endDate: ymd(visit.endDate),
        attendeeEmails: assigneeEmails,
      })
      if (!visit.calendarEventId) {
        // 신규 방문 항목 → 이벤트 생성
        const eventId = await createCalendarEvent('maintenance', payload)
        if (eventId) {
          await prisma.maintenanceVisit.update({ where: { id: visit.id }, data: { calendarEventId: eventId } })
        }
      } else if (calendarMetaChanged) {
        // 유지된 항목 + 제목/담당자 변경 → 이벤트 갱신
        await updateCalendarEvent('maintenance', visit.calendarEventId, payload)
      }
    }
  }

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'maintenance',
    resourceId: existing.maintenanceCode ?? String(id),
    resourceLabel: `${updated?.hospital?.hospitalName ?? updated?.hospital?.hiraHospitalName ?? ''} - ${updated?.title ?? existing.title}`,
    before: existing,
    after: updated,
  })

  return NextResponse.json({ maintenance: updated })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!isAdminOrAbove(user.role)) return NextResponse.json({ error: '삭제 권한이 없습니다. 관리자(ADMIN)에게 문의하세요.' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const existing = await prisma.maintenance.findUnique({
    where: { id },
    include: { files: true, visits: true, hospital: { select: { hospitalName: true } } },
  })
  if (!existing) return NextResponse.json({ error: '유지보수를 찾을 수 없습니다.' }, { status: 404 })

  // Google Calendar 이벤트 삭제 (비차단) — 방문 항목별 + 레거시 본체 이벤트
  for (const visit of existing.visits) {
    if (visit.calendarEventId) await deleteCalendarEvent('maintenance', visit.calendarEventId)
  }
  if (existing.calendarEventId) {
    await deleteCalendarEvent('maintenance', existing.calendarEventId)
  }

  // S3 파일 삭제
  for (const file of existing.files) {
    try {
      await deleteFromS3(file.s3Key)
    } catch {
      // S3 삭제 실패해도 DB 삭제는 진행
    }
  }

  await prisma.maintenance.delete({ where: { id } })

  // 연결 티켓도 삭제 (P5 편입 — 유지보수 티켓은 도메인과 생명주기 공유)
  if (existing.ticketId) {
    await prisma.ticket.delete({ where: { id: existing.ticketId } }).catch(() => {})
  }

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'maintenance',
    resourceId: existing.maintenanceCode ?? String(id),
    resourceLabel: `${existing.hospital?.hospitalName ?? ''} - ${existing.title}`,
    before: existing,
  })

  return NextResponse.json({ success: true })
}
