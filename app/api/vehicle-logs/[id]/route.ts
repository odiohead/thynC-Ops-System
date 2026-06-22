import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { recalcVehicleLogs, checkOdometerConsistency } from '@/lib/vehicleLog'

type Params = { params: { id: string } }

const DRIVER_SELECT = { select: { id: true, name: true, email: true } }
const VEHICLE_SELECT = { select: { id: true, name: true, plateNumber: true, color: true } }

function fmtPeriod(startAt: Date, endAt: Date) {
  const f = (d: Date) =>
    d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  return `${f(startAt)}~${f(endAt)}`
}

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const log = await prisma.vehicleLog.findUnique({
    where: { id },
    include: { driver: DRIVER_SELECT, vehicle: VEHICLE_SELECT },
  })
  if (!log) return NextResponse.json({ error: '운행일지를 찾을 수 없습니다.' }, { status: 404 })

  return NextResponse.json({ log })
}

/** 수정: 운전자/작성자 본인 또는 ADMIN */
export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const before = await prisma.vehicleLog.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '운행일지를 찾을 수 없습니다.' }, { status: 404 })

  const isOwner = before.driverId === user.userId || before.createdById === user.userId
  if (!isOwner && !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: '본인 운행일지만 수정할 수 있습니다.' }, { status: 403 })
  }

  const body = await request.json()
  const startAt = body.startAt ? new Date(body.startAt) : before.startAt
  const endAt = body.endAt ? new Date(body.endAt) : before.endAt
  const endOdometer = body.endOdometer != null ? Number(body.endOdometer) : before.endOdometer

  if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
    return NextResponse.json({ error: '운행 시간이 올바르지 않습니다.' }, { status: 400 })
  }
  if (startAt >= endAt) {
    return NextResponse.json({ error: '종료 시각은 시작 시각보다 늦어야 합니다.' }, { status: 400 })
  }
  if (!Number.isInteger(endOdometer) || endOdometer < 0) {
    return NextResponse.json({ error: '최종 주행거리를 올바르게 입력해주세요.' }, { status: 400 })
  }

  // 운전자 변경: ADMIN만
  let driverId = before.driverId
  if (body.driverId !== undefined && body.driverId && isAdminOrAbove(user.role)) driverId = body.driverId

  const conflictMsg = await checkOdometerConsistency(before.vehicleId, endAt, endOdometer, id)
  if (conflictMsg) return NextResponse.json({ error: conflictMsg }, { status: 400 })

  const log = await prisma.$transaction(async (tx) => {
    await tx.vehicleLog.update({
      where: { id },
      data: {
        driverId,
        startAt,
        endAt,
        endOdometer,
        purpose: body.purpose !== undefined ? (body.purpose?.trim() || null) : before.purpose,
        destination: body.destination !== undefined ? (body.destination?.trim() || null) : before.destination,
        note: body.note !== undefined ? (body.note?.trim() || null) : before.note,
      },
    })
    await recalcVehicleLogs(tx, before.vehicleId)
    return tx.vehicleLog.findUnique({
      where: { id },
      include: { driver: DRIVER_SELECT, vehicle: VEHICLE_SELECT },
    })
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'vehicle_log',
    resourceId: id,
    resourceLabel: `${log!.vehicle.name} ${fmtPeriod(startAt, endAt)} ${endOdometer}km`,
    before,
    after: log,
  })

  return NextResponse.json({ log })
}

/** 삭제: 운전자/작성자 본인 또는 ADMIN. 예약 연결 일지면 해당 예약 반납도 해제 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const before = await prisma.vehicleLog.findUnique({
    where: { id },
    include: { vehicle: { select: { name: true } } },
  })
  if (!before) return NextResponse.json({ error: '운행일지를 찾을 수 없습니다.' }, { status: 404 })

  const isOwner = before.driverId === user.userId || before.createdById === user.userId
  if (!isOwner && !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: '본인 운행일지만 삭제할 수 있습니다.' }, { status: 403 })
  }

  await prisma.$transaction(async (tx) => {
    await tx.vehicleLog.delete({ where: { id } })
    if (before.reservationId) {
      await tx.vehicleReservation.update({ where: { id: before.reservationId }, data: { returnedAt: null } })
    }
    await recalcVehicleLogs(tx, before.vehicleId)
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'vehicle_log',
    resourceId: id,
    resourceLabel: `${before.vehicle.name} ${fmtPeriod(before.startAt, before.endAt)} ${before.endOdometer}km`,
    before,
  })

  return NextResponse.json({ success: true })
}
