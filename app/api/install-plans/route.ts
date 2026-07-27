import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { notifyTicketCreated } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'
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
  const statusId = searchParams.get('statusId') ?? ''
  const authorId = searchParams.get('authorId') ?? ''
  const orderBy = searchParams.get('orderBy') ?? 'createdAt'
  const order = (searchParams.get('order') ?? 'desc') as 'asc' | 'desc'

  const validOrderBy = ['requestDate', 'replyDate', 'createdAt']
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
    ...(statusId && { statusId: Number(statusId) }),
    ...(authorId && { assignees: { some: { userId: authorId } } }),
  }

  const installPlans = await prisma.installPlan.findMany({
    where,
    orderBy: { [safeOrderBy]: order },
    include: {
      hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true } },
      status: { select: { id: true, name: true, color: true, order: true } },
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
  const { hospitalCode, requestDate, statusId, assigneeIds, replyDate, note } = body

  // 단일 상태 축 (2026-07-27 전환) — 미지정 시 '접수'. write/reply 2축 컬럼은 deprecated(동결)
  let resolvedStatusId: number | null = null
  if (statusId) {
    const sc = await prisma.statusCode.findFirst({ where: { id: Number(statusId), category: 'INSTALL_PLAN_STATUS' }, select: { id: true } })
    if (!sc) return NextResponse.json({ error: '잘못된 상태입니다.' }, { status: 400 })
    resolvedStatusId = sc.id
  } else {
    const sc = await prisma.statusCode.findFirst({ where: { category: 'INSTALL_PLAN_STATUS', name: '접수' }, select: { id: true } })
    resolvedStatusId = sc?.id ?? null
  }

  const created = await prisma.installPlan.create({
    data: {
      hospitalCode: hospitalCode || null,
      requestDate: requestDate ? new Date(requestDate) : null,
      statusId: resolvedStatusId,
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
      status: { select: { id: true, name: true, color: true, order: true } },
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
      statusId: installPlan.statusId,
      statusName: installPlan.status?.name ?? null,
      assigneeUserIds: Array.isArray(assigneeIds) ? assigneeIds : [],
      note: installPlan.note,
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
  syncTicketClocksSafe(ticketId) // SLA 시계 생성 (알림과 독립 — lib/sla.ts)
  notifyTicketCreated({ ticketId, actorName: authUser.name, actorId: authUser.userId }).catch(() => {})

  return NextResponse.json({ installPlan }, { status: 201 })
}
