import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string } }

/**
 * 병원 × 기기 비계약 공급 현황(대웅 직판) 목록 (projects/third_party_supply_design.md §6)
 * 응답: 공급 행 + `supply_tracked` 기기 마스터(빈 행 렌더용). 병원 상세 카드는 lib 직접 호출이라 이 GET은 모달·외부 조회용.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: params.code }, select: { hospitalCode: true } })
  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })

  const [supplies, devices] = await Promise.all([
    prisma.hospitalDeviceSupply.findMany({
      where: { hospitalCode: params.code },
      include: { deviceInfo: { select: { id: true, deviceName: true, deviceModel: true, supplyTracked: true } }, updatedBy: { select: { name: true } } },
      orderBy: { deviceInfo: { sortOrder: 'asc' } },
    }),
    prisma.deviceInfo.findMany({ where: { supplyTracked: true, isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, deviceName: true, deviceModel: true } }),
  ])
  return NextResponse.json({
    supplies: supplies.map((s) => ({
      deviceInfoId: s.deviceInfoId,
      deviceName: s.deviceInfo.deviceName,
      deviceModel: s.deviceInfo.deviceModel,
      quantity: s.quantity,
      supplier: s.supplier,
      checkedOn: s.checkedOn ? s.checkedOn.toISOString().slice(0, 10) : null,
      note: s.note,
      updatedByName: s.updatedBy?.name ?? null,
      updatedAt: s.updatedAt.toISOString(),
    })),
    devices,
  })
}
