import { NextRequest, NextResponse } from 'next/server'
import { listImportBatches } from '@/lib/deviceRegistry'
import { errorResponse, guardHospitalRoute } from '../shared'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string } }

/**
 * GET /api/hospitals/[code]/devices/imports?page&limit — 임포트 배치 목록(최신순, 작성자·취소자 이름 포함) (§7.1, 로그인)
 * `{ data:[{ …batch, createdBy:{id,name}|null, cancelledBy, createdByName, cancelledByName }], total, page, limit }`
 */
export async function GET(request: NextRequest, { params }: Params) {
  const g = await guardHospitalRoute(request, params.code)
  if (!g.ok) return g.response
  try {
    const sp = request.nextUrl.searchParams
    const page = Number(sp.get('page')) || 1
    const limit = Number(sp.get('limit')) || 20
    const { data, total, page: p, limit: l } = await listImportBatches(g.hospital.hospitalCode, { page, limit })
    return NextResponse.json({
      data: data.map((b) => ({ ...b, createdByName: b.createdBy?.name ?? null, cancelledByName: b.cancelledBy?.name ?? null })),
      total,
      page: p,
      limit: l,
    })
  } catch (e) {
    return errorResponse(e, '임포트 이력 조회 중 오류가 발생했습니다.')
  }
}
