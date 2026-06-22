import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { recalcVehicleLogs, checkOdometerConsistency } from '@/lib/vehicleLog'

const DRIVER_SELECT = { select: { id: true, name: true, email: true } }
const VEHICLE_SELECT = { select: { id: true, name: true, plateNumber: true, color: true } }

function fmtPeriod(startAt: Date, endAt: Date) {
  const f = (d: Date) =>
    d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  return `${f(startAt)}~${f(endAt)}`
}

/** 운행일지 목록 + 기간 합계 (조회=로그인 전체) */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const vehicleId = sp.get('vehicleId') ? parseInt(sp.get('vehicleId')!) : null
  const from = sp.get('from') ? new Date(sp.get('from')!) : null
  const to = sp.get('to') ? new Date(sp.get('to')!) : null
  const mine = sp.get('mine') === 'true'

  if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) {
    return NextResponse.json({ error: '잘못된 기간입니다.' }, { status: 400 })
  }

  const logs = await prisma.vehicleLog.findMany({
    where: {
      ...(vehicleId ? { vehicleId } : {}),
      ...(from ? { endAt: { gte: from } } : {}),
      ...(to ? { endAt: { lte: to } } : {}),
      ...(mine ? { driverId: user.userId } : {}),
    },
    include: { driver: DRIVER_SELECT, vehicle: VEHICLE_SELECT },
    orderBy: [{ endAt: 'desc' }],
  })

  const totalDistance = logs.reduce((sum, l) => sum + (l.distanceKm ?? 0), 0)
  return NextResponse.json({ logs, totalDistance })
}

/** 운행일지 직접 작성 (예약 미연결, USER 이상) */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const vehicleId = Number(body.vehicleId)
  const endOdometer = Number(body.endOdometer)
  const startAt = body.startAt ? new Date(body.startAt) : null
  const endAt = body.endAt ? new Date(body.endAt) : null

  if (!vehicleId) return NextResponse.json({ error: '차량을 선택해주세요.' }, { status: 400 })
  if (!startAt || !endAt || isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
    return NextResponse.json({ error: '운행 시간을 입력해주세요.' }, { status: 400 })
  }
  if (startAt >= endAt) {
    return NextResponse.json({ error: '종료 시각은 시작 시각보다 늦어야 합니다.' }, { status: 400 })
  }
  if (!Number.isInteger(endOdometer) || endOdometer < 0) {
    return NextResponse.json({ error: '최종 주행거리를 올바르게 입력해주세요.' }, { status: 400 })
  }

  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
  if (!vehicle) return NextResponse.json({ error: '차량을 찾을 수 없습니다.' }, { status: 404 })

  // 운전자: 기본 작성자 본인, ADMIN만 타인 지정 가능
  let driverId = user.userId
  if (body.driverId && isAdminOrAbove(user.role)) driverId = body.driverId

  const conflictMsg = await checkOdometerConsistency(vehicleId, endAt, endOdometer)
  if (conflictMsg) return NextResponse.json({ error: conflictMsg }, { status: 400 })

  const log = await prisma.$transaction(async (tx) => {
    const created = await tx.vehicleLog.create({
      data: {
        vehicleId,
        driverId,
        startAt,
        endAt,
        purpose: body.purpose?.trim() || null,
        destination: body.destination?.trim() || null,
        endOdometer,
        note: body.note?.trim() || null,
        createdById: user.userId,
      },
    })
    await recalcVehicleLogs(tx, vehicleId)
    return tx.vehicleLog.findUnique({
      where: { id: created.id },
      include: { driver: DRIVER_SELECT, vehicle: VEHICLE_SELECT },
    })
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'vehicle_log',
    resourceId: log!.id,
    resourceLabel: `${vehicle.name} ${fmtPeriod(startAt, endAt)} ${endOdometer}km`,
    after: log,
  })

  return NextResponse.json({ log }, { status: 201 })
}
