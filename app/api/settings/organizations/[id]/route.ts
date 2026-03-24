import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'

type Params = { params: { id: string } }

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const { name, sortOrder, isActive } = await request.json()

  if (name !== undefined && !name?.trim()) {
    return NextResponse.json({ error: '이름을 입력해주세요.' }, { status: 400 })
  }

  const existing = await prisma.organization.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: '조직을 찾을 수 없습니다.' }, { status: 404 })

  const organization = await prisma.organization.update({
    where: { id },
    data: {
      name: name !== undefined ? name.trim() : undefined,
      sortOrder: sortOrder !== undefined ? sortOrder : undefined,
      isActive: isActive !== undefined ? isActive : undefined,
    },
    include: { _count: { select: { users: true } } },
  })

  return NextResponse.json({ organization })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const existing = await prisma.organization.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: '조직을 찾을 수 없습니다.' }, { status: 404 })

  const userCount = await prisma.user.count({ where: { organizationId: id } })
  if (userCount > 0) {
    return NextResponse.json(
      { error: `해당 조직에 소속된 사용자(${userCount}명)가 있어 삭제할 수 없습니다.` },
      { status: 409 }
    )
  }

  await prisma.organization.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
