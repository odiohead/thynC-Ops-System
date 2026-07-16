import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// 인벤토리 마스터 (대웅제약재고/평가용재고/판매용재고 등) — 조회는 로그인 전체 (전표 모달·필터에서 사용)
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const inventories = await prisma.inventory.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })
  return NextResponse.json({ inventories })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const name = body.name?.trim()
  if (!name) return NextResponse.json({ error: '인벤토리 이름을 입력해주세요.' }, { status: 400 })

  const existing = await prisma.inventory.findUnique({ where: { name } })
  if (existing) return NextResponse.json({ error: '이미 존재하는 인벤토리입니다.' }, { status: 409 })

  const inventory = await prisma.inventory.create({
    data: {
      name,
      linkHospital: !!body.linkHospital,
      memo: body.memo?.trim() || null,
      sortOrder: body.sortOrder ?? 0,
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:inventory',
    resourceId: inventory.id,
    resourceLabel: inventory.name,
    after: inventory,
  })

  return NextResponse.json({ inventory }, { status: 201 })
}
