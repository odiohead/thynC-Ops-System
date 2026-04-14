import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // hira_hospitals 중 hospitals에 아직 없는 것 찾기
  const unlinked = await prisma.hiraHospital.findMany({
    where: { hospital: null },
    select: {
      hiraId: true,
      name: true,
      typeName: true,
      typeCode: true,
      sidoCode: true,
      sidoName: true,
      sigunguCode: true,
      sigunguName: true,
      eupmyeondong: true,
      postalCode: true,
      address: true,
      coordinateX: true,
      coordinateY: true,
    },
  })

  if (unlinked.length === 0) {
    return NextResponse.json({ created: 0, message: '신규 병원이 없습니다.' })
  }

  // 현재 최대 hospitalCode 번호 조회
  const allCodes = await prisma.hospital.findMany({
    where: { hospitalCode: { startsWith: 'HOSP-' } },
    select: { hospitalCode: true },
  })
  let maxNum = allCodes.reduce((max, h) => {
    const match = h.hospitalCode.match(/^HOSP-(\d+)$/)
    return match ? Math.max(max, parseInt(match[1])) : max
  }, 0)

  // 배치로 생성
  let created = 0
  for (const h of unlinked) {
    maxNum++
    const hospitalCode = `HOSP-${String(maxNum).padStart(6, '0')}`

    await prisma.hospital.create({
      data: {
        hospitalCode,
        hiraId: h.hiraId,
        hiraHospitalName: h.name,
        hospitalName: h.name,
        type: h.typeName ?? h.typeCode ?? '',
        sidoCode: h.sidoCode ?? null,
        sidoName: h.sidoName ?? null,
        sigunguCode: h.sigunguCode ?? null,
        sigunguName: h.sigunguName ?? null,
        eupmyeondong: h.eupmyeondong ?? null,
        postalCode: h.postalCode ?? null,
        address: h.address ?? null,
        coordinateX: h.coordinateX ?? null,
        coordinateY: h.coordinateY ?? null,
        status: '미계약',
      },
    })
    created++
  }

  return NextResponse.json({
    created,
    message: `${created}건의 병원이 등록되었습니다.`,
  })
}
