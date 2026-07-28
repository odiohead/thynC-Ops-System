import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { checkSalesAccess, toAmount, SALES_CODE_CATEGORIES } from '@/lib/sales'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string } }

/** 병원 영업 정보 통합 조회 — 섹션 렌더에 필요한 전부를 1회로 반환 */
export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkSalesAccess(user)
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const hospital = await prisma.hospital.findUnique({
    where: { hospitalCode: params.code },
    select: { hospitalCode: true, introBeds: true },
  })
  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })

  const [profile, contacts, channels, deals, activities, offices, codes, devices, projects] = await Promise.all([
    prisma.hospitalSalesProfile.findUnique({ where: { hospitalCode: params.code } }),
    prisma.hospitalContact.findMany({
      where: { hospitalCode: params.code },
      orderBy: [{ isActive: 'desc' }, { isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    }),
    prisma.hospitalDaewoongChannel.findMany({
      where: { hospitalCode: params.code },
      orderBy: [{ isCurrent: 'desc' }, { id: 'desc' }],
      include: {
        office: { select: { id: true, division: true, name: true } },
        rep: { select: { id: true, name: true, phone: true } },
      },
    }),
    prisma.salesDeal.findMany({
      where: { hospitalCode: params.code },
      orderBy: { roundNo: 'asc' },
      include: {
        hospitalSaleModel: { select: { id: true, name: true } },
        seersSaleModel: { select: { id: true, name: true } },
        priceType: { select: { id: true, name: true } },
        settlementStatus: { select: { id: true, name: true } },
        taxInvoiceStatus: { select: { id: true, name: true } },
        revenueRecognition: { select: { id: true, name: true } },
        project: { select: { projectCode: true, orderNumber: true } },
        devices: { include: { deviceInfo: { select: { id: true, deviceModel: true, deviceName: true } } }, orderBy: { id: 'asc' } },
      },
    }),
    prisma.salesActivity.findMany({
      where: { hospitalCode: params.code },
      orderBy: [{ activityDate: 'desc' }, { id: 'desc' }],
      include: {
        activityType: { select: { id: true, name: true } },
        author: { select: { id: true, name: true } },
        deal: { select: { id: true, dealCode: true, roundNo: true } },
      },
    }),
    prisma.salesOffice.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: { reps: { where: { isActive: true }, orderBy: { name: 'asc' } } },
    }),
    prisma.statusCode.findMany({
      where: { category: { in: [...SALES_CODE_CATEGORIES] } },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, category: true },
    }),
    prisma.deviceInfo.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, deviceModel: true, deviceName: true } }),
    prisma.project.findMany({
      where: { hospitalCode: params.code },
      orderBy: { orderNumber: 'asc' },
      select: { projectCode: true, orderNumber: true, contractDate: true },
    }),
  ])

  const codesByCategory: Record<string, { id: number; name: string }[]> = {}
  for (const c of codes) {
    ;(codesByCategory[c.category] ??= []).push({ id: c.id, name: c.name })
  }

  return NextResponse.json({
    canEdit: true,
    introBeds: hospital.introBeds,
    profile,
    contacts,
    channels,
    deals: deals.map((d) => ({
      ...d,
      amountProduct: toAmount(d.amountProduct),
      amountConstruction: toAmount(d.amountConstruction),
      amountTotal: toAmount(d.amountTotal),
      amountService: toAmount(d.amountService),
      amountActual: toAmount(d.amountActual),
      devices: d.devices.map((dd) => ({ ...dd, unitPrice: toAmount(dd.unitPrice) })),
    })),
    activities,
    masters: { offices, codes: codesByCategory, devices, projects },
  })
}
