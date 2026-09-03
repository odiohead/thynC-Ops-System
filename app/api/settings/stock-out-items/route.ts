import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const ITEM_GROUPS = ['SYSTEM', 'WEARABLE'] as const

/**
 * 출고 품목 마스터 (stock_out_request_design.md §4.1 — 출고업무 전용, WMS 품목과 독립)
 * GET은 로그인 전원(요청 폼 옵션), 쓰기는 ADMIN 이상.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const items = await prisma.stockOutItem.findMany({
    orderBy: [{ itemGroup: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    include: { _count: { select: { requestItems: true } } },
  })
  return NextResponse.json({ items })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, itemGroup, sortOrder, isActive, wmsModelName } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: '품목명을 입력해주세요.' }, { status: 400 })
  if (!ITEM_GROUPS.includes(itemGroup)) return NextResponse.json({ error: '품목 그룹이 올바르지 않습니다.' }, { status: 400 })

  const dup = await prisma.stockOutItem.findUnique({ where: { name: name.trim() } })
  if (dup) return NextResponse.json({ error: '이미 존재하는 품목명입니다.' }, { status: 409 })

  const item = await prisma.stockOutItem.create({
    data: { name: name.trim(), itemGroup, sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0, isActive: isActive ?? true, wmsModelName: typeof wmsModelName === 'string' && wmsModelName.trim() ? wmsModelName.trim() : null },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:stock_out_item',
    resourceId: item.id,
    resourceLabel: item.name,
    after: item,
  })

  return NextResponse.json({ item }, { status: 201 })
}
