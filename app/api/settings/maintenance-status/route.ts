import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function GET() {
  const statusCodes = await prisma.statusCode.findMany({
    where: { category: 'MAINTENANCE_STATUS' },
    orderBy: { order: 'asc' },
  })

  return NextResponse.json({ statusCodes })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { name, order, color } = await request.json()

  if (!name?.trim()) {
    return NextResponse.json({ error: '유지보수 상태명을 입력해주세요.' }, { status: 400 })
  }

  const existing = await prisma.statusCode.findFirst({ where: { name, category: 'MAINTENANCE_STATUS' } })
  if (existing) {
    return NextResponse.json({ error: '이미 존재하는 유지���수 상태명입니다.' }, { status: 409 })
  }

  const statusCode = await prisma.statusCode.create({
    data: { name: name.trim(), order: order ?? 0, color: color ?? null, category: 'MAINTENANCE_STATUS' },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:maintenance_status',
    resourceId: statusCode.id,
    resourceLabel: statusCode.name,
    after: statusCode,
  })

  return NextResponse.json({ statusCode }, { status: 201 })
}
