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
 * 권한: ADMIN 이상 + SEERS (영업 섹션 공통 게이트)
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
          영업 현황은 ADMIN 이상 + 씨어스(SEERS) 소속만 열람할 수 있습니다.
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
  const deviceSum = completed.reduce((a, d) => a + (d.daewoongDeviceCount ?? 0), 0) // 누적 도입 병상 = 대웅 디바이스 수량 (2026-07-31 사용자 결정)
  const bedSum = completed.reduce((a, d) => a + (d.bedCount ?? 0), 0)
  const wardSum = completed.reduce((a, d) => a + (d.wardCount ?? 0), 0)
  const actualSum = completed.reduce((a, d) => a + n(d.daewoongAmountActual), 0)
  const saleSum = completed.reduce((a, d) => a + n(d.daewoongAmountProduct) + n(d.daewoongAmountConstruction), 0)
  const dwTotalSum = completed.reduce((a, d) => a + n(d.daewoongAmountTotal), 0) // 대웅제약 매출액 = 계약금액(총견적가) 합

  // 월별 추이 (계약일 기준) — 건수 + 신규 병원·병상(디바이스) + 누적
  const monthMap = new Map<string, { count: number; hosp: number; beds: number }>()
  const firstMonthByHosp = new Map<string, string>() // 병원별 최초 계약월 (신규 병원 판정)
  for (const d of completed) {
    if (!d.contractDate) continue
    const ym = d.contractDate.toISOString().slice(0, 7)
    const prev = firstMonthByHosp.get(d.hospitalCode)
    if (!prev || ym < prev) firstMonthByHosp.set(d.hospitalCode, ym)
  }
  for (const d of completed) {
    if (!d.contractDate) continue
    const ym = d.contractDate.toISOString().slice(0, 7)
    const cur = monthMap.get(ym) ?? { count: 0, hosp: 0, beds: 0 }
    cur.count += 1
    cur.beds += d.daewoongDeviceCount ?? 0
    monthMap.set(ym, cur)
  }
  firstMonthByHosp.forEach((ym) => { const cur = monthMap.get(ym); if (cur) cur.hosp += 1 })
  const allMonths = Array.from(monthMap.keys()).sort()
  let cumHosp = 0, cumBeds = 0
  const monthlyAll = allMonths.map((ym) => {
    const m = monthMap.get(ym)!
    cumHosp += m.hosp; cumBeds += m.beds
    return { ym: ym.slice(2).replace('-', '.'), count: m.count, hosp: m.hosp, beds: m.beds, cumHosp, cumBeds }
  })
  const monthly = monthlyAll.slice(-24)

  const countBy = <T,>(list: T[], key: (t: T) => string | null | undefined) => {
    const m = new Map<string, number>()
    list.forEach((t) => { const k = key(t) ?? '미지정'; m.set(k, (m.get(k) ?? 0) + 1) })
    return m
  }

  // 계약내역 전체 목록 (계약일 보유분) — 이번달/이번주 카드에서 기간 이동(◀▶) 클라이언트 필터
  const dated = completed.filter((d) => d.contractDate !== null)
  const allDeals = dated
    .sort((a, b) => b.contractDate!.getTime() - a.contractDate!.getTime())
    .map((d) => ({
      name: d.hospital.hospitalName,
      type: d.hospital.type,
      model: d.daewoongModel ?? d.hospitalModel?.name ?? null,
      devices: d.daewoongDeviceCount,
      date: d.contractDate!.toISOString().slice(0, 10),
      sido: d.hospital.sidoName,
    }))
  // 종별: 병원 단위 (딜 다건 중복 제거) — 종별 전체 병원 수 대비 도입 수, 종별 위계 순 고정 (2026-07-31)
  const typeMap = new Map<string, string>()
  completed.forEach((d) => typeMap.set(d.hospitalCode, d.hospital.type))
  const introByType = countBy(Array.from(typeMap.values()), (t) => t)
  const typeTotals = await prisma.hospital.groupBy({ by: ['type'], _count: { _all: true } })
  const totalByType = new Map(typeTotals.map((t) => [t.type, t._count._all]))
  const TYPE_ORDER = ['상급종합', '종합병원', '병원', '요양병원', '정신병원', '치과병원', '한방병원', '의원', '치과의원', '한의원']
  const typeDist = Array.from(introByType.entries())
    .map(([name, count]) => ({ name, count, total: totalByType.get(name) ?? 0 }))
    .sort((a, b) => {
      const ia = TYPE_ORDER.indexOf(a.name), ib = TYPE_ORDER.indexOf(b.name)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })

  // 정산·세금계산서 (계약완료 딜 기준)
  const settleDist = Array.from(countBy(completed, (d) => d.daewoongSettlement).entries()).map(([name, count]) => ({ name, count }))
  const taxDist = Array.from(countBy(completed, (d) => d.daewoongTaxInvoice).entries()).map(([name, count]) => ({ name, count }))

  const data: DashboardAData = {
    kpi: {
      hospitals: hospSet.size,
      expanded: expandedHosp,
      wards: wardSum,
      beds: bedSum,
      devices: deviceSum,
      dwTotalSum,
      actualSum,
      saleSum,
      activeDeals: active.length,
    },
    monthly,
    allDeals,
    typeDist,
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
