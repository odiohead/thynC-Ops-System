import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const before = await prisma.salesOffice.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '사무소를 찾을 수 없습니다.' }, { status: 404 })

  const { division, name, sortOrder, isActive } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: '사무소명을 입력해주세요.' }, { status: 400 })

  const duplicate = await prisma.salesOffice.findFirst({ where: { name: name.trim(), id: { not: id } } })
  if (duplicate) return NextResponse.json({ error: '이미 존재하는 사무소입니다.' }, { status: 409 })

  const office = await prisma.salesOffice.update({
    where: { id },
    data: {
      name: name.trim(),
      division: typeof division === 'string' && division.trim() ? division.trim() : null,
      sortOrder: Number.isInteger(sortOrder) ? sortOrder : before.sortOrder,
      isActive: isActive !== false,
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:sales_office',
    resourceId: id,
    resourceLabel: office.name,
    before,
    after: office,
  })

  return NextResponse.json({ office })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const office = await prisma.salesOffice.findUnique({
    where: { id },
    include: { _count: { select: { reps: true, channels: true } } },
  })
  if (!office) return NextResponse.json({ error: '사무소를 찾을 수 없습니다.' }, { status: 404 })
  if (office._count.reps > 0) return NextResponse.json({ error: `소속 담당자 ${office._count.reps}명이 있어 삭제할 수 없습니다. 담당자를 먼저 삭제·이동하거나 비활성화하세요.` }, { status: 409 })
  if (office._count.channels > 0) return NextResponse.json({ error: `병원 ${office._count.channels}곳의 채널에서 사용 중이라 삭제할 수 없습니다. 비활성화를 사용하세요.` }, { status: 409 })

  await prisma.salesOffice.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'setting:sales_office',
    resourceId: id,
    resourceLabel: office.name,
    before: office,
  })

  return NextResponse.json({ ok: true })
}
