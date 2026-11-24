import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'
import { auditActorFromJWT } from '@/lib/audit'
import { resolveHiraSyncReview } from '@/lib/hiraTwin'

export const dynamic = 'force-dynamic'

/**
 * POST — 병원 등록 동기화 '확인 필요' 1건 처리 (2026-11-12)
 * body { hiraHospitalId, action: 'relink' | 'create', hospitalCode? }
 *  - relink: 같은 병원 — 후보 병원의 심평원 연결을 이 레코드로 교체
 *  - create: 다른 병원 — 새 미계약 병원으로 등록
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const body = (await request.json().catch(() => null)) as { hiraHospitalId?: unknown; action?: unknown; hospitalCode?: unknown } | null
  const hiraHospitalId = Number(body?.hiraHospitalId)
  const action = body?.action
  if (!Number.isInteger(hiraHospitalId) || hiraHospitalId <= 0 || (action !== 'relink' && action !== 'create')) {
    return NextResponse.json({ error: '요청 값이 올바르지 않습니다.' }, { status: 400 })
  }
  const res = await resolveHiraSyncReview({
    hiraHospitalId,
    action,
    hospitalCode: typeof body?.hospitalCode === 'string' ? body.hospitalCode : undefined,
    req: request,
    actor: auditActorFromJWT(user),
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ success: true, hospitalCode: res.hospitalCode })
}
