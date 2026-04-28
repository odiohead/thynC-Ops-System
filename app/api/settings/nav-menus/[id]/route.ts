import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

type Params = { params: { id: string } }

const VALID_ROLES = ['SUPER_ADMIN', 'ADMIN', 'USER', 'VIEWER']

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const id = parseInt(params.id)
  if (isNaN(id)) {
    return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })
  }

  const existing = await prisma.navMenuItem.findUnique({ where: { id } })
  if (!existing) {
    return NextResponse.json({ error: '메뉴 항목을 찾을 수 없습니다.' }, { status: 404 })
  }

  const body = await request.json()
  const { label, iconKey, allowedRoles, allowedOrgCodes, isActive, sortOrder } = body

  if (label !== undefined && !label?.trim()) {
    return NextResponse.json({ error: '메뉴명을 입력해주세요.' }, { status: 400 })
  }

  if (allowedRoles !== undefined && allowedRoles?.length) {
    const invalid = allowedRoles.filter((r: string) => !VALID_ROLES.includes(r))
    if (invalid.length) {
      return NextResponse.json({ error: `잘못된 역할: ${invalid.join(', ')}` }, { status: 400 })
    }
  }

  const data: Record<string, unknown> = {}
  if (label !== undefined) data.label = label.trim()
  if (iconKey !== undefined) data.iconKey = iconKey || null
  if (allowedRoles !== undefined) data.allowedRoles = allowedRoles
  if (allowedOrgCodes !== undefined) data.allowedOrgCodes = allowedOrgCodes
  if (isActive !== undefined) data.isActive = isActive
  if (sortOrder !== undefined) data.sortOrder = sortOrder

  const item = await prisma.navMenuItem.update({ where: { id }, data })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:nav_menu',
    resourceId: id,
    resourceLabel: `${item.label} (${item.menuKey})`,
    before: existing,
    after: item,
  })

  return NextResponse.json({ item })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const id = parseInt(params.id)
  if (isNaN(id)) {
    return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })
  }

  const existing = await prisma.navMenuItem.findUnique({ where: { id } })
  if (!existing) {
    return NextResponse.json({ error: '메뉴 항목을 찾을 수 없습니다.' }, { status: 404 })
  }

  // 하위 항목이 있으면 삭제 불가
  const childCount = await prisma.navMenuItem.count({ where: { parentKey: existing.menuKey } })
  if (childCount > 0) {
    return NextResponse.json(
      { error: `하위 메뉴가 ${childCount}개 있어 삭제할 수 없습니다. 하위 메뉴를 먼저 삭제해주세요.` },
      { status: 409 }
    )
  }

  await prisma.navMenuItem.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'setting:nav_menu',
    resourceId: id,
    resourceLabel: `${existing.label} (${existing.menuKey})`,
    before: existing,
  })

  return NextResponse.json({ success: true })
}
