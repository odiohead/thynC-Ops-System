import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const [hospital, statusCodes] = await Promise.all([
    prisma.hospital.findUnique({ where: { id } }),
    prisma.statusCode.findMany({ orderBy: { order: 'asc' } }),
  ])

  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })

  return NextResponse.json({ hospital, statusCodes })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const body = await request.json()
  const {
    name, type, status, address, postalCode,
    sidoCode, sidoName, sigunguCode, sigunguName,
    eupmyeondong, coordinateX, coordinateY,
  } = body

  const hospital = await prisma.hospital.update({
    where: { id },
    data: {
      name, type, status, address, postalCode,
      sidoCode, sidoName, sigunguCode, sigunguName,
      eupmyeondong, coordinateX, coordinateY,
    },
  })

  revalidatePath('/hospitals')
  revalidatePath(`/hospitals/${id}`, 'page')
  return NextResponse.json({ hospital })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  await prisma.hospital.delete({ where: { id } })

  return NextResponse.json({ success: true })
}
