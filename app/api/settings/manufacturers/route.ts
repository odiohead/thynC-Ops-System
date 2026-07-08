import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function GET() {
  const statusCodes = await prisma.statusCode.findMany({
    where: { category: 'MANUFACTURER' },
    orderBy: { order: 'asc' },
  })
  return NextResponse.json({ statusCodes })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { name, order } = await request.json()

  if (!name?.trim()) return NextResponse.json({ error: '제조사명을 입력해주세요.' }, { status: 400 })

  const existing = await prisma.statusCode.findFirst({ where: { name: name.trim(), category: 'MANUFACTURER' } })
  if (existing) return NextResponse.json({ error: '이미 존재하는 제조사입니다.' }, { status: 409 })

  const statusCode = await prisma.statusCode.create({
    data: { name: name.trim(), order: order ?? 0, category: 'MANUFACTURER' },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:manufacturer',
    resourceId: statusCode.id,
    resourceLabel: statusCode.name,
    after: statusCode,
  })

  return NextResponse.json({ statusCode }, { status: 201 })
}
