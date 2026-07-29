import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { SALES_CODE_CATEGORIES, type SalesCodeCategory } from '@/lib/sales'

export const dynamic = 'force-dynamic'

type Params = { params: { category: string; id: string } }

function resolveCategory(raw: string): SalesCodeCategory | null {
  const upper = raw.toUpperCase()
  return (SALES_CODE_CATEGORIES as readonly string[]).includes(upper) ? (upper as SalesCodeCategory) : null
}

async function guard(request: NextRequest, params: Params['params']) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const category = resolveCategory(params.category)
  if (!category) return { error: NextResponse.json({ error: '잘못된 카테고리입니다.' }, { status: 400 }) }
  const id = parseInt(params.id)
  if (isNaN(id)) return { error: NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 }) }
  const statusCode = await prisma.statusCode.findUnique({ where: { id } })
  if (!statusCode || statusCode.category !== category) return { error: NextResponse.json({ error: '값을 찾을 수 없습니다.' }, { status: 404 }) }
  return { user, category, id, statusCode }
}

/** 카테고리별 프로필·딜·활동·인물 사용 건수 (삭제 가드) */
async function usageCount(category: SalesCodeCategory, id: number): Promise<number> {
  switch (category) {
    case 'SALES_STAGE': return prisma.hospitalSalesProfile.count({ where: { stageId: id } })
    case 'SALES_DEAL_STATUS': return prisma.salesDeal.count({ where: { statusId: id } })
    case 'SALES_ACTIVITY_TYPE': return prisma.salesActivity.count({ where: { activityTypeId: id } })
    case 'PERSON_GROUP': return prisma.person.count({ where: { personGroupId: id } })
    case 'SALES_MODEL': return prisma.salesDeal.count({ where: { OR: [{ hospitalModelId: id }, { seersModelId: id }] } })
    case 'SALES_TAX_INVOICE': return prisma.salesDeal.count({ where: { taxInvoiceId: id } })
    case 'SALES_SETTLEMENT': return prisma.salesDeal.count({ where: { settlementId: id } })
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  const g = await guard(request, params)
  if ('error' in g) return g.error

  const body = await request.json()
  const { name, order } = body
  if (!name?.trim()) return NextResponse.json({ error: '이름을 입력해주세요.' }, { status: 400 })

  const duplicate = await prisma.statusCode.findFirst({ where: { name: name.trim(), category: g.category, id: { not: g.id } } })
  if (duplicate) return NextResponse.json({ error: '이미 존재하는 값입니다.' }, { status: 409 })

  const statusCode = await prisma.statusCode.update({
    where: { id: g.id },
    data: {
      name: name.trim(),
      order: Number.isInteger(order) ? order : g.statusCode.order,
      // color 미전송(undefined) 시 유지, null 전송 시 제거
      ...('color' in body ? { color: typeof body.color === 'string' && body.color ? body.color : null } : {}),
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(g.user),
    action: 'UPDATE',
    resource: `setting:sales_code:${g.category.toLowerCase()}`,
    resourceId: g.id,
    resourceLabel: statusCode.name,
    before: g.statusCode,
    after: statusCode,
  })

  return NextResponse.json({ statusCode })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const g = await guard(request, params)
  if ('error' in g) return g.error

  const used = await usageCount(g.category, g.id)
  if (used > 0) return NextResponse.json({ error: `사용 중인 값이라 삭제할 수 없습니다. (${used}건)` }, { status: 409 })

  await prisma.statusCode.delete({ where: { id: g.id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(g.user),
    action: 'DELETE',
    resource: `setting:sales_code:${g.category.toLowerCase()}`,
    resourceId: g.id,
    resourceLabel: g.statusCode.name,
    before: g.statusCode,
  })

  return NextResponse.json({ ok: true })
}
