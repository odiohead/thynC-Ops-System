import { NextRequest, NextResponse } from 'next/server'
import { getUsageOverview } from '@/lib/usage/overview'
import { DEFAULT_FILTERS, filtersFromParams, type ViewFilters } from '@/lib/usage/filters'
import { getVisibleView } from '@/lib/usage/views'
import { usageError, usageGate } from '../_shared'

export const dynamic = 'force-dynamic'

/**
 * 전체 병원의 가동률 (projects/usage_overview_design.md · usage_dashboard_filter_design.md)
 *   ?device=ecg|spo2|cart&model=all|general|usage
 *   &types=종합병원,병원            종별 (여러 개)
 *   &hospitals=HOSP-…,HOSP-…       병원 지정
 *   &weeks=12|26|52 | &range=all | &from=YYYY-MM-DD&to=YYYY-MM-DD   추이 기간 (기본 12주)
 *   &view=번호                     저장된 보기의 조건을 바탕으로 — 주소에 따로 적은 조건이 있으면 그것이 우선한다
 * 병원마다 최근 30일 동시 가동률 평균 · 이전 30일 · 변화(%p)와 판정 · 12주 추이 · 수신 상태, 그리고 대상 병원 전체의
 * 한 줄(판매모델별 · 종별별) · 추이 · 수집 범위 · 측정 활동. 일별 집계(lib/usage/stats.ts 가 주기적으로 저장)를 읽는다.
 */
export async function GET(req: NextRequest) {
  const gate = await usageGate(req)
  if ('response' in gate) return gate.response
  const sp = req.nextUrl.searchParams
  try {
    let base: ViewFilters = DEFAULT_FILTERS
    let view = null
    const viewParam = sp.get('view')
    if (viewParam !== null) {
      const id = Number(viewParam)
      view = Number.isInteger(id) && id > 0 ? await getVisibleView(id, gate.user) : null
      if (!view) return NextResponse.json({ error: '보기를 찾을 수 없습니다. 지워졌거나 공유가 꺼졌을 수 있습니다.' }, { status: 404 })
      base = view.filters
    }
    const f: ViewFilters = { ...base, ...filtersFromParams((k) => sp.get(k)) }
    const data = await getUsageOverview(f.device, f.model, { types: f.types, hospitals: f.hospitals, trend: f.trend })
    return NextResponse.json({ ...data, view })
  } catch (e) {
    return usageError(e)
  }
}
