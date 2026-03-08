import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const PAGE_SIZE = 20

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)

  // 시도 목록만 반환
  if (searchParams.get('sidoOnly') === 'true') {
    const rows = await prisma.hiraHospital.findMany({
      select: { sidoName: true },
      distinct: ['sidoName'],
      orderBy: { sidoName: 'asc' },
    })
    return NextResponse.json({ sidoOptions: rows.map((r) => r.sidoName) })
  }

  // 종별 목록만 반환
  if (searchParams.get('typeOnly') === 'true') {
    const rows = await prisma.hiraHospital.findMany({
      select: { typeCode: true, typeName: true },
      distinct: ['typeCode'],
      orderBy: { typeName: 'asc' },
    })
    return NextResponse.json({ typeOptions: rows })
  }

  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const search = searchParams.get('search') ?? ''
  const sido = searchParams.get('sido') ?? ''
  const typeCode = searchParams.get('typeCode') ?? ''

  const where = {
    ...(search && { name: { contains: search, mode: 'insensitive' as const } }),
    ...(sido && { sidoName: sido }),
    ...(typeCode && { typeCode }),
  }

  const [hiraHospitals, total] = await Promise.all([
    prisma.hiraHospital.findMany({
      where,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        hiraId: true,
        name: true,
        typeCode: true,
        typeName: true,
        address: true,
        openedAt: true,
        hospital: { select: { id: true } },
      },
    }),
    prisma.hiraHospital.count({ where }),
  ])

  return NextResponse.json({
    hiraHospitals: hiraHospitals.map((h) => ({
      ...h,
      isRegistered: h.hospital !== null,
      hospital: undefined,
    })),
    total,
    page,
    totalPages: Math.ceil(total / PAGE_SIZE),
  })
}
