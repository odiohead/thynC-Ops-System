import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { retryReportAi } from '@/lib/report/runner'

export const dynamic = 'force-dynamic'

/** 같은 수집 데이터로 AI 단계만 다시 (현재 레포트 AI 설정 적용) */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    await retryReportAi(params.id, user.userId)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'AI 재실행에 실패했습니다.' }, { status: 409 })
  }
  await logAudit({ req: request, actor: auditActorFromJWT(user), action: 'UPDATE', resource: 'report', resourceId: params.id, resourceLabel: '보고서 AI 분석 재실행' })
  return NextResponse.json({ ok: true })
}
