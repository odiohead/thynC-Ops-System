import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { SALES_CODE_CATEGORIES, type SalesCodeCategory } from '@/lib/sales'

export const dynamic = 'force-dynamic'

type Params = { params: { category: string } }

function resolveCategory(raw: string): SalesCodeCategory | null {
  const upper = raw.toUpperCase()
  return (SALES_CODE_CATEGORIES as readonly string[]).includes(upper) ? (upper as SalesCodeCategory) : null
}

export async function GET(_request: NextRequest, { params }: Params) {
  const category = resolveCategory(params.category)
  if (!category) return NextResponse.json({ error: '잘못된 카테고리입니다.' }, { status: 400 })
  const statusCodes = await prisma.statusCode.findMany({ where: { category }, orderBy: { order: 'asc' } })
  return NextResponse.json({ statusCodes })
}

export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const category = resolveCategory(params.category)
  if (!category) return NextResponse.json({ error: '잘못된 카테고리입니다.' }, { status: 400 })

  const { name, order, color } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: '이름을 입력해주세요.' }, { status: 400 })

  const existing = await prisma.statusCode.findFirst({ where: { name: name.trim(), category } })
  if (existing) return NextResponse.json({ error: '이미 존재하는 값입니다.' }, { status: 409 })

  const statusCode = await prisma.statusCode.create({
    data: { name: name.trim(), order: order ?? 0, category, color: typeof color === 'string' && color ? color : null },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: `setting:sales_code:${category.toLowerCase()}`,
    resourceId: statusCode.id,
    resourceLabel: statusCode.name,
    after: statusCode,
  })

  return NextResponse.json({ statusCode }, { status: 201 })
}
