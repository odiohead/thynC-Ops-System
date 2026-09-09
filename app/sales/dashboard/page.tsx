import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth'
import { canAccessSales } from '@/lib/sales'
import SalesConceptTabs from '../_components/SalesConceptTabs'
import SalesDashboardA from './_components/SalesDashboardA'
import { buildSalesDashboardData } from '@/lib/salesDashboardData'

export const dynamic = 'force-dynamic'

/**
 * 영업 대시보드 A — 도입 실적 (경영 요약)
 * 계약완료 딜 기준 누적 실적·월별 추이·구성(판매모델·종별·지역)·정산 현황.
 * 권한: (ADMIN 이상 또는 sales.access 권한) + SEERS (영업 섹션 공통 게이트)
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
          영업 현황은 ADMIN 이상 또는 영업 접근 권한 보유자 + 씨어스(SEERS) 소속만 열람할 수 있습니다.
        </div>
      </div>
    )
  }

  const data = await buildSalesDashboardData(user!)

  return (
    <div>
      <SalesConceptTabs />
      <SalesDashboardA data={data} />
    </div>
  )
}
