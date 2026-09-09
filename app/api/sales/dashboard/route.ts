import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { checkSalesAccess } from '@/lib/sales'
import { buildSalesDashboardData } from '@/lib/salesDashboardData'

export const dynamic = 'force-dynamic'

/**
 * GET /api/sales/dashboard — 영업 대시보드 A(도입 실적) 데이터
 * 사이니지 /dashboard '영업현황' 뷰용. 집계는 lib/salesDashboardData.ts 단일 소스.
 * 권한: /sales/dashboard 페이지와 동일 게이트(checkSalesAccess)
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denied = await checkSalesAccess(user)
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status })
  const data = await buildSalesDashboardData(user)
  return NextResponse.json(data)
}
