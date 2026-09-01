import { NextRequest, NextResponse } from 'next/server'
import { UNITS_IDS_MAX, UNITS_MAX_LIMIT, listUnitIds, listUnits } from '@/lib/deviceRegistry'
import { authOr401, pageLimit, parseUnitsQuery, readErrorResponse } from '../_read'

export const dynamic = 'force-dynamic'

/**
 * 기기 목록 (§7.1) — `?hospital&model&ward(id|unassigned)&status=active|recovered|all&q&wms=linked|unlinked|in_stock&usage=SALE|EVAL|none&page&limit(50, ≤500)&sort=ward|serial|placedOn|lastEvent&idsOnly`
 * - `q`: 시리얼 키·원문·닉네임·메모 부분 일치 + (hospital 미지정이면) 현재/마지막 병원명 — 전역 [디바이스] 뷰 '시리얼/병원명' 검색(2026-09-01 v1 단순화)
 * - 행 `id` = 공개 device id(`device_units.id`). 행에 deviceInfo·ward·hospital·lastHospital·recoverReason·replacedBy + 평탄 `hospitalName`/`lastHospitalName`
 *   + `lastRef`(마지막 연결 ref) + `wms`(=`wmsTransient`, 표시용 배치 매칭 — 일시 계산, DB 쓰기 없음 §9.2) + `wmsWarning`
 * - `wms=` 필터도 같은 일시 매칭 기준(후보 ≤10,000대 — 초과 400)
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
