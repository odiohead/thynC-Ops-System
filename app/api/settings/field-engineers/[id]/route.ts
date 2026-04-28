import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

type Params = { params: { id: string } }

export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const fe = await prisma.fieldEngineer.findUnique({
    where: { id: parseInt(params.id) },
    include: { user: { select: { name: true, email: true } } },
  })
  if (!fe) return NextResponse.json({ error: '필드 엔지니어를 찾을 수 없습니다.' }, { status: 404 })

  await prisma.fieldEngineer.delete({ where: { id: parseInt(params.id) } })

  await logAudit({
    req,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'setting:field_engineer',
    resourceId: parseInt(params.id),
    resourceLabel: `[${fe.workType}] ${fe.user.name}`,
    before: fe,
  })

  return new NextResponse(null, { status: 204 })
}
