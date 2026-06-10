import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export async function GET(request: NextRequest) {
  const activeOnly = request.nextUrl.searchParams.get('activeOnly') === 'true'

  const vehicles = await prisma.vehicle.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: {
      _count: { select: { reservations: true } },
    },
  })

  return NextResponse.json({
    vehicles: vehicles.map((v) => ({
      id: v.id,
      name: v.name,
      plateNumber: v.plateNumber,
      model: v.model,
      seatCount: v.seatCount,
      color: v.color,
      memo: v.memo,
      isActive: v.isActive,
      sortOrder: v.sortOrder,
      createdAt: v.createdAt,
      reservationCount: v._count.reservations,
    })),
  })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { name, plateNumber, model, seatCount, color, memo, sortOrder, isActive } = await request.json()

  if (!name?.trim()) {
    return NextResponse.json({ error: '차량 이름을 입력해주세요.' }, { status: 400 })
  }
  if (!plateNumber?.trim()) {
    return NextResponse.json({ error: '차량번호를 입력해주세요.' }, { status: 400 })
  }

  const existing = await prisma.vehicle.findUnique({ where: { plateNumber: plateNumber.trim() } })
  if (existing) {
    return NextResponse.json({ error: '이미 등록된 차량번호입니다.' }, { status: 409 })
  }

  const vehicle = await prisma.vehicle.create({
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
    action: 'CREATE',
    resource: 'vehicle',
    resourceId: vehicle.id,
    resourceLabel: `${vehicle.name} (${vehicle.plateNumber})`,
    after: vehicle,
  })

  return NextResponse.json({ vehicle }, { status: 201 })
}
