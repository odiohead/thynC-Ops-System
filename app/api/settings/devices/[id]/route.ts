import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

type Params = { params: { id: string } }

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const { deviceModel, deviceName, sortOrder, isActive } = await request.json()

  if (!deviceModel?.trim()) {
    return NextResponse.json({ error: '모델 코드를 입력해주세요.' }, { status: 400 })
  }
  if (!deviceName?.trim()) {
    return NextResponse.json({ error: '기기명을 입력해주세요.' }, { status: 400 })
  }

  const duplicate = await prisma.deviceInfo.findFirst({
    where: { deviceModel: deviceModel.trim(), id: { not: id } },
  })
  if (duplicate) {
    return NextResponse.json({ error: '이미 존재하는 모델 코드입니다.' }, { status: 409 })
  }

  const device = await prisma.deviceInfo.update({
    where: { id },
    data: {
      deviceModel: deviceModel.trim(),
      deviceName: deviceName.trim(),
      sortOrder: sortOrder ?? 0,
      isActive: isActive ?? true,
    },
  })

  return NextResponse.json({ device })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const device = await prisma.deviceInfo.findUnique({ where: { id } })
  if (!device) return NextResponse.json({ error: '기기를 찾을 수 없습니다.' }, { status: 404 })

  const usageCount = await prisma.projectDevice.count({ where: { deviceInfoId: id } })
  if (usageCount > 0) {
    // 참조 중이면 삭제 불가 → 비활성화 처리
    await prisma.deviceInfo.update({ where: { id }, data: { isActive: false } })
    return NextResponse.json({
      deactivated: true,
      message: `${usageCount}개 프로젝트에서 사용 중이어서 삭제할 수 없습니다. 비활성화 처리되었습니다.`,
    })
  }

  await prisma.deviceInfo.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
