import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function GET() {
  const reasons = await prisma.ticketPendingReason.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })
  return NextResponse.json({ reasons })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: '대기 사유명을 입력하세요.' }, { status: 400 })

  const existing = await prisma.ticketPendingReason.findUnique({ where: { name } })
  if (existing) return NextResponse.json({ error: '이미 존재하는 대기 사유입니다.' }, { status: 409 })

  const reason = await prisma.ticketPendingReason.create({
    data: { name, sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : 0 },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:ticket_pending_reason',
    resourceId: reason.id,
    resourceLabel: reason.name,
    after: reason,
  })

  return NextResponse.json({ reason }, { status: 201 })
}
