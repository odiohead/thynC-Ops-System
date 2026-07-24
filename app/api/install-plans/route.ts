import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { notifyTicketCreated } from '@/lib/notify'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { advanceHospitalStatus } from '@/lib/hospitalStatus'
import { createTicketForInstallPlan } from '@/lib/ticketDomain'

export async function GET(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search') ?? ''
  const hospitalCode = searchParams.get('hospitalCode') ?? ''
  const writeStatus = searchParams.get('writeStatus') ?? ''
  const replyStatus = searchParams.get('replyStatus') ?? ''
  const authorId = searchParams.get('authorId') ?? ''
  const orderBy = searchParams.get('orderBy') ?? 'createdAt'
  const order = (searchParams.get('order') ?? 'desc') as 'asc' | 'desc'

  const validOrderBy = ['requestDate', 'replyDate', 'writeStatus', 'replyStatus', 'createdAt']
  const safeOrderBy = validOrderBy.includes(orderBy) ? orderBy : 'createdAt'

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
    ...(writeStatus && { writeStatus }),
    ...(replyStatus && { replyStatus }),
    ...(authorId && { assignees: { some: { userId: authorId } } }),
  }

  const installPlans = await prisma.installPlan.findMany({
    where,
    orderBy: { [safeOrderBy]: order },
    include: {
      hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true } },
      assignees: { include: { user: { select: { id: true, name: true } } } },
    },
  })

  return NextResponse.json({ installPlans })
}

export async function POST(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { hospitalCode, requestDate, writeStatus, replyStatus, assigneeIds, replyDate, note } = body

  const created = await prisma.installPlan.create({
    data: {
      hospitalCode: hospitalCode || null,
      requestDate: requestDate ? new Date(requestDate) : null,
      writeStatus: writeStatus ?? '-',
      replyStatus: replyStatus ?? '-',
      replyDate: replyDate ? new Date(replyDate) : null,
      note: note || null,
    },
  })

  // assignees 생성
  if (Array.isArray(assigneeIds) && assigneeIds.length > 0) {
    await prisma.installPlanAssignee.createMany({
      data: assigneeIds.map((userId: string) => ({
        installPlanId: created.id,
        userId,
      })),
    })
  }

  // planCode 생성: IP-YYYYMM-NNNNN
  const now = new Date()
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const ipPrefix = `IP-${ym}-`
  const lastPlan = await prisma.installPlan.findFirst({
    where: { planCode: { startsWith: ipPrefix } },
    orderBy: { planCode: 'desc' },
    select: { planCode: true },
  })
  const ipSeq = lastPlan?.planCode ? parseInt(lastPlan.planCode.slice(-5)) + 1 : 1
  const planCode = `${ipPrefix}${String(ipSeq).padStart(5, '0')}`

  const installPlan = await prisma.installPlan.update({
    where: { id: created.id },
    data: { planCode },
    include: {
      hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true } },
      assignees: { include: { user: { select: { id: true, name: true } } } },
    },
  })

  // 티켓 동시 생성 (P8 편입)
  const ticketId = await prisma.$transaction(async (tx) => {
    return createTicketForInstallPlan(tx, {
      id: installPlan.id,
      planCode,
      hospitalCode: installPlan.hospitalCode,
      hospitalName: installPlan.hospital?.hospitalName ?? installPlan.hospital?.hiraHospitalName ?? null,
      writeStatus: installPlan.writeStatus,
      replyStatus: installPlan.replyStatus,
      assigneeUserIds: Array.isArray(assigneeIds) ? assigneeIds : [],
      createdAt: installPlan.createdAt,
      replyDate: installPlan.replyDate,
    }, authUser.userId, 'domain')
  })

  const hospitalName = installPlan.hospital?.hospitalName || installPlan.hospital?.hiraHospitalName || ''

  await logAudit({
    req: request,
    actor: auditActorFromJWT(authUser),
    action: 'CREATE',
    resource: 'install_plan',
    resourceId: installPlan.planCode ?? String(installPlan.id),
    resourceLabel: `${hospitalName || '병원 미지정'} 설치계획`,
    after: installPlan,
  })

  await advanceHospitalStatus({
    hospitalCode: hospitalCode || null,
    targetStatus: '가견적요청',
    req: request,
    actor: auditActorFromJWT(authUser),
    source: '설치계획 등록',
  })

  // Slack 알림 (등록, P11 티켓 파이프라인) — best-effort
  notifyTicketCreated({ ticketId, actorName: authUser.name }).catch(() => {})

  return NextResponse.json({ installPlan }, { status: 201 })
}
