import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { createCalendarEvent } from '@/lib/googleCalendar'
import { normalizeVisits } from '@/lib/maintenanceVisit'
import { etcTaskVisitEventPayload } from '@/lib/etcTask'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const include = {
  status: { select: { id: true, name: true, color: true } },
  assignees: { include: { user: { select: { id: true, name: true } } } },
  hospitals: { include: { hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true } } } },
  visits: { orderBy: { sortOrder: 'asc' as const } },
} as const

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search') ?? ''
  const hospitalCode = searchParams.get('hospitalCode') ?? ''
  const statusId = searchParams.get('statusId') ?? ''
  const priority = searchParams.get('priority') ?? ''

  const where = {
    ...(search && { title: { contains: search, mode: 'insensitive' as const } }),
    ...(hospitalCode && { hospitals: { some: { hospitalCode } } }),
    ...(statusId && { statusId: Number(statusId) }),
    ...(priority && { priority }),
  }

  const etcTasks = await prisma.etcTask.findMany({
    where,
    orderBy: [
      { reportedAt: { sort: 'desc', nulls: 'last' } },
    ],
    include,
  })

  return NextResponse.json({ etcTasks })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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

  const normalizedVisits = normalizeVisits(visits)

  if (!title?.trim()) {
    return NextResponse.json({ error: '제목을 입력해주세요.' }, { status: 400 })
  }

  const created = await prisma.etcTask.create({
    data: {
      title: title.trim(),
      statusId: statusId ? Number(statusId) : null,
      priority: priority || '보통',
      reportedAt: reportedAt ? new Date(reportedAt) : null,
      resolvedAt: resolvedAt ? new Date(resolvedAt) : null,
      note: note || null,
    },
  })

  // assignees 생성
  if (Array.isArray(assigneeIds) && assigneeIds.length > 0) {
    await prisma.etcTaskAssignee.createMany({
      data: assigneeIds.map((userId: string) => ({
        etcTaskId: created.id,
        userId,
      })),
    })
  }

  // 병원 연결 생성 (선택, 다중)
  if (Array.isArray(hospitalCodes) && hospitalCodes.length > 0) {
    await prisma.etcTaskHospital.createMany({
      data: Array.from(new Set(hospitalCodes as string[])).map((hospitalCode) => ({
        etcTaskId: created.id,
        hospitalCode,
      })),
    })
  }

  // 업무기간 생성
  if (normalizedVisits.length > 0) {
    await prisma.etcTaskVisit.createMany({
      data: normalizedVisits.map((v) => ({
        etcTaskId: created.id,
        startDate: new Date(v.startDate),
        endDate: new Date(v.endDate),
        sortOrder: v.sortOrder,
      })),
    })
  }

  // etcTaskCode 생성: ETC-YYYYMM-NNNN
  const now = new Date()
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const prefix = `ETC-${ym}-`
  const last = await prisma.etcTask.findFirst({
    where: { etcTaskCode: { startsWith: prefix } },
    orderBy: { etcTaskCode: 'desc' },
    select: { etcTaskCode: true },
  })
  const seq = last?.etcTaskCode ? parseInt(last.etcTaskCode.slice(-4)) + 1 : 1
  const etcTaskCode = `${prefix}${String(seq).padStart(4, '0')}`

  const etcTask = await prisma.etcTask.update({
    where: { id: created.id },
    data: { etcTaskCode },
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
      taskType: 'ETC',
      refCode: etcTaskCode,
      hospitalCode: null, // 다병원 연결이라 단일 병원 미지정
      title: title.trim(),
    },
  })

  // Google Calendar 이벤트 생성 (비차단) — 업무기간 항목별 1개씩
  if (etcTask.visits.length > 0) {
    const assigneeEmails = Array.isArray(assigneeIds) && assigneeIds.length > 0
      ? (await prisma.user.findMany({
          where: { id: { in: assigneeIds } },
          select: { email: true },
        })).map(u => u.email)
      : []

    for (const visit of etcTask.visits) {
      const eventId = await createCalendarEvent('etc-task', etcTaskVisitEventPayload({
        title: title.trim(),
        etcTaskCode,
        startDate: visit.startDate.toISOString().slice(0, 10),
        endDate: visit.endDate.toISOString().slice(0, 10),
        attendeeEmails: assigneeEmails,
      }))
      if (eventId) {
        await prisma.etcTaskVisit.update({
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
    resource: 'etc_task',
    resourceId: etcTask.etcTaskCode ?? String(etcTask.id),
    resourceLabel: etcTask.title,
    after: etcTask,
  })

  return NextResponse.json({ etcTask }, { status: 201 })
}
