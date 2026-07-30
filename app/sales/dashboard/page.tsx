import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth'
import { canAccessSales } from '@/lib/sales'
import { prisma } from '@/lib/prisma'
import SalesConceptTabs from '../_components/SalesConceptTabs'
import SalesDashboardA, { type DashboardAData } from './_components/SalesDashboardA'

export const dynamic = 'force-dynamic'

/**
 * 영업 대시보드 A — 도입 실적 (경영 요약)
 * 계약완료 딜 기준 누적 실적·월별 추이·구성(판매모델·종별·지역)·정산 현황.
 * 권한: SUPER_ADMIN + SEERS (임시 — 영업 섹션 공통 게이트)
 */
export default async function SalesDashboardPage() {
  const cookieStore = cookies()
  const token = cookieStore.get('auth-token')?.value
  const user = token ? await verifyToken(token) : null
  const allowed = await canAccessSales(user)
  if (!allowed) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          도입 현황은 기능 개발 중으로 최고관리자만 열람할 수 있습니다.
        </div>
      </div>
    )
  }

  const deals = await prisma.salesDeal.findMany({
    include: {
      status: { select: { name: true } },
      hospitalModel: { select: { name: true } },
      taxInvoice: { select: { name: true } },
      settlement: { select: { name: true } },
      hospital: { select: { hospitalCode: true, hospitalName: true, type: true, sidoName: true } },
    },
  })

  const n = (v: bigint | null) => (v === null ? 0 : Number(v))
  const completed = deals.filter((d) => d.status?.name === '계약완료')
  const active = deals.filter((d) => d.status?.name === '영업중')

  // KPI
  const hospSet = new Set(completed.map((d) => d.hospitalCode))
  const roundsPerHosp = new Map<string, number>()
  completed.forEach((d) => roundsPerHosp.set(d.hospitalCode, (roundsPerHosp.get(d.hospitalCode) ?? 0) + 1))
  const expandedHosp = Array.from(roundsPerHosp.values()).filter((c) => c >= 2).length
  const bedSum = completed.reduce((a, d) => a + (d.bedCount ?? 0), 0)
  const wardSum = completed.reduce((a, d) => a + (d.wardCount ?? 0), 0)
  const actualSum = completed.reduce((a, d) => a + n(d.amountActual), 0)
  const saleSum = completed.reduce((a, d) => a + n(d.amountProduct) + n(d.amountConstruction), 0)
  const BED_TARGET = 50000 // 영업 목표 병상 (엑셀 '요약' 기준) — 설정화 필요 시 AppSetting으로 이전

  // 월별 추이 (최근 24개월, 계약일 기준)
  const monthMap = new Map<string, { count: number; actual: number }>()
  for (const d of completed) {
    if (!d.contractDate) continue
    const ym = d.contractDate.toISOString().slice(0, 7)
    const cur = monthMap.get(ym) ?? { count: 0, actual: 0 }
    cur.count += 1
    cur.actual += n(d.amountActual)
    monthMap.set(ym, cur)
  }
  const months = Array.from(monthMap.keys()).sort().slice(-24)
  const monthly = months.map((ym) => ({ ym: ym.slice(2).replace('-', '.'), ...monthMap.get(ym)! }))

  const countBy = <T,>(list: T[], key: (t: T) => string | null | undefined) => {
    const m = new Map<string, number>()
    list.forEach((t) => { const k = key(t) ?? '미지정'; m.set(k, (m.get(k) ?? 0) + 1) })
    return m
  }

  const modelDist = Array.from(countBy(completed, (d) => d.hospitalModel?.name).entries())
    .map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  // 종별: 병원 단위 (딜 다건 중복 제거)
  const typeMap = new Map<string, string>()
  completed.forEach((d) => typeMap.set(d.hospitalCode, d.hospital.type))
  const typeDist = Array.from(countBy(Array.from(typeMap.values()), (t) => t).entries())
    .map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)

  // 지역별 실판매액 Top 10
  const regionMap = new Map<string, number>()
  completed.forEach((d) => {
    const k = d.hospital.sidoName ?? '미지정'
    regionMap.set(k, (regionMap.get(k) ?? 0) + n(d.amountActual))
  })
  const regionTop = Array.from(regionMap.entries()).map(([name, actual]) => ({ name, actual }))
    .sort((a, b) => b.actual - a.actual).slice(0, 10)

  // 정산·세금계산서 (계약완료 딜 기준)
  const settleDist = Array.from(countBy(completed, (d) => d.settlement?.name).entries()).map(([name, count]) => ({ name, count }))
  const taxDist = Array.from(countBy(completed, (d) => d.taxInvoice?.name).entries()).map(([name, count]) => ({ name, count }))

  const data: DashboardAData = {
    kpi: {
      hospitals: hospSet.size,
      expanded: expandedHosp,
      wards: wardSum,
      beds: bedSum,
      bedTarget: BED_TARGET,
      actualSum,
      saleSum,
      activeDeals: active.length,
    },
    monthly,
    modelDist,
    typeDist,
    regionTop,
    settleDist,
    taxDist,
  }

  return (
    <div>
      <SalesConceptTabs />
      <SalesDashboardA data={data} />
    </div>
  )
}
