import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const PAGE_SIZE = 20

export async function POST(request: NextRequest) {
  const { hiraId, hospitalName, status, introType, introBeds } = await request.json()

  if (!hospitalName?.trim()) {
    return NextResponse.json({ error: '병원명은 필수입니다.' }, { status: 400 })
  }
  if (!status?.trim()) {
    return NextResponse.json({ error: '상태는 필수입니다.' }, { status: 400 })
  }

  let hiraData = null
  if (hiraId) {
    hiraData = await prisma.hiraHospital.findUnique({ where: { hiraId } })
    if (!hiraData) {
      return NextResponse.json({ error: '심평원 병원 정보를 찾을 수 없습니다.' }, { status: 404 })
    }
    const existing = await prisma.hospital.findUnique({ where: { hiraId } })
    if (existing) {
      return NextResponse.json({ error: '이미 등록된 병원입니다.' }, { status: 409 })
    }
  }

  const allCodes = await prisma.hospital.findMany({
    where: { hospitalCode: { startsWith: 'HOSP-' } },
    select: { hospitalCode: true },
  })
  const maxNum = allCodes.reduce((max, h) => {
    const match = h.hospitalCode.match(/^HOSP-(\d+)$/)
    return match ? Math.max(max, parseInt(match[1])) : max
  }, 0)
  const hospitalCode = `HOSP-${String(maxNum + 1).padStart(6, '0')}`

  const hospital = await prisma.hospital.create({
    data: {
      hospitalCode,
      hiraId: hiraData?.hiraId ?? null,
      hiraHospitalName: hiraData?.name ?? hospitalName.trim(),
      hospitalName: hospitalName.trim(),
      type: hiraData?.typeName ?? '',
      sidoCode: hiraData?.sidoCode ?? null,
      sidoName: hiraData?.sidoName ?? null,
      sigunguCode: hiraData?.sigunguCode ?? null,
      sigunguName: hiraData?.sigunguName ?? null,
      eupmyeondong: hiraData?.eupmyeondong ?? null,
      postalCode: hiraData?.postalCode ?? null,
      address: hiraData?.address ?? null,
      coordinateX: hiraData?.coordinateX ?? null,
      coordinateY: hiraData?.coordinateY ?? null,
      status,
      introType: introType ?? null,
      introBeds: introBeds != null ? Number(introBeds) : null,
    },
  })

  return NextResponse.json({ hospital }, { status: 201 })
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const search = searchParams.get('search') ?? ''
  const sido = searchParams.get('sido') ?? ''

  const where = {
    ...(search && {
      OR: [
        { hospitalName: { contains: search, mode: 'insensitive' as const } },
        { hiraHospitalName: { contains: search, mode: 'insensitive' as const } },
      ],
    }),
    ...(sido && { sidoName: sido }),
  }

  const [hospitals, total] = await Promise.all([
    prisma.hospital.findMany({
      where,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        hospitalCode: true,
        hiraHospitalName: true,
        hospitalName: true,
        type: true,
        sidoName: true,
        sigunguName: true,
        status: true,
      },
    }),
    prisma.hospital.count({ where }),
  ])

  return NextResponse.json({
    hospitals,
    total,
    page,
    totalPages: Math.ceil(total / PAGE_SIZE),
  })
}
