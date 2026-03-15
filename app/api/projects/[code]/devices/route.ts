import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: { code: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const project = await prisma.project.findUnique({ where: { projectCode: params.code } })
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })

  const devices = await prisma.projectDevice.findMany({
    where: { projectId: project.id },
    include: { deviceInfo: true },
    orderBy: { deviceInfo: { sortOrder: 'asc' } },
  })

  return NextResponse.json({ devices })
}

export async function POST(request: NextRequest, { params }: Params) {
  const project = await prisma.project.findUnique({ where: { projectCode: params.code } })
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })

  const { deviceInfoId, quantity } = await request.json()

  if (!deviceInfoId) {
    return NextResponse.json({ error: 'deviceInfoId는 필수입니다.' }, { status: 400 })
  }

  const deviceInfo = await prisma.deviceInfo.findUnique({ where: { id: deviceInfoId } })
  if (!deviceInfo) {
    return NextResponse.json({ error: '기기 정보를 찾을 수 없습니다.' }, { status: 404 })
  }

  const device = await prisma.projectDevice.upsert({
    where: {
      projectId_deviceInfoId: { projectId: project.id, deviceInfoId },
    },
    update: { quantity: quantity ?? 0 },
    create: { projectId: project.id, deviceInfoId, quantity: quantity ?? 0 },
    include: { deviceInfo: true },
  })

  return NextResponse.json({ device }, { status: 201 })
}
