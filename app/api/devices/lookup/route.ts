import { NextRequest, NextResponse } from 'next/server'
import { lookupDevice } from '@/lib/deviceRegistry'
import { authOr401, badRequest, readErrorResponse } from '../_read'

export const dynamic = 'force-dynamic'

/**
 * 헤더 '시리얼 조회' (§6.1) — `?serial=` (`normalizeSerial` 적용: 키 또는 원문 정확 일치)
 * 응답 `{ input:{serialNo, serialRaw}, device|null, candidates[](0건일 때 원장 접두 일치 ≤10), wmsCandidates[](0건일 때 WMS 정확·접미 일치 ≤10) }`
 * 로그인 전체
 */
export async function GET(req: NextRequest) {
  const auth = await authOr401(req)
  if (auth instanceof NextResponse) return auth

  const serial = new URL(req.url).searchParams.get('serial')?.trim() ?? ''
  if (!serial) return badRequest('시리얼을 입력하세요')

  try {
    return NextResponse.json(await lookupDevice(serial))
  } catch (e) {
    return readErrorResponse(e, 'lookup')
  }
}
