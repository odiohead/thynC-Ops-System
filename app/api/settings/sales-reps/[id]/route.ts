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

  const before = await prisma.salesRep.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '담당자를 찾을 수 없습니다.' }, { status: 404 })

  const { officeId, name, phone, isActive } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: '담당자명을 입력해주세요.' }, { status: 400 })

  const oid = Number.isInteger(officeId) ? officeId : null
  if (oid !== null) {
    const office = await prisma.salesOffice.findUnique({ where: { id: oid } })
    if (!office) return NextResponse.json({ error: '사무소를 찾을 수 없습니다.' }, { status: 400 })
  }

  const rep = await prisma.salesRep.update({
    where: { id },
    data: {
      officeId: oid,
      name: name.trim(),
      phone: typeof phone === 'string' && phone.trim() ? phone.trim() : null,
      isActive: isActive !== false,
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:sales_rep',
    resourceId: id,
    resourceLabel: rep.name,
    before,
    after: rep,
  })

  return NextResponse.json({ rep })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const rep = await prisma.salesRep.findUnique({ where: { id }, include: { _count: { select: { channels: true } } } })
  if (!rep) return NextResponse.json({ error: '담당자를 찾을 수 없습니다.' }, { status: 404 })
  if (rep._count.channels > 0) return NextResponse.json({ error: `병원 ${rep._count.channels}곳의 채널에서 사용 중이라 삭제할 수 없습니다. 비활성화를 사용하세요.` }, { status: 409 })

  await prisma.salesRep.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'setting:sales_rep',
    resourceId: id,
    resourceLabel: rep.name,
    before: rep,
  })

  return NextResponse.json({ ok: true })
}
