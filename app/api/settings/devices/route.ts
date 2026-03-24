import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function GET() {
  const devices = await prisma.deviceInfo.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: {
      _count: { select: { devices: true } },
    },
  })

  return NextResponse.json({
    devices: devices.map((d) => ({
      id: d.id,
      deviceModel: d.deviceModel,
      deviceName: d.deviceName,
      isActive: d.isActive,
      sortOrder: d.sortOrder,
      createdAt: d.createdAt,
      usageCount: d._count.devices,
    })),
  })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { deviceModel, deviceName, sortOrder, isActive } = await request.json()

  if (!deviceModel?.trim()) {
    return NextResponse.json({ error: '모델 코드를 입력해주세요.' }, { status: 400 })
  }
  if (!deviceName?.trim()) {
    return NextResponse.json({ error: '기기명을 입력해주세요.' }, { status: 400 })
  }

  const existing = await prisma.deviceInfo.findUnique({ where: { deviceModel: deviceModel.trim() } })
  if (existing) {
    return NextResponse.json({ error: '이미 존재하는 모델 코드입니다.' }, { status: 409 })
  }

  const device = await prisma.deviceInfo.create({
    data: {
      deviceModel: deviceModel.trim(),
      deviceName: deviceName.trim(),
      sortOrder: sortOrder ?? 0,
      isActive: isActive ?? true,
    },
  })

  return NextResponse.json({ device }, { status: 201 })
}
