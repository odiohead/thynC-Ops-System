import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { MAPPABLE_TICKET_STATUSES } from '@/lib/ticket-shared'

export const dynamic = 'force-dynamic'

// AS업무 워크플로 상태 (AS_STATUS) — as_work_design.md §4.3, 어댑터 SOP
export async function GET() {
  const statusCodes = await prisma.statusCode.findMany({
    where: { category: 'AS_STATUS' },
    orderBy: { order: 'asc' },
  })

  return NextResponse.json({ statusCodes })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { name, order, color, ticketStatus, ticketPendingReasonId } = await request.json()

  if (!name?.trim()) {
    return NextResponse.json({ error: 'AS업무 상태명을 입력해주세요.' }, { status: 400 })
  }

  // 티켓 상태 매핑 필수 (ticket_status_map_design.md §6 — 미매핑 신규 상태의 조용한 오동작 차단)
  if (!ticketStatus || !MAPPABLE_TICKET_STATUSES.includes(ticketStatus)) {
    return NextResponse.json({ error: '티켓 상태 매핑을 선택해주세요.' }, { status: 400 })
  }

  const existing = await prisma.statusCode.findFirst({ where: { name, category: 'AS_STATUS' } })
  if (existing) {
    return NextResponse.json({ error: '이미 존재하는 AS업무 상태명입니다.' }, { status: 409 })
  }

  const statusCode = await prisma.statusCode.create({
    data: {
      name: name.trim(), order: order ?? 0, color: color ?? null, category: 'AS_STATUS',
      ticketStatus,
      ticketPendingReasonId: ticketStatus === 'PENDING' ? (ticketPendingReasonId ?? null) : null,
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:as_status',
    resourceId: statusCode.id,
    resourceLabel: statusCode.name,
    after: statusCode,
  })

  return NextResponse.json({ statusCode }, { status: 201 })
}
