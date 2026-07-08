import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { categoryDepth, categoryPath } from '@/lib/inventory'

export const dynamic = 'force-dynamic'

const MAX_DEPTH = 3 // 대 > 중 > 소

export async function GET() {
  const categories = await prisma.inventoryCategory.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: { _count: { select: { items: true, children: true } } },
  })
  return NextResponse.json({
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      parentId: c.parentId,
      sortOrder: c.sortOrder,
      itemCount: c._count.items,
      childCount: c._count.children,
    })),
  })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, parentId, sortOrder } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: '분류명을 입력해주세요.' }, { status: 400 })

  const all = await prisma.inventoryCategory.findMany({ select: { id: true, name: true, parentId: true, sortOrder: true } })

  if (parentId != null) {
    const parent = all.find((c) => c.id === parentId)
    if (!parent) return NextResponse.json({ error: '상위 분류를 찾을 수 없습니다.' }, { status: 404 })
    if (categoryDepth(all, parentId) >= MAX_DEPTH) {
      return NextResponse.json({ error: `분류는 최대 ${MAX_DEPTH}단계(대>중>소)까지만 가능합니다.` }, { status: 400 })
    }
  }

  const dup = all.find((c) => c.parentId === (parentId ?? null) && c.name === name.trim())
  if (dup) return NextResponse.json({ error: '같은 상위 분류 아래에 이미 있는 이름입니다.' }, { status: 409 })

  const category = await prisma.inventoryCategory.create({
    data: { name: name.trim(), parentId: parentId ?? null, sortOrder: sortOrder ?? 0 },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:item_category',
    resourceId: category.id,
    resourceLabel: categoryPath([...all, category], category.id),
    after: category,
  })

  return NextResponse.json({ category }, { status: 201 })
}
