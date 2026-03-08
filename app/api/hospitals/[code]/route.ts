import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'

type Params = { params: { code: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const [hospital, statusCodes] = await Promise.all([
    prisma.hospital.findUnique({ where: { hospitalCode: params.code } }),
    prisma.statusCode.findMany({ orderBy: { order: 'asc' } }),
  ])

  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })

  return NextResponse.json({ hospital, statusCodes })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const body = await request.json()
  const {
    name, type, status, address, postalCode,
    sidoCode, sidoName, sigunguCode, sigunguName,
    eupmyeondong, coordinateX, coordinateY,
  } = body

  const hospital = await prisma.hospital.update({
    where: { hospitalCode: params.code },
    data: {
      name, type, status, address, postalCode,
      sidoCode, sidoName, sigunguCode, sigunguName,
      eupmyeondong, coordinateX, coordinateY,
    },
  })

  revalidatePath('/hospitals')
  revalidatePath(`/hospitals/${params.code}`, 'page')
  return NextResponse.json({ hospital })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  await prisma.hospital.delete({ where: { hospitalCode: params.code } })
  return NextResponse.json({ success: true })
}
