import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { invalidatePermissionCache } from '@/lib/appRoles'

export const dynamic = 'force-dynamic'

// 역할 수정·삭제 (SUPER_ADMIN 전용). 코드(code)는 식별자라 생성 후 변경 불가

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(req)
  if (!user || !isSuperAdmin(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })

  const before = await prisma.appRole.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '역할을 찾을 수 없습니다.' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const data: { name?: string; description?: string | null; isActive?: boolean; sortOrder?: number } = {}

  if (typeof body?.name === 'string') {
    const name = body.name.trim()
    if (!name) return NextResponse.json({ error: '역할 이름을 입력하세요.' }, { status: 400 })
    data.name = name
  }
  if (body?.description !== undefined) {
    data.description = typeof body.description === 'string' ? body.description.trim() || null : null
  }
  if (typeof body?.isActive === 'boolean') data.isActive = body.isActive
  if (typeof body?.sortOrder === 'number') data.sortOrder = body.sortOrder

  const role = await prisma.appRole.update({ where: { id }, data })

  // 비활성 전환은 보유 권한 판정에 즉시 반영되어야 함
  invalidatePermissionCache()

  await logAudit({
    req,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:app-roles',
    resourceId: id,
    resourceLabel: `역할 ${role.name} (${role.code})`,
    before,
    after: role,
  })

  return NextResponse.json(role)
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(req)
  if (!user || !isSuperAdmin(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })

  const before = await prisma.appRole.findUnique({
    where: { id },
    include: { _count: { select: { users: true, permissions: true } } },
  })
  if (!before) return NextResponse.json({ error: '역할을 찾을 수 없습니다.' }, { status: 404 })

  // 멤버·권한은 FK Cascade로 함께 삭제 — 클라이언트에서 확인 후 호출
  await prisma.appRole.delete({ where: { id } })
  invalidatePermissionCache()

  await logAudit({
    req,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'setting:app-roles',
    resourceId: id,
    resourceLabel: `역할 ${before.name} (${before.code}) — 멤버 ${before._count.users}명·권한 ${before._count.permissions}개 함께 삭제`,
    before,
  })

  return NextResponse.json({ ok: true })
}
