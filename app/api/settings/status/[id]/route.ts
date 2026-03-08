import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: { id: string } }

export async function PUT(request: NextRequest, { params }: Params) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const { name, order } = await request.json()

  if (!name?.trim()) {
    return NextResponse.json({ error: '상태명을 입력해주세요.' }, { status: 400 })
  }

  // 같은 이름의 다른 항목이 있는지 확인
  const duplicate = await prisma.statusCode.findFirst({
    where: { name: name.trim(), id: { not: id } },
  })
  if (duplicate) {
    return NextResponse.json({ error: '이미 존재하는 상태명입니다.' }, { status: 409 })
  }

  const statusCode = await prisma.statusCode.update({
    where: { id },
    data: { name: name.trim(), order },
  })

  return NextResponse.json({ statusCode })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const sc = await prisma.statusCode.findUnique({ where: { id } })
  if (!sc) return NextResponse.json({ error: '상태값을 찾을 수 없습니다.' }, { status: 404 })

  const usageCount = await prisma.hospital.count({ where: { status: sc.name } })
  if (usageCount > 0) {
    return NextResponse.json(
      { error: `현재 ${usageCount}개 병원에서 사용 중인 상태값은 삭제할 수 없습니다.` },
      { status: 409 }
    )
  }

  await prisma.statusCode.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
