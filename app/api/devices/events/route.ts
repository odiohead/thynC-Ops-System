import { NextRequest, NextResponse } from 'next/server'
import { EVENTS_MAX_LIMIT, listEvents } from '@/lib/deviceRegistry'
import { authOr401, pageLimit, parseEventsQuery, readErrorResponse } from '../_read'

export const dynamic = 'force-dynamic'

/**
 * 이벤트 목록 (§7.1) — `?hospital&device&type&from&to&refType&refCode&batch&actionGroup&source&q&page&limit(50, ≤500)`
 * 정렬 occurred_on DESC, id DESC. 응답 `{ data, total, page, limit }` — 행에 device{serialNo, serialRaw, status, hospitalCode, deviceInfo}
 * ·hospital·fromWard·toWard·reasonCode·relatedDevice·importBatch + actorName 스냅샷(기록자)
 * 후속 유지보수 패널이 `?refType=MAINTENANCE&refCode=`로 그대로 사용(§9.3). 로그인 전체
 */
export async function GET(req: NextRequest) {
  const auth = await authOr401(req)
  if (auth instanceof NextResponse) return auth

  const sp = new URL(req.url).searchParams
  const params = parseEventsQuery(sp)
  if (params instanceof NextResponse) return params
  const { page, limit } = pageLimit(sp, { limit: 50, max: EVENTS_MAX_LIMIT })

  try {
    return NextResponse.json(await listEvents(params, { page, limit, maxLimit: EVENTS_MAX_LIMIT }))
  } catch (e) {
    return readErrorResponse(e, 'events')
  }
}
