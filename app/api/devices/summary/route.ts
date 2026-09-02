import { NextRequest, NextResponse } from 'next/server'
import { COVERAGE_MAX_LIMIT, getGlobalCoverage, type CoverageFilter, type CoverageSort } from '@/lib/deviceRegistry'
import { authOr401, badRequest, pageLimit, readErrorResponse } from '../_read'

export const dynamic = 'force-dynamic'

const FILTERS: readonly CoverageFilter[] = ['all', 'unregistered', 'diff', 'complete']
const SORTS: readonly CoverageSort[] = ['diff', 'name', 'lastEvent']

/**
 * 전역 커버리지(백필 진행판, §6.1-A) — 계약완료 딜 보유 ∪ 원장 보유 병원(2026-09-02 모집단 축소), 딜 Σ 조인
 * `?page&limit(50, ≤1000 — 콤보 옵션 겸용 1요청 로드)&filter=all|unregistered|diff|complete&q&sort=diff|name|lastEvent`
 * → `{ data, total, page, limit, totals }`. 로그인 전체
 */
export async function GET(req: NextRequest) {
  const auth = await authOr401(req)
  if (auth instanceof NextResponse) return auth

  const sp = new URL(req.url).searchParams
  const filterRaw = sp.get('filter')?.trim()
  const filter = filterRaw ? FILTERS.find((f) => f === filterRaw) : 'all'
  if (!filter) return badRequest('filter는 all | unregistered | diff | complete 중 하나여야 합니다.')
  const sortRaw = sp.get('sort')?.trim()
  const sort = sortRaw ? SORTS.find((s) => s === sortRaw) : 'diff'
  if (!sort) return badRequest('sort는 diff | name | lastEvent 중 하나여야 합니다.')
  const { page, limit } = pageLimit(sp, { limit: 50, max: COVERAGE_MAX_LIMIT })

  try {
    const result = await getGlobalCoverage({ page, limit, filter, q: sp.get('q'), sort })
    return NextResponse.json(result)
  } catch (e) {
    return readErrorResponse(e, 'summary')
  }
}
