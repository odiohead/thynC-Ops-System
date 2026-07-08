import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const items = await prisma.navMenuItem.findMany({
    orderBy: [{ parentKey: 'asc' }, { sortOrder: 'asc' }],
  })

  const organizations = await prisma.organization.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { code: true, name: true },
  })

  return NextResponse.json({ items, organizations })
}

const VALID_ROLES = ['SUPER_ADMIN', 'ADMIN', 'USER', 'VIEWER']

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { menuKey, label, href, iconKey, parentKey, allowedRoles, allowedOrgCodes, sortOrder, groupLabel } = body

  if (!menuKey?.trim()) {
    return NextResponse.json({ error: '메뉴 키를 입력해주세요.' }, { status: 400 })
  }
  if (!label?.trim()) {
    return NextResponse.json({ error: '메뉴명을 입력해주세요.' }, { status: 400 })
  }
  if (!href?.trim() || !href.startsWith('/')) {
    return NextResponse.json({ error: '경로는 /로 시작해야 합니다.' }, { status: 400 })
  }

  if (allowedRoles?.length) {
    const invalid = allowedRoles.filter((r: string) => !VALID_ROLES.includes(r))
    if (invalid.length) {
      return NextResponse.json({ error: `잘못된 역할: ${invalid.join(', ')}` }, { status: 400 })
    }
  }

  const existing = await prisma.navMenuItem.findUnique({ where: { menuKey: menuKey.trim() } })
  if (existing) {
    return NextResponse.json({ error: '이미 존재하는 메뉴 키입니다.' }, { status: 409 })
  }

  const item = await prisma.navMenuItem.create({
    data: {
      menuKey: menuKey.trim(),
      label: label.trim(),
      href: href.trim(),
      iconKey: iconKey || null,
      parentKey: parentKey || null,
      groupLabel: groupLabel?.trim() || null,
      allowedRoles: allowedRoles ?? [],
      allowedOrgCodes: allowedOrgCodes ?? [],
      sortOrder: sortOrder ?? 0,
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:nav_menu',
    resourceId: item.id,
    resourceLabel: `${item.label} (${item.menuKey})`,
    after: item,
  })

  return NextResponse.json({ item }, { status: 201 })
}
