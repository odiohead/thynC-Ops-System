import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { invalidatePermissionCache } from '@/lib/appRoles'
import { PERMISSIONS } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

// 역할의 권한 키 전체 교체 (SUPER_ADMIN 전용) — 키는 lib/permissions.ts 카탈로그만 허용

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(req)
  if (!user || !isSuperAdmin(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })

  const role = await prisma.appRole.findUnique({
    where: { id },
    include: { permissions: { select: { permKey: true } } },
  })
  if (!role) return NextResponse.json({ error: '역할을 찾을 수 없습니다.' }, { status: 404 })

  const body = await req.json().catch(() => null)
  if (!Array.isArray(body?.permissions)) {
    return NextResponse.json({ error: 'permissions 배열이 필요합니다.' }, { status: 400 })
  }

  const keys = Array.from(new Set(body.permissions as unknown[])).filter(
    (k): k is string => typeof k === 'string'
  )
  const invalid = keys.filter((k) => !(k in PERMISSIONS))
  if (invalid.length > 0) {
    return NextResponse.json({ error: `카탈로그에 없는 권한 키: ${invalid.join(', ')}` }, { status: 400 })
  }

  const beforeKeys = role.permissions.map((p) => p.permKey)

  await prisma.$transaction([
    prisma.appRolePermission.deleteMany({ where: { roleId: id } }),
    prisma.appRolePermission.createMany({ data: keys.map((permKey) => ({ roleId: id, permKey })) }),
  ])
  invalidatePermissionCache()

  await logAudit({
    req,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:app-roles',
    resourceId: id,
    resourceLabel: `역할 ${role.name} 권한 변경`,
    before: { permissions: beforeKeys },
    after: { permissions: keys },
  })

  return NextResponse.json({ permissions: keys })
}
