import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { RECOVERY_REASON_CATEGORY, RECOVERY_REASON_VALUES } from '@/lib/deviceRegistryShared'

export const dynamic = 'force-dynamic'

/**
 * 회수 사유 마스터 (StatusCode DEVICE_RECOVERY_REASON — D5, §6.3·§7.1)
 * value는 시스템 의미(DEFECT·LOST·RETURN·DISPOSE·TRANSFER)로 로직이 결합돼 있어 UI에서는 라벨(name)·순서만 편집.
 * GET 로그인 / POST·PUT·DELETE ADMIN+ (§8.1 마스터는 isAdminOrAbove 직접 판정)
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const statusCodes = await prisma.statusCode.findMany({
    where: { category: RECOVERY_REASON_CATEGORY },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
  })
  return NextResponse.json({ statusCodes })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!isAdminOrAbove(user.role)) return NextResponse.json({ error: '회수 사유 관리는 ADMIN 이상만 가능합니다.' }, { status: 403 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: '요청 본문이 올바르지 않습니다.' }, { status: 400 })
  const { name, order, value } = body as { name?: unknown; order?: unknown; value?: unknown }

  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) return NextResponse.json({ error: '회수 사유명을 입력해주세요.' }, { status: 400 })
  const orderNum = order == null || order === '' ? 0 : Number(order)
  if (!Number.isInteger(orderNum)) return NextResponse.json({ error: '순서는 정수여야 합니다.' }, { status: 400 })

  // value(시스템 의미)는 유실 복구용으로만 허용 — 허용 어휘 밖 400, 이미 있는 value 409
  let sysValue: string | null = null
  if (value != null && value !== '') {
    if (typeof value !== 'string' || !(RECOVERY_REASON_VALUES as readonly string[]).includes(value.trim())) {
      return NextResponse.json({ error: `시스템 값은 ${RECOVERY_REASON_VALUES.join('·')} 중 하나여야 합니다.` }, { status: 400 })
    }
    sysValue = value.trim()
    const dupValue = await prisma.statusCode.findFirst({ where: { category: RECOVERY_REASON_CATEGORY, value: sysValue } })
    if (dupValue) return NextResponse.json({ error: `시스템 값 ${sysValue}은(는) 이미 '${dupValue.name}'에 지정되어 있습니다.` }, { status: 409 })
  }

  const existing = await prisma.statusCode.findFirst({ where: { name: trimmed, category: RECOVERY_REASON_CATEGORY } })
  if (existing) return NextResponse.json({ error: '이미 존재하는 회수 사유명입니다.' }, { status: 409 })

  const statusCode = await prisma.statusCode.create({
    data: { name: trimmed, order: orderNum, category: RECOVERY_REASON_CATEGORY, value: sysValue },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:device_recovery_reason',
    resourceId: statusCode.id,
    resourceLabel: statusCode.name,
    after: statusCode,
  })

  return NextResponse.json({ statusCode }, { status: 201 })
}
