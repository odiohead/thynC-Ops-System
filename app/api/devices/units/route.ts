import { NextRequest, NextResponse } from 'next/server'
import { UNITS_IDS_MAX, UNITS_MAX_LIMIT, listUnitIds, listUnits } from '@/lib/deviceRegistry'
import { authOr401, pageLimit, parseUnitsQuery, readErrorResponse } from '../_read'

export const dynamic = 'force-dynamic'

/**
 * 기기 목록 (§7.1) — `?hospital&model&ward(id|unassigned)&status=active|recovered|all&q&wms=linked|unlinked|in_stock&page&limit(50, ≤500)&sort=ward|serial|placedOn|lastEvent&idsOnly`
 * - 응답 `{ data, total, page, limit }` — 행에 deviceInfo·ward·hospital·lastHospital·recoverReason·replacedBy·inventoryUnit(영속 링크)
 *   + `lastRef`(마지막 연결 ref) + `wmsTransient`/`wmsWarning`(`inventory_unit_id IS NULL`인 행의 표시용 배치 매칭 — persist:false, DB 쓰기 없음 §9.2)
 * - `wms=` 필터는 영속 `inventory_unit_id`만 기준(임시 매칭은 필터·집계에 쓰지 않음)
 * - `idsOnly=1` → `{ ids[], total, truncated }` (검색 결과 전체 선택, ≤2,000)
 * 로그인 전체
 */
export async function GET(req: NextRequest) {
  const auth = await authOr401(req)
  if (auth instanceof NextResponse) return auth

  const sp = new URL(req.url).searchParams
  const parsed = parseUnitsQuery(sp)
  if (parsed instanceof NextResponse) return parsed
  const { params, sort } = parsed

  try {
    const idsOnly = sp.get('idsOnly')
    if (idsOnly === '1' || idsOnly === 'true') {
      const r = await listUnitIds(params)
      return NextResponse.json({ ...r, max: UNITS_IDS_MAX })
    }
    const { page, limit } = pageLimit(sp, { limit: 50, max: UNITS_MAX_LIMIT })
    const result = await listUnits(params, { page, limit, sort, maxLimit: UNITS_MAX_LIMIT })
    return NextResponse.json(result)
  } catch (e) {
    return readErrorResponse(e, 'units')
  }
}
