import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

type Params = { params: { id: string } }

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const { name, plateNumber, model, seatCount, color, memo, sortOrder, isActive } = await request.json()

  if (!name?.trim()) {
    return NextResponse.json({ error: '차량 이름을 입력해주세요.' }, { status: 400 })
  }
  if (!plateNumber?.trim()) {
    return NextResponse.json({ error: '차량번호를 입력해주세요.' }, { status: 400 })
  }

  const duplicate = await prisma.vehicle.findFirst({
    where: { plateNumber: plateNumber.trim(), id: { not: id } },
  })
  if (duplicate) {
    return NextResponse.json({ error: '이미 등록된 차량번호입니다.' }, { status: 409 })
  }

  const before = await prisma.vehicle.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '차량을 찾을 수 없습니다.' }, { status: 404 })

  const vehicle = await prisma.vehicle.update({
    where: { id },
    data: {
      name: name.trim(),
      plateNumber: plateNumber.trim(),
      model: model?.trim() || null,
      seatCount: seatCount != null && seatCount !== '' ? Number(seatCount) : null,
      color: color?.trim() || null,
      memo: memo?.trim() || null,
      sortOrder: sortOrder ?? 0,
      isActive: isActive ?? true,
    },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'vehicle',
    resourceId: id,
    resourceLabel: `${vehicle.name} (${vehicle.plateNumber})`,
    before,
    after: vehicle,
  })

  return NextResponse.json({ vehicle })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const vehicle = await prisma.vehicle.findUnique({ where: { id } })
  if (!vehicle) return NextResponse.json({ error: '차량을 찾을 수 없습니다.' }, { status: 404 })

  const reservationCount = await prisma.vehicleReservation.count({ where: { vehicleId: id } })
  if (reservationCount > 0) {
    // 예약 이력이 있으면 삭제 대신 비활성화 (이력 보존)
    const updated = await prisma.vehicle.update({ where: { id }, data: { isActive: false } })
    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'vehicle',
      resourceId: id,
      resourceLabel: `${vehicle.name} (${vehicle.plateNumber}) (비활성화)`,
      before: vehicle,
      after: updated,
    })
    return NextResponse.json({
      deactivated: true,
      message: `예약 이력 ${reservationCount}건이 있어 삭제할 수 없습니다. 비활성화 처리되었습니다.`,
    })
  }

  await prisma.vehicle.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'vehicle',
    resourceId: id,
    resourceLabel: `${vehicle.name} (${vehicle.plateNumber})`,
    before: vehicle,
  })

  return NextResponse.json({ success: true })
}
