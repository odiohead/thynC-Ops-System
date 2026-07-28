import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function GET() {
  const offices = await prisma.salesOffice.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: {
      reps: { orderBy: [{ isActive: 'desc' }, { name: 'asc' }] },
      _count: { select: { channels: true } },
    },
  })
  // 사무소 미지정 담당자도 노출
  const orphanReps = await prisma.salesRep.findMany({ where: { officeId: null }, orderBy: { name: 'asc' } })
  return NextResponse.json({ offices, orphanReps })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { division, name, sortOrder } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: '사무소명을 입력해주세요.' }, { status: 400 })

  const existing = await prisma.salesOffice.findUnique({ where: { name: name.trim() } })
  if (existing) return NextResponse.json({ error: '이미 존재하는 사무소입니다.' }, { status: 409 })

  const office = await prisma.salesOffice.create({
    data: {
      name: name.trim(),
      division: typeof division === 'string' && division.trim() ? division.trim() : null,
      sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:sales_office',
    resourceId: office.id,
    resourceLabel: office.name,
    after: office,
  })

  return NextResponse.json({ office }, { status: 201 })
}
