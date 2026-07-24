import { NextRequest, NextResponse } from 'next/server'
import { TicketSeverity } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { sanitizeRichTextHtml } from '@/lib/richtext'
import { addTicketEvent } from '@/lib/ticket'
import { syncTicketToDomain } from '@/lib/ticketDomain'
import { notifyTicketChanged } from '@/lib/notify'
import { getSlaRules, computeTicketDueAt } from '@/lib/delay-rules'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

const detailInclude = {
  queue: { select: { id: true, name: true } },
  cti: { select: { id: true, name: true, level: true, parentId: true } },
  owner: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true } },
  hospital: { select: { hospitalCode: true, hospitalName: true } },
  pendingReason: { select: { id: true, name: true } },
  participants: { include: { user: { select: { id: true, name: true } } } },
  maintenance: { select: { id: true, maintenanceCode: true, reporterName: true, isRemote: true, reportedAt: true } },
  etcTask: {
    select: {
      id: true, etcTaskCode: true, reportedAt: true,
      hospitals: { select: { hospital: { select: { hospitalCode: true, hospitalName: true } } } },
    },
  },
  siteVisit: {
    select: { id: true, siteVisitCode: true, requestDate: true, visitDate: true, replyDate: true, daewoongUser: { select: { name: true } } },
  },
  installPlan: { select: { id: true, planCode: true, requestDate: true, writeStatus: true, replyStatus: true, replyDate: true } },
  project: { select: { id: true, projectCode: true, projectName: true, startDate: true, endDateExpected: true, buildStatus: { select: { label: true } } } },
  parent: { select: { id: true, ticketCode: true, title: true, status: true } },
  children: {
    select: { id: true, ticketCode: true, title: true, status: true, severity: true, ownerId: true },
    orderBy: { id: 'asc' as const },
  },
} as const

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 숫자 id 또는 티켓번호(TK-YYYYMM-NNNNN) 둘 다 허용 — 페이지 라우팅은 티켓번호 기준
  const raw = decodeURIComponent(params.id)
  const where = /^\d+$/.test(raw) ? { id: parseInt(raw) } : { ticketCode: raw.toUpperCase() }

  const ticket = await prisma.ticket.findUnique({ where, include: detailInclude })
  if (!ticket) return NextResponse.json({ error: '티켓을 찾을 수 없습니다.' }, { status: 404 })

  return NextResponse.json({ ticket })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const before = await prisma.ticket.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '티켓을 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const data: {
    title?: string
    descriptionHtml?: string | null
    severity?: TicketSeverity
    ctiId?: number
    hospitalCode?: string | null
  } = {}

  if (typeof body.title === 'string') {
    const title = body.title.trim()
    if (!title) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 })
    data.title = title
  }
  if (body.descriptionHtml !== undefined) {
    data.descriptionHtml =
      typeof body.descriptionHtml === 'string' ? sanitizeRichTextHtml(body.descriptionHtml) : null
  }
  if (typeof body.severity === 'string') {
    if (!(body.severity in TicketSeverity)) return NextResponse.json({ error: '잘못된 심각도입니다.' }, { status: 400 })
    data.severity = body.severity as TicketSeverity
  }
  if (typeof body.ctiId === 'number') {
    const cti = await prisma.ticketCti.findUnique({ where: { id: body.ctiId } })
    if (!cti || !cti.isActive || cti.level !== 3) return NextResponse.json({ error: '유효하지 않은 분류입니다.' }, { status: 400 })
    data.ctiId = body.ctiId
  }
  if (body.hospitalCode !== undefined) {
    data.hospitalCode = typeof body.hospitalCode === 'string' && body.hospitalCode ? body.hospitalCode : null
  }

  // Sev 변경 → SLA(dueAt) 재산정 (PROJECT는 endDateExpected 소유 — 재산정 제외, P11)
  const sevChanged = !!data.severity && data.severity !== before.severity
  const dueAtUpdate =
    sevChanged && before.refType !== 'PROJECT'
      ? { dueAt: computeTicketDueAt(await getSlaRules(), data.severity!, before.createdAt) }
      : {}

  const ticket = await prisma.$transaction(async (tx) => {
    const updated = await tx.ticket.update({ where: { id }, data: { ...data, ...dueAtUpdate }, include: detailInclude })
    if (sevChanged) {
      await addTicketEvent(tx, id, 'sev_change', user.userId, { from: before.severity, to: data.severity })
    }
    if (data.ctiId && data.ctiId !== before.ctiId) {
      await addTicketEvent(tx, id, 'cti_change', user.userId, { from: before.ctiId, to: data.ctiId })
    }
    await syncTicketToDomain(tx, id, before.refType)
    return updated
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'ticket',
    resourceId: id,
    resourceLabel: `${ticket.ticketCode} ${ticket.title}`,
    before,
    after: ticket,
  })

  // Sev1·2 에스컬레이션 등 sig 변경 감지·발송 (best-effort)
  notifyTicketChanged({ ticketId: id, actorName: user.name }).catch(() => {})

  return NextResponse.json({ ticket })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const before = await prisma.ticket.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '티켓을 찾을 수 없습니다.' }, { status: 404 })

  await prisma.ticket.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'ticket',
    resourceId: id,
    resourceLabel: `${before.ticketCode} ${before.title}`,
    before,
  })

  return NextResponse.json({ ok: true })
}
