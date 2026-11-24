import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'
import { auditActorFromJWT } from '@/lib/audit'
import { executeHospitalSyncFromHira, hiraSyncSummaryText, planHospitalSyncFromHira } from '@/lib/hiraTwin'

export const dynamic = 'force-dynamic'

/**
 * 병원 등록 동기화 — 병원이 없는 심평원 레코드를 미계약 병원으로 등록.
 * 요양기호만 바뀐 같은 병원은 새로 만들지 않는다 (2026-11-12, lib/hiraTwin.ts):
 * 구 레코드가 폐기된 키면 기존 병원의 연결만 교체, 판단이 애매하면 '확인 필요'로 돌려준다.
 */

// GET — 실행하지 않고 계획만 (화면의 '확인 필요' 목록)
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const plan = await planHospitalSyncFromHira()
  return NextResponse.json({
    syncAt: plan.syncAt,
    createCount: plan.create.length,
    relink: plan.relink,
    review: plan.review,
    skippedDead: plan.skippedDead,
    message: hiraSyncSummaryText({ created: plan.create.length, relinked: plan.relink.length, review: plan.review.length, skippedDead: plan.skippedDead }),
  })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const result = await executeHospitalSyncFromHira({ req: request, actor: auditActorFromJWT(user) })
  const nothing = result.created === 0 && result.relinked.length === 0 && result.review.length === 0
  return NextResponse.json({ ...result, message: nothing ? '신규 병원이 없습니다.' : result.message })
}
