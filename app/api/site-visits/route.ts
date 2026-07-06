import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { notifyTaskEvent } from '@/lib/notify'
import { getAuthUser } from '@/lib/auth'
import { createCalendarEvent } from '@/lib/googleCalendar'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { advanceHospitalStatus } from '@/lib/hospitalStatus'

const PAGE_SIZE = 20

const include = {
  hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true, address: true } },
  daewoongUser: { select: { id: true, name: true } },
  assignees: { include: { user: { select: { id: true, name: true } } } },
  status: { select: { id: true, name: true, color: true } },
  files: { orderBy: { uploadedAt: 'asc' as const } },
} as const

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = parseInt(searchParams.get('limit') ?? String(PAGE_SIZE))
  const hospitalCode = searchParams.get('hospitalCode') ?? ''
  const statusId = searchParams.get('statusId') ?? ''

  const where = {
    ...(hospitalCode && { hospitalCode }),
    ...(statusId && { statusId: Number(statusId) }),
  }

  const [rawSiteVisits, total] = await Promise.all([
    prisma.siteVisit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include,
    }),
    prisma.siteVisit.count({ where }),
  ])

  // 정렬: 접수(0) > 답사예정(1) > 작성완료(2) > 회신완료(3) > 기타(4)
  // 접수: 요청일 오래된 순(ASC), 나머지: 요청일 최신 순(DESC)
  const statusPriority: Record<string, number> = { '접수': 0, '답사예정': 1, '작성완료': 2, '회신완료': 3 }
  const sorted = rawSiteVisits.sort((a, b) => {
    const aPri = statusPriority[a.status?.name ?? ''] ?? 4
    const bPri = statusPriority[b.status?.name ?? ''] ?? 4
    if (aPri !== bPri) return aPri - bPri
    const aDate = a.requestDate ? new Date(a.requestDate).getTime() : Infinity
    const bDate = b.requestDate ? new Date(b.requestDate).getTime() : Infinity
    // 접수: 오래된 순(ASC), 나머지: 최신 순(DESC)
    if (aPri === 0) return aDate - bDate
    return bDate - aDate
  })
  const siteVisits = sorted.slice((page - 1) * limit, page * limit)

  return NextResponse.json({
    siteVisits,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const {
    hospitalCode,
    daewoongUserId,
    assigneeIds,
    requestDate,
    visitDate,
    replyDate,
    statusId,
    notes,
    files,
  } = body

  if (!hospitalCode) {
    return NextResponse.json({ error: '병원을 선택해주세요.' }, { status: 400 })
  }

  const created = await prisma.siteVisit.create({
    data: {
      hospitalCode,
      daewoongUserId: daewoongUserId || null,
      requestDate: requestDate ? new Date(requestDate) : null,
      visitDate: visitDate ? new Date(visitDate) : null,
      replyDate: replyDate ? new Date(replyDate) : null,
      statusId: statusId ? Number(statusId) : null,
      notes: notes || null,
      ...(Array.isArray(files) && files.length > 0 && {
        files: {
          create: files.map((f: { fileCategory: string; s3Key: string; fileName: string }) => ({
            fileCategory: f.fileCategory,
            fileName: f.fileName,
            s3Key: f.s3Key,
          })),
        },
      }),
    },
  })

  // siteVisitCode 생성: VISIT-YYYYMM-NNNNN
  const now = new Date()
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const prefix = `VISIT-${ym}-`
  const last = await prisma.siteVisit.findFirst({
    where: { siteVisitCode: { startsWith: prefix } },
    orderBy: { siteVisitCode: 'desc' },
    select: { siteVisitCode: true },
  })
  const seq = last?.siteVisitCode ? parseInt(last.siteVisitCode.slice(-5)) + 1 : 1
  const siteVisitCode = `${prefix}${String(seq).padStart(5, '0')}`

  const siteVisit = await prisma.siteVisit.update({
    where: { id: created.id },
    data: { siteVisitCode },
    include,
  })

  // assignees 생성
  if (Array.isArray(assigneeIds) && assigneeIds.length > 0) {
    await prisma.siteVisitAssignee.createMany({
      data: assigneeIds.map((userId: string) => ({
        siteVisitId: siteVisit.id,
        userId,
      })),
    })
  }

  // Google Calendar 이벤트 생성 (비차단) — visitDate 기준
  if (siteVisit.visitDate) {
    const assigneeEmails = Array.isArray(assigneeIds) && assigneeIds.length > 0
      ? (await prisma.user.findMany({
          where: { id: { in: assigneeIds } },
          select: { email: true },
        })).map(u => u.email)
      : []

    const hospital = await prisma.hospital.findUnique({
      where: { hospitalCode },
      select: { hospitalName: true, hiraHospitalName: true },
    })
    const hospitalName = hospital?.hospitalName ?? hospital?.hiraHospitalName ?? ''

    const eventId = await createCalendarEvent('site-visit', {
      summary: `[답사] ${hospitalName}`,
      description: `답사 코드: ${siteVisitCode}`,
      startDate: siteVisit.visitDate,
      attendeeEmails: assigneeEmails,
    })
    if (eventId) {
      await prisma.siteVisit.update({
        where: { id: siteVisit.id },
        data: { calendarEventId: eventId },
      })
    }
  }

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'site_visit',
    resourceId: siteVisit.siteVisitCode ?? String(siteVisit.id),
    resourceLabel: `${siteVisit.hospital?.hospitalName ?? siteVisit.hospital?.hiraHospitalName ?? ''} 답사`,
    after: siteVisit,
  })

  // Slack 알림 (등록) — best-effort
  notifyTaskEvent({ eventType: 'task_created', taskType: 'SITE_VISIT', refCode: siteVisitCode, actorName: user.name }).catch(() => {})

  await advanceHospitalStatus({
    hospitalCode,
    targetStatus: '답사요청',
    req: request,
    actor: auditActorFromJWT(user),
    source: '답사 등록',
  })

  return NextResponse.json({ siteVisit }, { status: 201 })
}
