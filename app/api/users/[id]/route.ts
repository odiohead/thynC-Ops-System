import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import bcrypt from 'bcryptjs'

type Params = { params: { id: string } }

const userSelect = {
  id: true,
  email: true,
  name: true,
  phone: true,
  role: true,
  isActive: true,
  createdAt: true,
  organization: { select: { id: true, name: true, code: true } },
} as const

/** ADMIN 전용: isActive 토글 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const authUser = await getAuthUser(req)
  if (!authUser || !isAdminOrAbove(authUser.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { isActive } = await req.json()
  const updated = await prisma.user.update({
    where: { id: params.id },
    data: { isActive },
    select: userSelect,
  })
  return NextResponse.json(updated)
}

/** 본인(ADMIN/USER/VIEWER) 또는 ADMIN: 이름/전화번호/비밀번호 수정. 역할/조직 변경은 ADMIN만 가능. */
export async function PUT(req: NextRequest, { params }: Params) {
  const authUser = await getAuthUser(req)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const isSelf = authUser.userId === params.id
  const isAdmin = isAdminOrAbove(authUser.role)

  if (!isSelf && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } })
  if (!target) return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 })

  const body = await req.json()
  const { name, phone, currentPassword, newPassword, role, organizationId } = body

  const updateData: Record<string, unknown> = {}

  if (name !== undefined) updateData.name = name
  if (phone !== undefined) updateData.phone = phone

  // 역할/조직 변경: ADMIN만 가능
  if (role !== undefined) {
    if (!isAdmin) {
      return NextResponse.json({ error: '역할 변경은 관리자만 가능합니다.' }, { status: 403 })
    }
    updateData.role = role
  }
  if (organizationId !== undefined) {
    if (!isAdmin) {
      return NextResponse.json({ error: '조직 변경은 관리자만 가능합니다.' }, { status: 403 })
    }
    updateData.organizationId = organizationId || null
  }

  // 비밀번호 변경
  if (newPassword) {
    if (!currentPassword) {
      return NextResponse.json({ error: '현재 비밀번호를 입력해주세요.' }, { status: 400 })
    }
    const valid = await bcrypt.compare(currentPassword, target.password)
    if (!valid) {
      return NextResponse.json({ error: '현재 비밀번호가 올바르지 않습니다.' }, { status: 400 })
    }
    if (newPassword.length < 6) {
      return NextResponse.json({ error: '새 비밀번호는 6자 이상이어야 합니다.' }, { status: 400 })
    }
    updateData.password = await bcrypt.hash(newPassword, 10)
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: '변경할 내용이 없습니다.' }, { status: 400 })
  }

  const updated = await prisma.user.update({
    where: { id: params.id },
    data: updateData,
    select: userSelect,
  })
  return NextResponse.json(updated)
}

/** ADMIN 전용: 계정 삭제 (자신은 삭제 불가) */
export async function DELETE(req: NextRequest, { params }: Params) {
  const authUser = await getAuthUser(req)
  if (!authUser || !isAdminOrAbove(authUser.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (authUser.userId === params.id) {
    return NextResponse.json({ error: '자신의 계정은 삭제할 수 없습니다.' }, { status: 400 })
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } })
  if (!target) return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 })

  await prisma.user.delete({ where: { id: params.id } })
  return NextResponse.json({ success: true })
}
