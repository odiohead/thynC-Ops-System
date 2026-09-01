import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isUserOrAbove, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import {
  ADMIN_ONLY_FIELDS_ERROR,
  hasAdminOnlyField,
  parseAdminOnlyFields,
  toDeviceInfoDto,
} from './shared'

export async function GET() {
  const devices = await prisma.deviceInfo.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: {
      // usageCount = 프로젝트 수량행 + 원장 개체(시리얼) + 딜 수량행 (hospital_device_registry_design.md §5.1)
      _count: { select: { devices: true, hospitalDevices: true, salesDealDevices: true } },
    },
  })

  return NextResponse.json({
    devices: devices.map((d) => ({
      ...toDeviceInfoDto(d),
      usageCount: d._count.devices + d._count.hospitalDevices + d._count.salesDealDevices,
      usage: {
        projects: d._count.devices,
        registry: d._count.hospitalDevices,
        deals: d._count.salesDealDevices,
      },
    })),
  })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isUserOrAbove(user.role)) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }
  const body = await request.json()
  const { deviceModel, deviceName, sortOrder, isActive } = body

  // 5필드(분류·온프렘 코드·시리얼 형식·원장 대상·수량 집계 대상)는 ADMIN+ 전용 — 기존 필드는 USER+ (가산 원칙)
  if (hasAdminOnlyField(body) && !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: ADMIN_ONLY_FIELDS_ERROR }, { status: 403 })
  }

  if (!deviceModel?.trim()) {
    return NextResponse.json({ error: '모델 코드를 입력해주세요.' }, { status: 400 })
  }
  if (!deviceName?.trim()) {
    return NextResponse.json({ error: '기기명을 입력해주세요.' }, { status: 400 })
  }

  const parsed = parseAdminOnlyFields(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
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
      // 미지정 필드는 DB 기본값(WEARABLE / NULL / NULL / false / true)
      ...parsed.data,
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'setting:device_info',
    resourceId: device.id,
    resourceLabel: `${device.deviceModel} ${device.deviceName}`,
    after: device,
  })

  return NextResponse.json({ device: toDeviceInfoDto(device) }, { status: 201 })
}
