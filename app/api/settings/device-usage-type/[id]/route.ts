import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { DEVICE_USAGE_TYPE_CATEGORY } from '@/lib/deviceRegistryShared'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/** PUT /api/settings/device-usage-type/[id] — 이름·순서 수정 (ADMIN+). value(시스템 의미 SALE/EVAL)는 변경 불가 */
export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!isAdminOrAbove(user.role)) return NextResponse.json({ error: '기기 용도 관리는 ADMIN 이상만 가능합니다.' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: '요청 본문이 올바르지 않습니다.' }, { status: 400 })
  const { name, order } = body as { name?: unknown; order?: unknown }

  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) return NextResponse.json({ error: '용도명을 입력해주세요.' }, { status: 400 })
  const orderNum = order == null || order === '' ? undefined : Number(order)
  if (orderNum !== undefined && !Number.isInteger(orderNum)) return NextResponse.json({ error: '순서는 정수여야 합니다.' }, { status: 400 })

  const before = await prisma.statusCode.findUnique({ where: { id } })
  if (!before || before.category !== DEVICE_USAGE_TYPE_CATEGORY) {
    return NextResponse.json({ error: '용도를 찾을 수 없습니다.' }, { status: 404 })
  }

  const duplicate = await prisma.statusCode.findFirst({
    where: { name: trimmed, category: DEVICE_USAGE_TYPE_CATEGORY, id: { not: id } },
  })
  if (duplicate) return NextResponse.json({ error: '이미 존재하는 용도명입니다.' }, { status: 409 })

  const statusCode = await prisma.statusCode.update({
    where: { id },
    data: { name: trimmed, ...(orderNum !== undefined ? { order: orderNum } : {}) },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:device_usage_type',
    resourceId: id,
    resourceLabel: statusCode.name,
    before,
    after: statusCode,
  })

  return NextResponse.json({ statusCode })
}

/**
 * DELETE /api/settings/device-usage-type/[id] — 삭제 (ADMIN+)
 * value가 있는 행(시스템 용도 SALE/EVAL) 409 · 유닛(device_units.usage_type_id)이 참조 중이면 409 (FK RESTRICT 선검사)
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!isAdminOrAbove(user.role)) return NextResponse.json({ error: '기기 용도 관리는 ADMIN 이상만 가능합니다.' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const sc = await prisma.statusCode.findUnique({ where: { id } })
  if (!sc || sc.category !== DEVICE_USAGE_TYPE_CATEGORY) {
    return NextResponse.json({ error: '용도를 찾을 수 없습니다.' }, { status: 404 })
  }

  if (sc.value) return NextResponse.json({ error: '시스템 용도는 삭제할 수 없습니다' }, { status: 409 })

  const unitCount = await prisma.deviceUnit.count({ where: { usageTypeId: id } })
  if (unitCount > 0) return NextResponse.json({ error: '사용 중인 용도입니다' }, { status: 409 })

  await prisma.statusCode.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'setting:device_usage_type',
    resourceId: id,
    resourceLabel: sc.name,
    before: sc,
  })

  return NextResponse.json({ success: true })
}
