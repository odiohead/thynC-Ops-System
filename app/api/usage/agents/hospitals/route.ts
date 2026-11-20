import { NextRequest, NextResponse } from 'next/server'
import { searchHospitalsToEnroll } from '@/lib/usage/agents'
import { agentAdminGate, agentError } from '../_admin'

export const dynamic = 'force-dynamic'

/** GET ?q= — 등록할 병원 찾기 (병원 목록의 병원코드·병원명, 이미 등록한 병원 제외, 운영 중인 병원 먼저, 최대 20곳) */
export async function GET(req: NextRequest) {
  const gate = await agentAdminGate(req)
  if ('response' in gate) return gate.response
  try {
    return NextResponse.json({ hospitals: await searchHospitalsToEnroll((req.nextUrl.searchParams.get('q') ?? '').slice(0, 50)) })
  } catch (e) {
    return agentError(e)
  }
}
