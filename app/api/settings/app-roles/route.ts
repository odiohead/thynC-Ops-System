import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// RBAC Lite 역할 관리 (projects/rbac_design.md §7) — 역할 정의·부여는 SUPER_ADMIN 전용

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user || !isSuperAdmin(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const roles = await prisma.appRole.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: {
      permissions: { select: { permKey: true } },
      users: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              isActive: true,
              organization: { select: { name: true } },
              department: { select: { name: true } },
            },
          },
        },
      },
    },
  })

  return NextResponse.json({
    roles: roles.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      isActive: r.isActive,
      sortOrder: r.sortOrder,
      permissions: r.permissions.map((p) => p.permKey),
      members: r.users,
    })),
  })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user || !isSuperAdmin(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : ''
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const description = typeof body?.description === 'string' ? body.description.trim() || null : null

  if (!code || !/^[A-Z][A-Z0-9_]{1,49}$/.test(code)) {
    return NextResponse.json({ error: '코드는 영문 대문자·숫자·언더스코어 2~50자여야 합니다. (예: INVENTORY_MANAGER)' }, { status: 400 })
  }
  if (!name) return NextResponse.json({ error: '역할 이름을 입력하세요.' }, { status: 400 })

  const dup = await prisma.appRole.findUnique({ where: { code } })
  if (dup) return NextResponse.json({ error: `이미 존재하는 코드입니다: ${code}` }, { status: 409 })

  const maxSort = await prisma.appRole.aggregate({ _max: { sortOrder: true } })
  const role = await prisma.appRole.create({
    data: { code, name, description, sortOrder: (maxSort._max.sortOrder ?? 0) + 10 },
  })

  await logAudit({
    req,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:app-roles',
    resourceId: role.id,
    resourceLabel: `역할 ${role.name} (${role.code})`,
    after: role,
  })

  return NextResponse.json(role, { status: 201 })
}
