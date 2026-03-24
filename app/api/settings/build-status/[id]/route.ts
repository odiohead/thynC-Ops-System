import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

type Params = { params: { id: string } }

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const { label, color, sortOrder } = await request.json()

  if (!label?.trim()) {
    return NextResponse.json({ error: '상태명을 입력해주세요.' }, { status: 400 })
  }

  const buildStatus = await prisma.buildStatus.update({
    where: { id },
    data: { label: label.trim(), color: color !== undefined ? (color || null) : undefined, sortOrder },
  })

  return NextResponse.json({ buildStatus })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const bs = await prisma.buildStatus.findUnique({ where: { id } })
  if (!bs) return NextResponse.json({ error: '구축상태를 찾을 수 없습니다.' }, { status: 404 })

  const usageCount = await prisma.project.count({ where: { buildStatusId: id } })
  if (usageCount > 0) {
    return NextResponse.json(
      { error: `현재 ${usageCount}개 프로젝트에서 사용 중인 구축상태는 삭제할 수 없습니다.` },
      { status: 409 }
    )
  }

  await prisma.buildStatus.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
