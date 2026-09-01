import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isUserOrAbove, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import {
  ADMIN_ONLY_FIELDS_ERROR,
  hasAdminOnlyField,
  parseAdminOnlyFields,
  toDeviceInfoDto,
} from '../shared'

type Params = { params: { id: string } }

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isUserOrAbove(user.role)) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

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

  // 본문에 없는 5필드는 기존 값 유지(부분 갱신) — USER의 순서 이동·기본 필드 수정이 플래그를 초기화하지 않도록
  const parsed = parseAdminOnlyFields(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const duplicate = await prisma.deviceInfo.findFirst({
    where: { deviceModel: deviceModel.trim(), id: { not: id } },
  })
  if (duplicate) {
    return NextResponse.json({ error: '이미 존재하는 모델 코드입니다.' }, { status: 409 })
  }

  const before = await prisma.deviceInfo.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '기기를 찾을 수 없습니다.' }, { status: 404 })

  const device = await prisma.deviceInfo.update({
    where: { id },
    data: {
      deviceModel: deviceModel.trim(),
      deviceName: deviceName.trim(),
      sortOrder: sortOrder ?? 0,
      isActive: isActive ?? true,
      ...parsed.data,
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:device_info',
    resourceId: id,
    resourceLabel: `${device.deviceModel} ${device.deviceName}`,
    before,
    after: device,
  })

  return NextResponse.json({ device: toDeviceInfoDto(device) })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isUserOrAbove(user.role)) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const device = await prisma.deviceInfo.findUnique({ where: { id } })
  if (!device) return NextResponse.json({ error: '기기를 찾을 수 없습니다.' }, { status: 404 })

  // 참조 합산: 프로젝트 수량행 + 원장 유닛(시리얼, device_units.device_info_id) + 딜 수량행 (§5.1)
  const [projectCount, registryCount, dealCount] = await Promise.all([
    prisma.projectDevice.count({ where: { deviceInfoId: id } }),
    prisma.deviceUnit.count({ where: { deviceInfoId: id } }),
    prisma.salesDealDevice.count({ where: { deviceInfoId: id } }),
  ])
  const usageCount = projectCount + registryCount + dealCount

  if (usageCount > 0) {
    // 참조 중이면 삭제 불가 → 비활성화 처리
    const updated = await prisma.deviceInfo.update({ where: { id }, data: { isActive: false } })
    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'setting:device_info',
      resourceId: id,
      resourceLabel: `${device.deviceModel} ${device.deviceName} (비활성화)`,
      before: device,
      after: updated,
    })
    const parts = [
      projectCount > 0 ? `프로젝트 ${projectCount}건` : null,
      dealCount > 0 ? `딜 ${dealCount}건` : null,
      registryCount > 0 ? `원장 ${registryCount}대` : null,
    ].filter(Boolean)
    return NextResponse.json({
      deactivated: true,
      usage: { projects: projectCount, registry: registryCount, deals: dealCount },
      message: `${parts.join('·')}에서 사용 중이어서 삭제할 수 없습니다. 비활성화 처리되었습니다.`,
    })
  }

  await prisma.deviceInfo.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'setting:device_info',
    resourceId: id,
    resourceLabel: `${device.deviceModel} ${device.deviceName}`,
    before: device,
  })

  return NextResponse.json({ success: true })
}
