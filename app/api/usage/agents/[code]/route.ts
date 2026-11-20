import { NextRequest, NextResponse } from 'next/server'
import { auditActorFromJWT, logAudit } from '@/lib/audit'
import { ingestAdmin } from '@/lib/usage/agents'
import { HOSPITAL_CODE_RE } from '../../_shared'
import { agentAdminGate, agentError, noteOf, serverCount } from '../_admin'

export const dynamic = 'force-dynamic'

/**
 * PATCH  등록 수정 { expectedServers?, note? } — 서버 대수를 늘리면 그만큼 설치 자리가 열린다 (ADMIN 이상)
 * DELETE 등록 해제 — 서버가 하나도 없는 병원만 (받은 기록은 지우지 않는다)
 */
export async function PATCH(req: NextRequest, { params }: { params: { code: string } }) {
  const gate = await agentAdminGate(req)
  if ('response' in gate) return gate.response
  if (!HOSPITAL_CODE_RE.test(params.code)) return NextResponse.json({ error: '병원 코드가 올바르지 않습니다.' }, { status: 400 })
  const body = await req.json().catch(() => ({}))
  const patch: Record<string, unknown> = { hospital_code: params.code, by: gate.user.email }
  if (body.expectedServers !== undefined) {
    const expected = serverCount(body.expectedServers)
    if (expected === null) return NextResponse.json({ error: '서버 대수는 1~50 사이의 숫자여야 합니다.' }, { status: 400 })
    patch.expected_servers = expected
  }
  if (body.note !== undefined) patch.note = noteOf(body.note)
  try {
    const out = await ingestAdmin('/enrollments', patch)
    // 등록이 없던 병원(병원 토큰으로만 수집하던 병원)은 이 호출로 등록된다
    await logAudit({ req, actor: auditActorFromJWT(gate.user), action: out.created === true ? 'CREATE' : 'UPDATE', resource: 'usage_agent_enrollment', resourceId: params.code, after: { expectedServers: patch.expected_servers, note: patch.note } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return agentError(e)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { code: string } }) {
  const gate = await agentAdminGate(req)
  if ('response' in gate) return gate.response
  if (!HOSPITAL_CODE_RE.test(params.code)) return NextResponse.json({ error: '병원 코드가 올바르지 않습니다.' }, { status: 400 })
  try {
    await ingestAdmin('/enrollments/remove', { hospital_code: params.code, by: gate.user.email })
    await logAudit({ req, actor: auditActorFromJWT(gate.user), action: 'DELETE', resource: 'usage_agent_enrollment', resourceId: params.code })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return agentError(e)
  }
}
