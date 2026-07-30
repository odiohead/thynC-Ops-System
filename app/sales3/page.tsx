import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth'
import { canAccessSales } from '@/lib/sales'
import { prisma } from '@/lib/prisma'
import SalesOverviewTable, { type OverviewRow } from './_components/SalesOverviewTable'
import SalesConceptTabs from '@/app/sales/_components/SalesConceptTabs'

export const dynamic = 'force-dynamic'

/**
 * 도입 현황 v3 — 병원당 1행 요약 뷰 (실험, /sales·/sales2 비교용)
 * 컨셉: 병원의 도입 라이프사이클 상태('미도입'·'최초 도입 검토중'·'N차 도입완료'·'추가도입 검토중')와
 *       누적 지표(전체 병상·도입 병상·침투율·기기수·매출)를 한 줄로 스캔.
 * 범위: 영업 접점(영업 프로필 또는 딜)이 있는 병원 — 병원 전체(HIRA 7.9만)는 범위 밖.
 * 권한: ADMIN 이상 + SEERS 소속
 */
export default async function Sales3Page() {
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

  const hospitals = await prisma.hospital.findMany({
    where: { OR: [{ salesProfile: { isNot: null } }, { salesDeals: { some: {} } }] },
    select: {
      hospitalCode: true,
      hospitalName: true,
      type: true,
      sidoName: true,
      introBeds: true,
      salesProfile: {
        select: {
          totalBeds: true,
          stage: { select: { name: true, color: true } },
          owner: { select: { name: true } },
        },
      },
      salesDeals: {
        select: {
          roundNo: true,
          contractDate: true,
          wardCount: true,
          bedCount: true,
          amountProduct: true,
          amountConstruction: true,
          amountActual: true,
          status: { select: { name: true } },
        },
      },
      projects: {
        select: { devices: { select: { quantity: true } } },
      },
    },
  })

  const rows: OverviewRow[] = hospitals.map((h) => {
    const deals = h.salesDeals
    const completed = deals.filter((d) => d.status?.name === '계약완료')
    const active = deals.filter((d) => d.status?.name === '영업중' || d.status === null)
    const dropped = deals.filter((d) => d.status?.name === '해지·중단')

    // 병원 도입 라이프사이클 상태 (딜 상태에서 파생)
    let lifecycle: OverviewRow['lifecycle']
    if (deals.length === 0) lifecycle = { key: 'none', label: '미도입' }
    else if (completed.length > 0 && active.length > 0) lifecycle = { key: 'expanding', label: '추가도입 검토중', sub: `${completed.length}차 완료` }
    else if (completed.length > 0) lifecycle = { key: 'adopted', label: `${completed.length}차 도입완료` }
    else if (active.length > 0) lifecycle = { key: 'first', label: '최초 도입 검토중' }
    else if (dropped.length > 0) lifecycle = { key: 'dropped', label: '중단·해지' }
    else lifecycle = { key: 'none', label: '미도입' }

    const sumBig = (list: typeof deals, f: (d: (typeof deals)[number]) => bigint | null) =>
      list.reduce((a, d) => a + (f(d) !== null ? Number(f(d)) : 0), 0)

    const totalBeds = h.salesProfile?.totalBeds ?? null
    const introBeds = h.introBeds
    const penetration = totalBeds && totalBeds > 0 && introBeds !== null ? Math.round((introBeds / totalBeds) * 1000) / 10 : null
    const deviceCount = h.projects.reduce((a, p) => a + p.devices.reduce((s, d) => s + d.quantity, 0), 0)
    const lastContract = deals.reduce<string | null>((m, d) => {
      const c = d.contractDate ? d.contractDate.toISOString().slice(0, 10) : null
      return c && (!m || c > m) ? c : m
    }, null)

    return {
      hospitalCode: h.hospitalCode,
      hospitalName: h.hospitalName,
      hospitalType: h.type,
      sido: h.sidoName,
      lifecycle,
      stage: h.salesProfile?.stage ?? null,
      owner: h.salesProfile?.owner?.name ?? null,
      totalBeds,
      introBeds,
      penetration,
      wardSum: completed.reduce((a, d) => a + (d.wardCount ?? 0), 0),
      deviceCount,
      completedCount: completed.length,
      activeCount: active.length,
      saleSum: sumBig(completed, (d) => d.amountProduct) + sumBig(completed, (d) => d.amountConstruction),
      actualSum: sumBig(completed, (d) => d.amountActual),
      lastContract,
    }
  })

  return (
    <div>
      <SalesConceptTabs />
      <SalesOverviewTable rows={rows} />
    </div>
  )
}
