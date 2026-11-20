import { NextRequest, NextResponse } from 'next/server'
import { auditActorFromJWT, logAudit } from '@/lib/audit'
import { ingestAdmin } from '@/lib/usage/agents'
import { agentAdminGate, agentError } from '../../_admin'

export const dynamic = 'force-dynamic'

const ACTIONS = ['block', 'unblock', 'allow_reenroll', 'cancel_reenroll'] as const

/**
 * POST 서버 조치 { action } (ADMIN 이상)
 *   block            차단 — 접속을 거부하고 서버 자리 계산에서 뺀다 (받은 기록은 그대로)
 *   unblock          차단 해제
 *   allow_reenroll   재등록 허용 — 같은 이름으로 설치 스크립트를 다시 돌리면 키를 새로 받는다 (서버 재설치)
 *   cancel_reenroll  재등록 허용 취소
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await agentAdminGate(req)
  if ('response' in gate) return gate.response
  const server = Number(params.id)
  if (!Number.isInteger(server) || server <= 0) return NextResponse.json({ error: '서버 번호가 올바르지 않습니다.' }, { status: 400 })
  const body = await req.json().catch(() => ({}))
  const action = ACTIONS.find((a) => a === body.action)
  if (!action) return NextResponse.json({ error: '알 수 없는 조치입니다.' }, { status: 400 })
  try {
    await ingestAdmin('/servers/action', { server, action, by: gate.user.email })
    await logAudit({ req, actor: auditActorFromJWT(gate.user), action: 'UPDATE', resource: 'usage_agent_server', resourceId: server, after: { action } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return agentError(e)
  }
}
