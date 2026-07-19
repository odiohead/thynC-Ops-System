import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { loadRules, saveRules } from '@/lib/gateway-planner/rules'

export const dynamic = 'force-dynamic'

// 배치 규칙 조회
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const rules = await loadRules()
  return NextResponse.json({ rules })
}

// 배치 규칙 저장 (ADMIN 이상)
export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const before = await loadRules()
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  const rules = await saveRules(body)

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'setting:gateway-planner',
    resourceId: 'gw_planner_rules',
    resourceLabel: 'GW 배치 규칙',
    before,
    after: rules,
  })
  return NextResponse.json({ rules })
}
