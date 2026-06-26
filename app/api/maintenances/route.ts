import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { createCalendarEvent } from '@/lib/googleCalendar'
import { normalizeVisits, visitEventPayload } from '@/lib/maintenanceVisit'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const visitsInclude = {
  visits: { orderBy: { sortOrder: 'asc' as const } },
} as const

const include = {
  hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true, address: true } },
  type: { select: { id: true, name: true, color: true } },
  status: { select: { id: true, name: true, color: true } },
  assignees: { include: { user: { select: { id: true, name: true } } } },
  ...visitsInclude,
} as const

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search') ?? ''
  const hospitalCode = searchParams.get('hospitalCode') ?? ''
  const typeId = searchParams.get('typeId') ?? ''
  const statusId = searchParams.get('statusId') ?? ''
  const priority = searchParams.get('priority') ?? ''

  const where = {
    ...(hospitalCode && { hospitalCode }),
    ...(search && {
      hospital: {
        OR: [
          { hospitalName: { contains: search, mode: 'insensitive' as const } },
          { hiraHospitalName: { contains: search, mode: 'insensitive' as const } },
        ],
      },
    }),
    ...(typeId && { typeId: Number(typeId) }),
    ...(statusId && { statusId: Number(statusId) }),
    ...(priority && { priority }),
  }

  const maintenances = await prisma.maintenance.findMany({
    where,
    orderBy: [
      { reportedAt: { sort: 'desc', nulls: 'last' } },
    ],
    include,
  })

  return NextResponse.json({ maintenances })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
    cause,
    resolution,
    notes,
    assigneeIds,
  } = body

  const normalizedVisits = normalizeVisits(visits)

  if (!hospitalCode) {
    return NextResponse.json({ error: '병원을 선택해주세요.' }, { status: 400 })
  }
  if (!title?.trim()) {
    return NextResponse.json({ error: '제목을 입력해주세요.' }, { status: 400 })
  }

  const created = await prisma.maintenance.create({
    data: {
      hospitalCode,
      typeId: typeId ? Number(typeId) : null,
      statusId: statusId ? Number(statusId) : null,
      priority: priority || '보통',
      title: title.trim(),
      reporterName: reporterName || null,
      isRemote: isRemote ?? false,
      reportedAt: reportedAt ? new Date(reportedAt) : null,
      resolvedAt: resolvedAt ? new Date(resolvedAt) : null,
      symptoms: symptoms || null,
      cause: cause || null,
      resolution: resolution || null,
      notes: notes || null,
    },
  })

  // assignees 생성
  if (Array.isArray(assigneeIds) && assigneeIds.length > 0) {
    await prisma.maintenanceAssignee.createMany({
      data: assigneeIds.map((userId: string) => ({
        maintenanceId: created.id,
        userId,
      })),
    })
  }

  // 방문일정 생성
  if (normalizedVisits.length > 0) {
    await prisma.maintenanceVisit.createMany({
      data: normalizedVisits.map((v) => ({
        maintenanceId: created.id,
        startDate: new Date(v.startDate),
        endDate: new Date(v.endDate),
        sortOrder: v.sortOrder,
      })),
    })
  }

  // maintenanceCode 생성: MNT-YYYYMM-NNNN
  const now = new Date()
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const prefix = `MNT-${ym}-`
  const last = await prisma.maintenance.findFirst({
    where: { maintenanceCode: { startsWith: prefix } },
    orderBy: { maintenanceCode: 'desc' },
    select: { maintenanceCode: true },
  })
  const seq = last?.maintenanceCode ? parseInt(last.maintenanceCode.slice(-4)) + 1 : 1
  const maintenanceCode = `${prefix}${String(seq).padStart(4, '0')}`

  const maintenance = await prisma.maintenance.update({
    where: { id: created.id },
    data: { maintenanceCode },
    include,
  })

  // Task 레코드 생성: TASK-YYYYMM-NNNNN
  const taskPrefix = `TASK-${ym}-`
  const lastTask = await prisma.task.findFirst({
    where: { taskCode: { startsWith: taskPrefix } },
    orderBy: { taskCode: 'desc' },
    select: { taskCode: true },
  })
  const taskSeq = lastTask?.taskCode ? parseInt(lastTask.taskCode.slice(-5)) + 1 : 1
  const taskCode = `${taskPrefix}${String(taskSeq).padStart(5, '0')}`

  await prisma.task.create({
    data: {
      taskCode,
      taskType: 'MAINTENANCE',
      refCode: maintenanceCode,
      hospitalCode: hospitalCode || null,
      title: title.trim(),
    },
  })

  // Google Calendar 이벤트 생성 (비차단) — 방문 항목별 1개씩
  if (maintenance.visits.length > 0) {
    const assigneeEmails = Array.isArray(assigneeIds) && assigneeIds.length > 0
      ? (await prisma.user.findMany({
          where: { id: { in: assigneeIds } },
          select: { email: true },
        })).map(u => u.email)
      : []

    const hospitalName = maintenance.hospital.hospitalName ?? maintenance.hospital.hiraHospitalName ?? ''
    for (const visit of maintenance.visits) {
      const eventId = await createCalendarEvent('maintenance', visitEventPayload({
        hospitalName,
        title: title.trim(),
        maintenanceCode,
        startDate: visit.startDate.toISOString().slice(0, 10),
        endDate: visit.endDate.toISOString().slice(0, 10),
        attendeeEmails: assigneeEmails,
      }))
      if (eventId) {
        await prisma.maintenanceVisit.update({
          where: { id: visit.id },
          data: { calendarEventId: eventId },
        })
      }
    }
  }

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'maintenance',
    resourceId: maintenance.maintenanceCode ?? String(maintenance.id),
    resourceLabel: `${maintenance.hospital?.hospitalName ?? maintenance.hospital?.hiraHospitalName ?? ''} - ${maintenance.title}`,
    after: maintenance,
  })

  return NextResponse.json({ maintenance }, { status: 201 })
}
