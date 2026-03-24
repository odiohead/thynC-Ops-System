import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken, isAdminOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type Params = { params: { code: string } }

// GET: 상세 조회
export async function GET(_req: NextRequest, { params }: Params) {
  const constructor = await prisma.contractor.findUnique({
    where: { code: params.code },
  })
  if (!constructor) {
    return NextResponse.json({ error: '공사업체를 찾을 수 없습니다.' }, { status: 404 })
  }
  return NextResponse.json({ constructor })
}

// PUT: 수정 (ADMIN 전용)
export async function PUT(request: NextRequest, { params }: Params) {
  const cookieStore = cookies()
  const token = cookieStore.get('auth-token')?.value
  const user = token ? await verifyToken(token) : null
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
  }

  const existing = await prisma.contractor.findUnique({ where: { code: params.code } })
  if (!existing) {
    return NextResponse.json({ error: '공사업체를 찾을 수 없습니다.' }, { status: 404 })
  }

  const { name, bizRegNumber, managerName, managerPhone, managerEmail } = await request.json()
  if (!name?.trim()) {
    return NextResponse.json({ error: '업체명은 필수입니다.' }, { status: 400 })
  }

  const constructor = await prisma.contractor.update({
    where: { code: params.code },
    data: {
      name: name.trim(),
      bizRegNumber: bizRegNumber?.trim() || null,
      managerName: managerName?.trim() || null,
      managerPhone: managerPhone?.trim() || null,
      managerEmail: managerEmail?.trim() || null,
    },
  })

  return NextResponse.json({ constructor })
}

// DELETE: 삭제 (ADMIN 전용, 연결된 프로젝트 있으면 차단)
export async function DELETE(_req: NextRequest, { params }: Params) {
  const cookieStore = cookies()
  const token = cookieStore.get('auth-token')?.value
  const user = token ? await verifyToken(token) : null
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
  }

  const existing = await prisma.contractor.findUnique({
    where: { code: params.code },
    include: { _count: { select: { projects: true } } },
  })
  if (!existing) {
    return NextResponse.json({ error: '공사업체를 찾을 수 없습니다.' }, { status: 404 })
  }

  if (existing._count.projects > 0) {
    return NextResponse.json(
      { error: `연결된 프로젝트가 ${existing._count.projects}개 있어 삭제할 수 없습니다.` },
      { status: 409 }
    )
  }

  await prisma.contractor.delete({ where: { code: params.code } })
  return NextResponse.json({ success: true })
}
