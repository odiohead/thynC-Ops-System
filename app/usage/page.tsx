import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth'
import { canAccessUsage } from '@/lib/usage/access'
import UsageClient from './UsageClient'
import UsageOverview from './UsageOverview'

export const dynamic = 'force-dynamic'

/**
 * 사용량
 *  - /usage                    전체 병원 화면 — 병원별 가동률 순위·변화 (projects/usage_overview_design.md). 일별 집계를 읽는다
 *  - /usage?hospital=<병원코드>  병원별 화면 — 일별 측정 현황과 기기별 가동률 (projects/usage_collection_design.md §14). 열 때 원본에서 계산한다
 * 권한: (ADMIN 이상 또는 usage.view 권한) + SEERS 소속
 */
export default async function UsagePage({ searchParams }: { searchParams: { hospital?: string | string[] } }) {
  const token = cookies().get('auth-token')?.value
  const user = token ? await verifyToken(token) : null
  if (!(await canAccessUsage(user))) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          사용량은 ADMIN 이상 또는 사용량 조회 권한 보유자 + 씨어스(SEERS) 소속만 열람할 수 있습니다.
        </div>
      </div>
    )
  }
  return (
    <Suspense fallback={<div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6"><p className="text-sm text-muted-foreground">불러오는 중...</p></div>}>
      {searchParams.hospital ? <UsageClient /> : <UsageOverview />}
    </Suspense>
  )
}
