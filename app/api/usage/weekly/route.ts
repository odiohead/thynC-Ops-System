import { NextRequest, NextResponse } from 'next/server'
import { USAGE_MODELS, getUsageWeekly, type UsageModel } from '@/lib/usage/metrics'
import { HOSPITAL_CODE_RE, usageError, usageGate } from '../_shared'

export const dynamic = 'force-dynamic'

/**
 * 병원의 주간 사용량 — ?hospital=<병원코드>&model=all|general|usage
 * 최근 12주(월~일, 이번 주는 진행 중): 주간 실측정 수·전주 대비, 최대 동시측정 수 평균·최고, 기기 종류별 동시 가동률 평균·최고
 */
export async function GET(req: NextRequest) {
  const gate = await usageGate(req)
  if ('response' in gate) return gate.response
  const hospital = req.nextUrl.searchParams.get('hospital') ?? ''
  if (!HOSPITAL_CODE_RE.test(hospital)) return NextResponse.json({ error: '병원 코드가 올바르지 않습니다.' }, { status: 400 })
  const modelParam = req.nextUrl.searchParams.get('model') ?? 'all'
  const model: UsageModel = USAGE_MODELS.some((m) => m.key === modelParam) ? (modelParam as UsageModel) : 'all'
  try {
    return NextResponse.json(await getUsageWeekly(hospital, model))
  } catch (e) {
    return usageError(e)
  }
}
