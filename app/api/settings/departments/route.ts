import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const organizationId = searchParams.get('organizationId')
  if (!organizationId) return NextResponse.json({ error: 'organizationId 파라미터가 필요합니다.' }, { status: 400 })

  const departments = await prisma.department.findMany({
    where: { organizationId: parseInt(organizationId) },
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { users: true } } },
  })
  return NextResponse.json(departments)
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, organizationId, sortOrder } = await req.json()
  if (!name || !name.trim()) return NextResponse.json({ error: '부서명을 입력해주세요.' }, { status: 400 })
  if (!organizationId) return NextResponse.json({ error: 'organizationId가 필요합니다.' }, { status: 400 })

  const existing = await prisma.department.findFirst({
    where: { organizationId: parseInt(organizationId), name: name.trim() },
  })
  if (existing) return NextResponse.json({ error: '이미 존재하는 부서명입니다.' }, { status: 409 })

  const department = await prisma.department.create({
    data: {
      name: name.trim(),
      organizationId: parseInt(organizationId),
      sortOrder: sortOrder ?? 0,
    },
    include: { _count: { select: { users: true } } },
  })

  await logAudit({
    req,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:department',
    resourceId: department.id,
    resourceLabel: department.name,
    after: department,
  })

  return NextResponse.json(department, { status: 201 })
}
