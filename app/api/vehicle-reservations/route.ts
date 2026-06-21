import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

const USER_SELECT = { select: { id: true, name: true, email: true } }
const VEHICLE_SELECT = { select: { id: true, name: true, plateNumber: true, color: true, isActive: true } }

function fmtPeriod(startAt: Date, endAt: Date) {
  const f = (d: Date) =>
    d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  return `${f(startAt)}~${f(endAt)}`
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const from = sp.get('from') ? new Date(sp.get('from')!) : null
  const to = sp.get('to') ? new Date(sp.get('to')!) : null
  const vehicleId = sp.get('vehicleId') ? parseInt(sp.get('vehicleId')!) : null
  const mine = sp.get('mine') === 'true'

  if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) {
    return NextResponse.json({ error: '잘못된 기간입니다.' }, { status: 400 })
  }

  const reservations = await prisma.vehicleReservation.findMany({
    where: {
      status: 'RESERVED',
      ...(from ? { endAt: { gt: from } } : {}),
      ...(to ? { startAt: { lt: to } } : {}),
      ...(vehicleId ? { vehicleId } : {}),
      ...(mine ? { userId: user.userId } : {}),
    },
    include: { vehicle: VEHICLE_SELECT, user: USER_SELECT },
    orderBy: [{ startAt: 'asc' }],
  })

  return NextResponse.json({ reservations })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const actor = await prisma.user.findUnique({ where: { id: user.userId }, select: { vehicleReservationBlocked: true } })
  if (actor?.vehicleReservationBlocked) {
    return NextResponse.json({ error: '차량예약 사용이 제한된 계정입니다.' }, { status: 403 })
  }

  const { vehicleId, startAt, endAt, purpose, destination } = await request.json()

  if (!vehicleId) return NextResponse.json({ error: '차량을 선택해주세요.' }, { status: 400 })
  const start = new Date(startAt)
  const end = new Date(endAt)
  if (!startAt || !endAt || isNaN(start.getTime()) || isNaN(end.getTime())) {
    return NextResponse.json({ error: '예약 시간을 입력해주세요.' }, { status: 400 })
  }
  if (start >= end) {
    return NextResponse.json({ error: '종료 시각은 시작 시각보다 늦어야 합니다.' }, { status: 400 })
  }

  const vehicle = await prisma.vehicle.findUnique({ where: { id: Number(vehicleId) } })
  if (!vehicle) return NextResponse.json({ error: '차량을 찾을 수 없습니다.' }, { status: 404 })
  if (!vehicle.isActive) return NextResponse.json({ error: '비활성 차량은 예약할 수 없습니다.' }, { status: 400 })

  try {
    const reservation = await prisma.$transaction(async (tx) => {
      const conflict = await tx.vehicleReservation.findFirst({
        where: {
          vehicleId: vehicle.id,
          status: 'RESERVED',
          startAt: { lt: end },
          endAt: { gt: start },
        },
        include: { user: USER_SELECT },
      })
      if (conflict) {
        throw Object.assign(new Error('CONFLICT'), { conflict })
      }
      return tx.vehicleReservation.create({
        data: {
          vehicleId: vehicle.id,
          userId: user.userId,
          startAt: start,
          endAt: end,
          purpose: purpose?.trim() || null,
          destination: destination?.trim() || null,
        },
        include: { vehicle: VEHICLE_SELECT, user: USER_SELECT },
      })
    })

    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'CREATE',
      resource: 'vehicle_reservation',
      resourceId: reservation.id,
      resourceLabel: `${vehicle.name} ${fmtPeriod(start, end)} (${user.name})`,
      after: reservation,
    })

    return NextResponse.json({ reservation }, { status: 201 })
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
    // DB EXCLUDE 제약(동시 요청 race) 위반
    if (e.message?.includes('vehicle_reservations_no_overlap')) {
      return NextResponse.json({ error: '같은 시간대에 다른 예약이 방금 등록되었습니다. 다시 확인해주세요.' }, { status: 409 })
    }
    throw err
  }
}
