import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { recalcVehicleLogs, checkOdometerConsistency } from '@/lib/vehicleLog'

type Params = { params: { id: string } }

function fmtPeriod(startAt: Date, endAt: Date) {
  const f = (d: Date) =>
    d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  return `${f(startAt)}~${f(endAt)}`
}

/** 반납 처리: 최종 주행거리 입력 → 운행일지 생성 + 예약 returnedAt 갱신 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const resv = await prisma.vehicleReservation.findUnique({
    where: { id },
    include: { vehicle: true, user: { select: { id: true, name: true, email: true } } },
  })
  if (!resv) return NextResponse.json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })
  if (resv.status !== 'RESERVED') {
    return NextResponse.json({ error: '취소된 예약은 반납할 수 없습니다.' }, { status: 400 })
  }
  if (resv.returnedAt) {
    return NextResponse.json({ error: '이미 반납 완료된 예약입니다.' }, { status: 400 })
  }
  if (resv.userId !== user.userId && !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: '본인 예약만 반납할 수 있습니다.' }, { status: 403 })
  }

  const body = await request.json()
  const endOdometer = Number(body.endOdometer)
  if (!Number.isInteger(endOdometer) || endOdometer < 0) {
    return NextResponse.json({ error: '최종 주행거리를 올바르게 입력해주세요.' }, { status: 400 })
  }

  // 예약값 프리필 + 수정 허용
  const startAt = body.startAt ? new Date(body.startAt) : resv.startAt
  const endAt = body.endAt ? new Date(body.endAt) : resv.endAt
  if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
    return NextResponse.json({ error: '운행 시간이 올바르지 않습니다.' }, { status: 400 })
  }
  const purpose = body.purpose !== undefined ? (body.purpose?.trim() || null) : resv.purpose
  const destination = body.destination !== undefined ? (body.destination?.trim() || null) : resv.destination
  const note = typeof body.note === 'string' ? (body.note.trim() || null) : null
  // 운전자: 기본 예약자, ADMIN만 변경 가능
  let driverId = resv.userId
  if (body.driverId && isAdminOrAbove(user.role)) driverId = body.driverId

  const conflictMsg = await checkOdometerConsistency(resv.vehicleId, endAt, endOdometer)
  if (conflictMsg) return NextResponse.json({ error: conflictMsg }, { status: 400 })

  const log = await prisma.$transaction(async (tx) => {
    const created = await tx.vehicleLog.create({
      data: {
        vehicleId: resv.vehicleId,
        reservationId: resv.id,
        driverId,
        startAt,
        endAt,
        purpose,
        destination,
        endOdometer,
        note,
        createdById: user.userId,
      },
    })
    await tx.vehicleReservation.update({ where: { id }, data: { returnedAt: new Date() } })
    await recalcVehicleLogs(tx, resv.vehicleId)
    return tx.vehicleLog.findUnique({
      where: { id: created.id },
      include: { driver: { select: { id: true, name: true, email: true } } },
    })
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'vehicle_reservation',
    resourceId: id,
    resourceLabel: `${resv.vehicle.name} ${fmtPeriod(resv.startAt, resv.endAt)} (${resv.user.name}) 반납 ${endOdometer}km`,
    before: { returnedAt: null },
    after: { returnedAt: new Date(), endOdometer },
  })

  return NextResponse.json({ log })
}

/** 반납 취소 (ADMIN 전용): 운행일지 삭제 + returnedAt 해제 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: '반납 취소는 관리자만 가능합니다.' }, { status: 403 })
  }

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const resv = await prisma.vehicleReservation.findUnique({
    where: { id },
    include: { vehicle: true, user: { select: { name: true } }, log: true },
  })
  if (!resv) return NextResponse.json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })
  if (!resv.returnedAt) {
    return NextResponse.json({ error: '반납되지 않은 예약입니다.' }, { status: 400 })
  }

  await prisma.$transaction(async (tx) => {
    if (resv.log) await tx.vehicleLog.delete({ where: { id: resv.log.id } })
    await tx.vehicleReservation.update({ where: { id }, data: { returnedAt: null } })
    await recalcVehicleLogs(tx, resv.vehicleId)
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'vehicle_reservation',
    resourceId: id,
    resourceLabel: `${resv.vehicle.name} ${fmtPeriod(resv.startAt, resv.endAt)} (${resv.user.name}) 반납 취소`,
    before: { returnedAt: resv.returnedAt },
    after: { returnedAt: null },
  })

  return NextResponse.json({ success: true })
}
