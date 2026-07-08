import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

type Params = { params: { id: string } }

export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const manager = await prisma.inventoryManager.findUnique({
    where: { id },
    include: { user: { select: { name: true, email: true } } },
  })
  if (!manager) return NextResponse.json({ error: '재고 담당자를 찾을 수 없습니다.' }, { status: 404 })

  await prisma.inventoryManager.delete({ where: { id } })

  await logAudit({
    req,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'setting:inventory_manager',
    resourceId: id,
    resourceLabel: manager.user.name,
    before: manager,
  })

  return new NextResponse(null, { status: 204 })
}
