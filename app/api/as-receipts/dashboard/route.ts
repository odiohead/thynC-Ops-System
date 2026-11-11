/**
 * AS 대시보드 지표 (projects/as_dashboard_design.md §5)
 * GET ?section=now|period|hospitals|quality &from=YYYY-MM-DD|all &to= &category=FAULT|LOST &group=ECG|SPO2|ETC &hospital=<병원코드> &granularity=day|week|month(period 전용)
 * 권한: AS업무 열람과 동일(로그인). 읽기 전용 — 지표 정의는 lib/asDashboard.ts 단일 소스
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import {
  AS_DASH_SECTIONS, AS_DASH_GRANULARITIES, resolveAsDashFilter, buildAsDashNow, buildAsDashPeriod, buildAsDashHospitals, buildAsDashQuality,
  type AsDashSection, type AsDashGranularity,
} from '@/lib/asDashboard'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = request.nextUrl.searchParams
  const section = sp.get('section') ?? 'now'
  if (!(AS_DASH_SECTIONS as readonly string[]).includes(section)) return NextResponse.json({ error: 'section은 now·period·hospitals·quality 중 하나여야 합니다.' }, { status: 400 })
  try {
    const filter = await resolveAsDashFilter(sp)
    const g = sp.get('granularity')
    const granularity = (AS_DASH_GRANULARITIES as readonly string[]).includes(g ?? '') ? (g as AsDashGranularity) : null
    const data =
      (section as AsDashSection) === 'now' ? await buildAsDashNow(filter)
      : section === 'period' ? await buildAsDashPeriod(filter, granularity)
      : section === 'hospitals' ? await buildAsDashHospitals(filter)
      : await buildAsDashQuality(filter)
    return NextResponse.json({ section, filter, generatedAt: new Date().toISOString(), data })
  } catch (e) {
    console.error('[as-dashboard]', e)
    return NextResponse.json({ error: '지표 집계 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
