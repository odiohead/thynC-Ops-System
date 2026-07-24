import { NextRequest, NextResponse } from 'next/server'
import { Prisma, TicketStatus, TicketSeverity } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { sanitizeRichTextHtml } from '@/lib/richtext'
import { generateTicketCode, addTicketEvent } from '@/lib/ticket'
import { notifyTaskEvent } from '@/lib/notify'

export const dynamic = 'force-dynamic'

const listInclude = {
  queue: { select: { id: true, name: true } },
  cti: { select: { id: true, name: true, level: true } },
  owner: { select: { id: true, name: true } },
  hospital: { select: { hospitalCode: true, hospitalName: true } },
  pendingReason: { select: { id: true, name: true } },
} as const

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const where: Prisma.TicketWhereInput = {}

  const queueId = sp.get('queueId')
  if (queueId) where.queueId = parseInt(queueId)

  const statuses = sp.getAll('status').filter((s): s is TicketStatus => s in TicketStatus)
  if (statuses.length) where.status = { in: statuses }
  else if (sp.get('open') === 'true') where.status = { notIn: ['RESOLVED', 'CLOSED'] }

  const severity = sp.get('severity')
  if (severity && severity in TicketSeverity) where.severity = severity as TicketSeverity

  // 유형 필터 — 'none'=순수 티켓(refType null), 그 외 도메인 유형(MAINTENANCE/ETC …)
  const refType = sp.get('refType')
  if (refType === 'none') where.refType = null
  else if (refType && ['MAINTENANCE', 'ETC', 'SITE_VISIT', 'INSTALL_PLAN', 'PROJECT'].includes(refType)) where.refType = refType

  if (sp.get('mine') === 'true') where.ownerId = user.userId
  else if (sp.get('unassigned') === 'true') where.ownerId = null
  else if (sp.get('ownerId')) where.ownerId = sp.get('ownerId')!

  const hospitalCode = sp.get('hospitalCode')
  if (hospitalCode) where.hospitalCode = hospitalCode

  const ctiId = sp.get('ctiId')
  if (ctiId) where.ctiId = parseInt(ctiId)

  const q = sp.get('q')?.trim()
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { ticketCode: { contains: q, mode: 'insensitive' } },
    ]
  }

  const page = Math.max(1, parseInt(sp.get('page') ?? '1') || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '30') || 30))

  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: listInclude,
      orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.ticket.count({ where }),
  ])

  return NextResponse.json({ tickets, total, page, pageSize })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 })

  const ctiId = typeof body.ctiId === 'number' ? body.ctiId : null
  if (!ctiId) return NextResponse.json({ error: '분류(CTI)를 선택하세요.' }, { status: 400 })

  const cti = await prisma.ticketCti.findUnique({ where: { id: ctiId } })
  if (!cti || !cti.isActive) return NextResponse.json({ error: '유효하지 않은 분류입니다.' }, { status: 400 })
  if (cti.level !== 3) return NextResponse.json({ error: '최하위(Item) 분류까지 선택하세요.' }, { status: 400 })

  // 큐: 명시 지정 > CTI 기본 큐 (라우팅)
  const queueId: number | null = typeof body.queueId === 'number' ? body.queueId : cti.defaultQueueId
  if (!queueId) return NextResponse.json({ error: '배정할 큐가 없습니다. 큐를 지정하거나 분류에 기본 큐를 설정하세요.' }, { status: 400 })
  const queue = await prisma.ticketQueue.findUnique({ where: { id: queueId } })
  if (!queue || !queue.isActive) return NextResponse.json({ error: '유효하지 않은 큐입니다.' }, { status: 400 })

  const severity: TicketSeverity =
    typeof body.severity === 'string' && body.severity in TicketSeverity ? body.severity : 'SEV4'

  const ownerId = typeof body.ownerId === 'string' && body.ownerId ? body.ownerId : null
  const hospitalCode = typeof body.hospitalCode === 'string' && body.hospitalCode ? body.hospitalCode : null

  // 서브 티켓으로 생성 (2레벨 고정 — 부모가 서브면 거부)
  let parentId: number | null = null
  let parentCode: string | null = null
  if (typeof body.parentId === 'number') {
    const parent = await prisma.ticket.findUnique({ where: { id: body.parentId } })
    if (!parent) return NextResponse.json({ error: '마스터 티켓을 찾을 수 없습니다.' }, { status: 404 })
    if (parent.parentId) return NextResponse.json({ error: '서브 티켓 아래에는 서브를 둘 수 없습니다 (2레벨 고정).' }, { status: 400 })
    if (parent.status === 'CLOSED') return NextResponse.json({ error: '종결된 티켓의 서브로 생성할 수 없습니다.' }, { status: 400 })
    parentId = parent.id
    parentCode = parent.ticketCode
  }
  const descriptionHtml = typeof body.descriptionHtml === 'string' ? sanitizeRichTextHtml(body.descriptionHtml) : null
  const participantIds: string[] = Array.isArray(body.participantIds)
    ? Array.from(new Set(body.participantIds.filter((v: unknown): v is string => typeof v === 'string')))
    : []

  // 채번 유니크 충돌 시 재시도 (동시 생성 대비)
  let ticket = null
  for (let attempt = 0; attempt < 3 && !ticket; attempt++) {
    try {
      ticket = await prisma.$transaction(async (tx) => {
        const ticketCode = await generateTicketCode(tx)
        const created = await tx.ticket.create({
          data: {
            ticketCode,
            title,
            descriptionHtml,
            severity,
            queueId,
            ctiId,
            ownerId,
            hospitalCode,
            parentId,
            status: ownerId ? 'ASSIGNED' : 'OPEN',
            createdBy: user.userId,
            participants: participantIds.length
              ? { create: participantIds.map((userId) => ({ userId })) }
              : undefined,
          },
          include: listInclude,
        })
        await addTicketEvent(tx, created.id, 'created', user.userId, { via: 'manual', queueId, severity })
        if (ownerId) await addTicketEvent(tx, created.id, 'assign', user.userId, { from: null, to: ownerId })
        if (parentId) {
          await addTicketEvent(tx, created.id, 'link', user.userId, { event: 'parent_set', parentId, parentCode })
          await addTicketEvent(tx, parentId, 'link', user.userId, { event: 'child_added', childId: created.id, childCode: created.ticketCode })
        }
        return created
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && attempt < 2) continue
      throw e
    }
  }
  if (!ticket) return NextResponse.json({ error: '티켓 번호 채번에 실패했습니다. 다시 시도하세요.' }, { status: 500 })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'ticket',
    resourceId: ticket.id,
    resourceLabel: `${ticket.ticketCode} ${ticket.title}`,
    after: ticket,
  })

  notifyTaskEvent({ eventType: 'task_created', taskType: 'TICKET', refCode: ticket.ticketCode, actorName: user.name }).catch(() => {})

  return NextResponse.json({ ticket }, { status: 201 })
}
