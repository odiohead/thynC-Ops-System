import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { MAPPABLE_TICKET_STATUSES } from '@/lib/ticket-shared'

type Params = { params: { id: string } }

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const { name, order, color, ticketStatus, ticketPendingReasonId } = await request.json()

  // ticketStatus 미전송(undefined)이면 매핑 유지 — 순서 교환 등 부분 수정 경로 보호
  if (ticketStatus !== undefined && !MAPPABLE_TICKET_STATUSES.includes(ticketStatus)) {
    return NextResponse.json({ error: '잘못된 티켓 상태 매핑입니다.' }, { status: 400 })
  }

  if (!name?.trim()) {
    return NextResponse.json({ error: 'AS업무 상태명을 입력해주세요.' }, { status: 400 })
  }

  const duplicate = await prisma.statusCode.findFirst({
    where: { name: name.trim(), category: 'AS_STATUS', id: { not: id } },
  })
  if (duplicate) {
    return NextResponse.json({ error: '이미 존재하는 AS업무 상태명입니다.' }, { status: 409 })
  }

  const before = await prisma.statusCode.findUnique({ where: { id } })
  if (!before || before.category !== 'AS_STATUS') {
    return NextResponse.json({ error: 'AS업무 상태를 찾을 수 없습니다.' }, { status: 404 })
  }

  const statusCode = await prisma.statusCode.update({
    where: { id },
    data: {
      name: name.trim(), order, color: color !== undefined ? (color || null) : undefined,
      ticketStatus: ticketStatus !== undefined ? ticketStatus : undefined,
      ticketPendingReasonId: ticketStatus !== undefined ? (ticketStatus === 'PENDING' ? ticketPendingReasonId ?? null : null) : undefined,
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:as_status',
    resourceId: id,
    resourceLabel: statusCode.name,
    before,
    after: statusCode,
  })

  return NextResponse.json({ statusCode })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const sc = await prisma.statusCode.findUnique({ where: { id } })
  if (!sc || sc.category !== 'AS_STATUS') {
    return NextResponse.json({ error: 'AS업무 상태를 찾을 수 없습니다.' }, { status: 404 })
  }

  const inUse = await prisma.asReceipt.count({ where: { statusId: id } })
  if (inUse > 0) {
    return NextResponse.json({ error: `이 상태를 사용하는 AS접수가 ${inUse}건 있어 삭제할 수 없습니다.` }, { status: 409 })
  }

  await prisma.statusCode.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'setting:as_status',
    resourceId: id,
    resourceLabel: sc.name,
    before: sc,
  })

  return NextResponse.json({ success: true })
}
