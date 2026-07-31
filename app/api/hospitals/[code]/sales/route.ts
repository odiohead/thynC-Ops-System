import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { checkSalesAccess, toAmount, SALES_CODE_CATEGORIES } from '@/lib/sales'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string } }

/** 병원 영업 정보 통합 조회 — 섹션 렌더에 필요한 전부(데이터+마스터+파생)를 1회로 반환 */
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

  const [profile, affiliations, deals, activities, codes, owners, projects] = await Promise.all([
    prisma.hospitalSalesProfile.findUnique({
      where: { hospitalCode: params.code },
      include: {
        stage: { select: { id: true, name: true, color: true } },
        owner: { select: { id: true, name: true } },
      },
    }),
    // 인적정보 — 이 병원의 소속 전체(현재+과거). person에 전체 소속 이력 동봉(전원 추적 표시용)
    prisma.personAffiliation.findMany({
      where: { hospitalCode: params.code },
      orderBy: [{ isCurrent: 'desc' }, { isPrimary: 'desc' }, { id: 'asc' }],
      include: {
        person: {
          include: {
            personGroup: { select: { id: true, name: true } },
            affiliations: {
              orderBy: { id: 'desc' },
              include: { hospital: { select: { hospitalCode: true, hospitalName: true } } },
            },
          },
        },
      },
    }),
    prisma.salesDeal.findMany({
      where: { hospitalCode: params.code },
      orderBy: { roundNo: 'asc' },
      include: {
        status: { select: { id: true, name: true, color: true } },
        hospitalModel: { select: { id: true, name: true } },
        seersModel: { select: { id: true, name: true } },
        taxInvoice: { select: { id: true, name: true } },
        settlement: { select: { id: true, name: true } },
        project: { select: { projectCode: true, projectName: true } },
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
    prisma.statusCode.findMany({
      where: { category: { in: [...SALES_CODE_CATEGORIES] } },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, category: true, color: true },
    }),
    // 담당 영업 후보 — SEERS 활성 계정
    prisma.user.findMany({
      where: { isActive: true, organization: { code: 'SEERS' } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.project.findMany({
      where: { hospitalCode: params.code },
      orderBy: { orderNumber: 'asc' },
      select: { projectCode: true, projectName: true },
    }),
  ])

  const codesByCategory: Record<string, { id: number; name: string; color: string | null }[]> = {}
  for (const c of codes) {
    ;(codesByCategory[c.category] ??= []).push({ id: c.id, name: c.name, color: c.color })
  }

  // 파생 지표 — 도입 병상(운영 축)·침투율·누적 실판매액(계약완료 딜 합산)
  const introBeds = hospital.introBeds
  const totalBeds = profile?.totalBeds ?? null
  const penetration =
    totalBeds && totalBeds > 0 && introBeds !== null ? Math.round((introBeds / totalBeds) * 1000) / 10 : null
  const contractedTotal = deals
    .filter((d) => d.status?.name === '계약완료')
    .reduce((sum, d) => sum + (d.daewoongAmountActual !== null ? Number(d.daewoongAmountActual) : 0), 0) // 대웅 실판매액 기준 (2026-07-31 — 씨어스 금액 수기 입력 전)

  return NextResponse.json({
    canEdit: true,
    profile,
    persons: {
      current: affiliations.filter((a) => a.isCurrent),
      past: affiliations.filter((a) => !a.isCurrent),
    },
    deals: deals.map((d) => ({
      ...d,
      amountProduct: toAmount(d.amountProduct),
      amountConstruction: toAmount(d.amountConstruction),
      amountActual: toAmount(d.amountActual),
    })),
    activities,
    derived: { introBeds, penetration, contractedTotal },
    masters: { codes: codesByCategory, owners, projects },
  })
}
