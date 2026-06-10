import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

type Params = { params: { id: string } }

const USER_SELECT = { select: { id: true, name: true, email: true } }
const VEHICLE_SELECT = { select: { id: true, name: true, plateNumber: true, color: true, isActive: true } }

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

  const reservation = await prisma.vehicleReservation.findUnique({
    where: { id },
    include: { vehicle: VEHICLE_SELECT, user: USER_SELECT },
  })
  if (!reservation) return NextResponse.json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })

  return NextResponse.json({ reservation })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const before = await prisma.vehicleReservation.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })
  if (before.status !== 'RESERVED') {
    return NextResponse.json({ error: '취소된 예약은 수정할 수 없습니다.' }, { status: 400 })
  }
  if (before.userId !== user.userId && !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: '본인 예약만 수정할 수 있습니다.' }, { status: 403 })
  }

  const body = await request.json()
  const vehicleId = body.vehicleId != null ? Number(body.vehicleId) : before.vehicleId
  const start = body.startAt ? new Date(body.startAt) : before.startAt
  const end = body.endAt ? new Date(body.endAt) : before.endAt

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return NextResponse.json({ error: '예약 시간이 올바르지 않습니다.' }, { status: 400 })
  }
  if (start >= end) {
    return NextResponse.json({ error: '종료 시각은 시작 시각보다 늦어야 합니다.' }, { status: 400 })
  }

  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
  if (!vehicle) return NextResponse.json({ error: '차량을 찾을 수 없습니다.' }, { status: 404 })
  if (!vehicle.isActive && vehicleId !== before.vehicleId) {
    return NextResponse.json({ error: '비활성 차량으로는 변경할 수 없습니다.' }, { status: 400 })
  }

  try {
    const reservation = await prisma.$transaction(async (tx) => {
      const conflict = await tx.vehicleReservation.findFirst({
        where: {
          vehicleId,
          status: 'RESERVED',
          id: { not: id },
          startAt: { lt: end },
          endAt: { gt: start },
        },
        include: { user: USER_SELECT },
      })
      if (conflict) {
        throw Object.assign(new Error('CONFLICT'), { conflict })
      }
      return tx.vehicleReservation.update({
        where: { id },
        data: {
          vehicleId,
          startAt: start,
          endAt: end,
          purpose: body.purpose !== undefined ? body.purpose?.trim() || null : before.purpose,
          destination: body.destination !== undefined ? body.destination?.trim() || null : before.destination,
        },
        include: { vehicle: VEHICLE_SELECT, user: USER_SELECT },
      })
    })

    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'vehicle_reservation',
      resourceId: id,
      resourceLabel: `${vehicle.name} ${fmtPeriod(start, end)} (${reservation.user.name})`,
      before,
      after: reservation,
    })

    return NextResponse.json({ reservation })
  } catch (err: unknown) {
    const e = err as { message?: string; conflict?: { startAt: Date; endAt: Date; user: { name: string } } }
    if (e.message === 'CONFLICT' && e.conflict) {
      return NextResponse.json(
        {
          error: `이미 ${e.conflict.user.name}님이 ${fmtPeriod(new Date(e.conflict.startAt), new Date(e.conflict.endAt))} 예약했습니다.`,
          conflict: e.conflict,
        },
        { status: 409 },
      )
    }
    if (e.message?.includes('vehicle_reservations_no_overlap')) {
      return NextResponse.json({ error: '같은 시간대에 다른 예약이 방금 등록되었습니다. 다시 확인해주세요.' }, { status: 409 })
    }
    throw err
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const before = await prisma.vehicleReservation.findUnique({
    where: { id },
    include: { vehicle: VEHICLE_SELECT, user: USER_SELECT },
  })
  if (!before) return NextResponse.json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })
  if (before.status !== 'RESERVED') {
    return NextResponse.json({ error: '이미 취소된 예약입니다.' }, { status: 400 })
  }
  if (before.userId !== user.userId && !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: '본인 예약만 취소할 수 있습니다.' }, { status: 403 })
  }

  // 이력 보존을 위해 soft delete
  const reservation = await prisma.vehicleReservation.update({
    where: { id },
    data: { status: 'CANCELED' },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'vehicle_reservation',
    resourceId: id,
    resourceLabel: `${before.vehicle.name} ${fmtPeriod(before.startAt, before.endAt)} (${before.user.name}) 취소`,
    before,
    after: reservation,
  })

  return NextResponse.json({ success: true })
}
