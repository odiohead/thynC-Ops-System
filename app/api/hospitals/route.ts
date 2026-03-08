import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const PAGE_SIZE = 20

export async function POST(request: NextRequest) {
  const { hiraId } = await request.json()

  if (!hiraId) {
    return NextResponse.json({ error: 'hiraId is required' }, { status: 400 })
  }

  const hira = await prisma.hiraHospital.findUnique({ where: { hiraId } })
  if (!hira) {
    return NextResponse.json({ error: '심평원 병원 정보를 찾을 수 없습니다.' }, { status: 404 })
  }

  const existing = await prisma.hospital.findUnique({ where: { hiraId } })
  if (existing) {
    return NextResponse.json({ error: '이미 등록된 병원입니다.' }, { status: 409 })
  }

  // hospital_code 자동 생성 (HOSP-NNN)
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
      hiraId: hira.hiraId,
      name: hira.name,
      type: hira.typeName,
      sidoCode: hira.sidoCode,
      sidoName: hira.sidoName,
      sigunguCode: hira.sigunguCode,
      sigunguName: hira.sigunguName,
      eupmyeondong: hira.eupmyeondong,
      postalCode: hira.postalCode,
      address: hira.address,
      coordinateX: hira.coordinateX,
      coordinateY: hira.coordinateY,
      status: '미계약',
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
    ...(search && { name: { contains: search, mode: 'insensitive' as const } }),
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
        name: true,
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
