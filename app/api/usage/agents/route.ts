import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auditActorFromJWT, logAudit } from '@/lib/audit'
import { getAgentOverview, ingestAdmin } from '@/lib/usage/agents'
import { HOSPITAL_CODE_RE, usageGate } from '../_shared'
import { agentAdminGate, agentError, noteOf, serverCount } from './_admin'

export const dynamic = 'force-dynamic'

/**
 * 에이전트 관리 (projects/usage_agent_enroll_design.md)
 * GET  수집 병원 등록 현황 — 운영 중인 병원 중 수집 중인 병원 수, 병원별 서버와 수집 상태, 설치 묶음 버전
 * POST 병원 등록 { hospitalCode, expectedServers, note? } — 병원 목록에 있는 병원만. 병원명은 본체 값을 쓴다 (ADMIN 이상)
 */
export async function GET(req: NextRequest) {
  const gate = await usageGate(req)
  if ('response' in gate) return gate.response
  try {
    return NextResponse.json(await getAgentOverview())
  } catch (e) {
    return agentError(e)
  }
}

export async function POST(req: NextRequest) {
  const gate = await agentAdminGate(req)
  if ('response' in gate) return gate.response
  const body = await req.json().catch(() => ({}))
  const hospitalCode = typeof body.hospitalCode === 'string' ? body.hospitalCode.trim() : ''
  if (!HOSPITAL_CODE_RE.test(hospitalCode)) return NextResponse.json({ error: '병원을 선택하세요.' }, { status: 400 })
  const expected = serverCount(body.expectedServers)
  if (expected === null) return NextResponse.json({ error: '서버 대수는 1~50 사이의 숫자여야 합니다.' }, { status: 400 })
  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode }, select: { hospitalCode: true, hospitalName: true } })
  if (!hospital) return NextResponse.json({ error: '병원 목록에 없는 병원코드입니다.' }, { status: 404 })
  try {
    // create_only — 이미 등록된 병원이면 수신부가 아무것도 바꾸지 않고 409 를 준다
    await ingestAdmin('/enrollments', { hospital_code: hospitalCode, hospital_name: hospital.hospitalName, expected_servers: expected, note: noteOf(body.note), by: gate.user.email, create_only: true })
    await logAudit({ req, actor: auditActorFromJWT(gate.user), action: 'CREATE', resource: 'usage_agent_enrollment', resourceId: hospitalCode, resourceLabel: hospital.hospitalName, after: { expectedServers: expected } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return agentError(e)
  }
}
