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

  const statusColor = statusCodes.find((sc) => sc.name === hospital.status)?.color ?? null

  return NextResponse.json({ hospital: { ...hospital, statusColor }, statusCodes })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { hospitalName, status, introType, introBeds, contractDate, changeHira, hiraId } = await request.json()

  let hiraUpdateData: Record<string, unknown> = {}

  if (changeHira) {
    if (hiraId) {
      const hira = await prisma.hiraHospital.findUnique({ where: { hiraId } })
      if (!hira) return NextResponse.json({ error: '심평원 병원을 찾을 수 없습니다.' }, { status: 404 })

      const duplicate = await prisma.hospital.findFirst({
        where: { hiraId, NOT: { hospitalCode: params.code } },
      })
      if (duplicate) return NextResponse.json({ error: '이미 다른 병원에 연결된 심평원 병원입니다.' }, { status: 409 })

      hiraUpdateData = {
        hiraId: hira.hiraId,
        hiraHospitalName: hira.name,
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
      }
    } else {
      // 연결 해제
      hiraUpdateData = {
        hiraId: null,
        type: '',
        sidoCode: null,
        sidoName: null,
        sigunguCode: null,
        sigunguName: null,
        eupmyeondong: null,
        postalCode: null,
        address: null,
        coordinateX: null,
        coordinateY: null,
      }
    }
  }

  const hospital = await prisma.hospital.update({
    where: { hospitalCode: params.code },
    data: {
      hospitalName,
      status,
      introType: introType ?? null,
      introBeds: introBeds !== undefined && introBeds !== '' ? Number(introBeds) : null,
      contractDate: contractDate ? new Date(contractDate) : null,
      ...hiraUpdateData,
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
