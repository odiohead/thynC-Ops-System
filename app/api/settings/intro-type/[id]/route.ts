import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'

type Params = { params: { id: string } }

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const { name, order, color } = await request.json()

  if (!name?.trim()) {
    return NextResponse.json({ error: '도입형태명을 입력해주세요.' }, { status: 400 })
  }

  const duplicate = await prisma.statusCode.findFirst({
    where: { name: name.trim(), category: 'INTRO_TYPE', id: { not: id } },
  })
  if (duplicate) {
    return NextResponse.json({ error: '이미 존재하는 도입형태입니다.' }, { status: 409 })
  }

  const introType = await prisma.statusCode.update({
    where: { id },
    data: { name: name.trim(), order, color: color !== undefined ? (color || null) : undefined },
  })

  return NextResponse.json({ introType })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const sc = await prisma.statusCode.findUnique({ where: { id } })
  if (!sc) return NextResponse.json({ error: '도입형태를 찾을 수 없습니다.' }, { status: 404 })

  const hospitalUsage = await prisma.hospitalIntroType.count({ where: { statusCodeId: id } })
  const projectUsage = await prisma.project.count({ where: { introTypeId: id } })
  const totalUsage = hospitalUsage + projectUsage
  if (totalUsage > 0) {
    return NextResponse.json(
      { error: `현재 ${totalUsage}개 항목에서 사용 중인 도입형태는 삭제할 수 없습니다.` },
      { status: 409 }
    )
  }

  await prisma.statusCode.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
