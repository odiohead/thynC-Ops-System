import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { invalidatePermissionCache } from '@/lib/appRoles'

export const dynamic = 'force-dynamic'

// 역할 멤버 추가/제거 (SUPER_ADMIN 전용)

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(req)
  if (!user || !isSuperAdmin(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })

  const role = await prisma.appRole.findUnique({ where: { id } })
  if (!role) return NextResponse.json({ error: '역할을 찾을 수 없습니다.' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const userId = typeof body?.userId === 'string' ? body.userId : ''
  if (!userId) return NextResponse.json({ error: 'userId가 필요합니다.' }, { status: 400 })

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, isActive: true },
  })
  if (!target || !target.isActive) {
    return NextResponse.json({ error: '활성 사용자를 찾을 수 없습니다.' }, { status: 404 })
  }

  const dup = await prisma.appUserRole.findUnique({
    where: { userId_roleId: { userId, roleId: id } },
  })
  if (dup) return NextResponse.json({ error: '이미 이 역할이 부여된 사용자입니다.' }, { status: 409 })

  const member = await prisma.appUserRole.create({ data: { userId, roleId: id } })
  invalidatePermissionCache()

  await logAudit({
    req,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:app-roles',
    resourceId: id,
    resourceLabel: `역할 ${role.name} 멤버 추가: ${target.name} (${target.email})`,
    after: { roleId: id, roleCode: role.code, userId, userName: target.name },
  })

  return NextResponse.json(member, { status: 201 })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(req)
  if (!user || !isSuperAdmin(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })

  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId') ?? ''
  if (!userId) return NextResponse.json({ error: 'userId가 필요합니다.' }, { status: 400 })

  const member = await prisma.appUserRole.findUnique({
    where: { userId_roleId: { userId, roleId: id } },
    include: {
      role: { select: { name: true, code: true } },
      user: { select: { name: true, email: true } },
    },
  })
  if (!member) return NextResponse.json({ error: '해당 멤버를 찾을 수 없습니다.' }, { status: 404 })

  await prisma.appUserRole.delete({ where: { id: member.id } })
  invalidatePermissionCache()

  await logAudit({
    req,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'setting:app-roles',
    resourceId: id,
    resourceLabel: `역할 ${member.role.name} 멤버 제거: ${member.user.name} (${member.user.email})`,
    before: { roleId: id, roleCode: member.role.code, userId, userName: member.user.name },
  })

  return NextResponse.json({ ok: true })
}
