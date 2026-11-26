import { NextRequest, NextResponse } from 'next/server'
import { listFilterHospitals } from '@/lib/usage/views'
import { usageError, usageGate } from '../_shared'

export const dynamic = 'force-dynamic'

/** 대시보드 '병원 지정'에서 고를 수 있는 병원 — 운영 중이거나 수집 서버가 등록된 병원 (이름 · 종별 · 수집 여부 · 태그) */
export async function GET(req: NextRequest) {
  const gate = await usageGate(req)
  if ('response' in gate) return gate.response
  try {
    return NextResponse.json({ hospitals: await listFilterHospitals() })
  } catch (e) {
    return usageError(e)
  }
}
