import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, type JWTPayload } from '@/lib/auth'
import { checkUsageAccess } from '@/lib/usage/access'
import { UsageDbUnavailable } from '@/lib/usage/db'

/** 사용량 API 공통 게이트 — 통과하면 사용자, 아니면 응답 */
export async function usageGate(req: NextRequest): Promise<{ user: JWTPayload } | { response: NextResponse }> {
  const user = await getAuthUser(req)
  if (!user) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const denial = await checkUsageAccess(user)
  if (denial) return { response: NextResponse.json({ error: denial.error }, { status: denial.status }) }
  return { user }
}

export function usageError(e: unknown): NextResponse {
  if (e instanceof UsageDbUnavailable) return NextResponse.json({ error: e.message }, { status: 503 })
  console.error('[usage] 조회 오류', e)
  return NextResponse.json({ error: '사용량을 불러오지 못했습니다.' }, { status: 500 })
}

export const HOSPITAL_CODE_RE = /^[A-Za-z0-9_-]{1,40}$/
