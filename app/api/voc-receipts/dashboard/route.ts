/**
 * VOC 주간 대시보드 지표 (projects/voc_dashboard_design.md §5)
 * GET ?week=2026-W43&repeat=5 — 생략 시 지난주(완결 주). 권한: VOC 열람과 동일(로그인)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { buildVocDashboard, defaultIsoWeek, parseIsoWeek } from '@/lib/vocDashboard'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = request.nextUrl.searchParams
  const weekParam = sp.get('week')
  const week = weekParam ? parseIsoWeek(weekParam) : defaultIsoWeek()
  if (!week) return NextResponse.json({ error: 'week는 YYYY-Www 형식이어야 합니다. (예: 2026-W43)' }, { status: 400 })
  const repeat = sp.get('repeat') ? parseInt(sp.get('repeat')!) : undefined
  try {
    return NextResponse.json(await buildVocDashboard({ ...week, repeatThreshold: repeat }))
  } catch (e) {
    console.error('[voc-dashboard]', e)
    return NextResponse.json({ error: '지표 집계 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
