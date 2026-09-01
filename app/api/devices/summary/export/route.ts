import { NextRequest, NextResponse } from 'next/server'
import { COVERAGE_MAX_LIMIT, getGlobalCoverage, type CoverageFilter, type CoverageRow, type CoverageSort } from '@/lib/deviceRegistry'
import { DEVICE_EVENT_TYPE_LABELS, type DeviceEventType } from '@/lib/deviceRegistryShared'
import { authOr401, badRequest, readErrorResponse, registryFileName, xlsxResponse } from '../../_read'

export const dynamic = 'force-dynamic'

const FILTERS: readonly CoverageFilter[] = ['all', 'unregistered', 'diff', 'complete']
const SORTS: readonly CoverageSort[] = ['diff', 'name', 'lastEvent']
const FILTER_LABEL: Record<CoverageFilter, string> = { all: '커버리지', unregistered: '커버리지_미등록', diff: '커버리지_차이있음', complete: '커버리지_등록완료' }

const DASH = '—'

/** 전역 뷰 표 컬럼 그대로(§6.1 Excel) — 원장 미등록 병원은 계약 열만 채우고 나머지 '—'/'미등록'. 배치 중 ECG·차이는 평가용 제외(§9.1), 평가용은 별도 열 */
function toRow(r: CoverageRow): Record<string, unknown> {
  const reg = r.registered
  return {
    병원코드: r.hospitalCode,
    병원명: r.hospitalName,
    상태: r.status,
    '계약 ECG': r.expected ?? `${DASH} (계약완료 딜 없음)`,
    '배치 중 ECG': reg ? r.activeEcg : DASH,
    차이: !reg ? '미등록' : r.diff == null ? DASH : r.diff,
    '평가용(별도)': reg ? r.evalTotal : DASH,
    'SpO2(참고)': reg ? r.activeSpo2 : DASH,
    GW: reg ? r.activeGw : DASH,
    제3자: reg ? r.activeThird : DASH,
    '배치 중 합계': reg ? r.activeTotal : DASH,
    '회수(30일)': reg ? r.recovered30d : DASH,
    '마지막 이벤트': r.lastEvent ? `${r.lastEvent.on} ${DEVICE_EVENT_TYPE_LABELS[r.lastEvent.type as DeviceEventType] ?? r.lastEvent.type}` : DASH,
    '마지막 임포트': r.lastImport ? `${r.lastImport.occurredOn ?? r.lastImport.at.slice(0, 10)} (${r.lastImport.rowCount}행)` : DASH,
  }
}

/** 커버리지 Excel — 같은 필터, page/limit 무시, 1,000행 캡(초과 400). 로그인 전체 */
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

  try {
    const result = await getGlobalCoverage({ page: 1, limit: COVERAGE_MAX_LIMIT, filter, q: sp.get('q'), sort })
    if (result.total > COVERAGE_MAX_LIMIT) {
      return badRequest(`필터를 좁혀 ${COVERAGE_MAX_LIMIT.toLocaleString()}행 이하로 내보내세요 (현재 ${result.total.toLocaleString()}행)`)
    }
    const rows = result.data.map(toRow)
    return xlsxResponse(rows, '병원 커버리지', registryFileName(null, FILTER_LABEL[filter]), [14, 24, 8, 10, 12, 8, 10, 11, 6, 6, 12, 10, 16, 20])
  } catch (e) {
    return readErrorResponse(e, 'summary/export')
  }
}
