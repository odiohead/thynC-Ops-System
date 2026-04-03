import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'

type Params = { params: { id: string } }

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, sortOrder } = await req.json()
  const updateData: Record<string, unknown> = {}
  if (name !== undefined) updateData.name = name.trim()
  if (sortOrder !== undefined) updateData.sortOrder = sortOrder

  const department = await prisma.department.update({
    where: { id: parseInt(params.id) },
    data: updateData,
    include: { _count: { select: { users: true } } },
  })
  return NextResponse.json(department)
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const department = await prisma.department.findUnique({
    where: { id: parseInt(params.id) },
    include: { _count: { select: { users: true } } },
  })
  if (!department) return NextResponse.json({ error: '부서를 찾을 수 없습니다.' }, { status: 404 })

  if (department._count.users > 0) {
    return NextResponse.json({ error: '해당 부서에 소속된 계정이 있습니다.' }, { status: 409 })
  }

  await prisma.department.delete({ where: { id: parseInt(params.id) } })
  return NextResponse.json({ success: true })
}
