import { NextRequest, NextResponse } from 'next/server'
import { getUsageOverview, isOverviewDevice, isUsageModel } from '@/lib/usage/overview'
import { usageError, usageGate } from '../_shared'

export const dynamic = 'force-dynamic'

/**
 * 전체 병원의 가동률 — ?device=ecg|spo2|cart&model=all|general|usage (projects/usage_overview_design.md)
 * 병원마다 최근 30일 동시 가동률 평균 · 이전 30일 · 변화(%p)와 판정 · 12주 추이 · 수신 상태, 그리고 서비스 전체 한 줄.
 * 일별 집계(lib/usage/stats.ts 가 주기적으로 저장)를 읽는다 — 원본에서 바로 계산하지 않는다.
 */
export async function GET(req: NextRequest) {
  const gate = await usageGate(req)
  if ('response' in gate) return gate.response
  const deviceParam = req.nextUrl.searchParams.get('device')
  const modelParam = req.nextUrl.searchParams.get('model')
  try {
    return NextResponse.json(await getUsageOverview(isOverviewDevice(deviceParam) ? deviceParam : 'ecg', isUsageModel(modelParam) ? modelParam : 'all'))
  } catch (e) {
    return usageError(e)
  }
}
