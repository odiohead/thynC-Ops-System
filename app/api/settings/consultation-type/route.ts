import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export async function GET() {
  const statusCodes = await prisma.statusCode.findMany({
    where: { category: 'CONSULTATION_TYPE' },
    orderBy: { order: 'asc' },
  })

  return NextResponse.json({ statusCodes })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { name, order, color } = await request.json()

  if (!name?.trim()) {
    return NextResponse.json({ error: '상담유형명을 입력해주세요.' }, { status: 400 })
  }

  const existing = await prisma.statusCode.findFirst({ where: { name, category: 'CONSULTATION_TYPE' } })
  if (existing) {
    return NextResponse.json({ error: '이미 존재하는 상담유형명입니다.' }, { status: 409 })
  }

  const statusCode = await prisma.statusCode.create({
    data: { name: name.trim(), order: order ?? 0, color: color ?? null, category: 'CONSULTATION_TYPE' },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:consultation_type',
    resourceId: statusCode.id,
    resourceLabel: statusCode.name,
    after: statusCode,
  })

  return NextResponse.json({ statusCode }, { status: 201 })
}
