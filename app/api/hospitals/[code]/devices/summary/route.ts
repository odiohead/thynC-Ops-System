import { NextRequest, NextResponse } from 'next/server'
import { getHospitalDeviceSummary } from '@/lib/deviceRegistry'
import { errorResponse, guardHospitalRoute } from '../shared'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string } }

/**
 * GET /api/hospitals/[code]/devices/summary — 모델별 배치/계약/차이·WMS·최근 (§7.1, 로그인 전체)
 * `/devices` 병원 뷰 요약 스트립. 병원 상세 카드는 lib를 직접 호출한다(§6.2).
 */
export async function GET(request: NextRequest, { params }: Params) {
  const g = await guardHospitalRoute(request, params.code)
  if (!g.ok) return g.response
  try {
    const summary = await getHospitalDeviceSummary(g.hospital.hospitalCode)
    if (!summary) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })
    return NextResponse.json(summary)
  } catch (e) {
    return errorResponse(e, '기기 요약 조회 중 오류가 발생했습니다.')
  }
}
