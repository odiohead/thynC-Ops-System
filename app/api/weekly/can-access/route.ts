import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { hasPermission } from '@/lib/appRoles'

export const dynamic = 'force-dynamic'

/**
 * 메인 대시보드 주간업무 진입 아이콘 표시 여부 (UI 게이트 — inventory/can-manage 패턴)
 * 아이콘은 `weekly.access` 권한 보유자에게만 노출 (SEERS 소속만으로는 미노출 — 2026-08-21 요구).
 * 페이지 실제 접근 제어는 checkWeeklyAccess가 별도 강제한다.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ entry: false })
  return NextResponse.json({ entry: await hasPermission(user, 'weekly.access') })
}
