import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { canAccessUsage } from '@/lib/usage/access'
import { isUsageConfigured } from '@/lib/usage/db'
import { getUsageReceive } from '@/lib/usage/metrics'
import { HOSPITAL_CODE_RE } from '../_shared'

export const dynamic = 'force-dynamic'

/**
 * 병원의 사용량 수집 상태 — ?hospital=<병원코드>
 * 병원 상세 화면이 "사용량 보기" 링크를 띄울지 판단하는 데 쓴다.
 * 볼 권한이 없거나 원본 DB가 없는 환경이면 visible:false 로만 답한다(오류로 만들지 않는다).
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const hospital = req.nextUrl.searchParams.get('hospital') ?? ''
  if (!HOSPITAL_CODE_RE.test(hospital) || !isUsageConfigured() || !(await canAccessUsage(user))) {
    return NextResponse.json({ visible: false })
  }
  try {
    const receive = await getUsageReceive(hospital)
    return NextResponse.json({ visible: true, collecting: receive.servers > 0, ...receive })
  } catch (e) {
    console.error('[usage] 상태 조회 오류', e)
    return NextResponse.json({ visible: false })
  }
}
