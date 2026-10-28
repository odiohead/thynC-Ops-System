/**
 * VOC·AS 주간 대시보드 지표 (projects/voc_dashboard_design.md §5)
 * GET ?week=YYYY-MM-DD(금요일) | YYYY-Www — 생략 시 마지막 완결 금~목 주. 권한: VOC 열람과 동일(로그인)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { buildVocDashboard, defaultWeekStart, parseWeekStart } from '@/lib/vocDashboard'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const weekParam = request.nextUrl.searchParams.get('week')
  const weekStart = weekParam ? parseWeekStart(weekParam) : defaultWeekStart()
  if (!weekStart) return NextResponse.json({ error: 'week는 금요일 날짜(YYYY-MM-DD) 또는 YYYY-Www 형식이어야 합니다. (예: 2026-10-16, 2026-W43)' }, { status: 400 })
  try {
    return NextResponse.json(await buildVocDashboard({ weekStart }))
  } catch (e) {
    console.error('[voc-dashboard]', e)
    return NextResponse.json({ error: '지표 집계 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
