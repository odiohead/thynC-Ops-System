import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { autoApplyDiscount } from '@/lib/parking'

export const dynamic = 'force-dynamic'

// POST { carId, carNo } → 자동 계산 결과를 순차 등록 (무료 먼저 → 903 유료)
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const carId = String(body.carId || '').trim()
  const carNo = String(body.carNo || '').trim()
  if (!carId || !carNo) {
    return NextResponse.json({ error: '차량 정보가 누락되었습니다.' }, { status: 400 })
  }

  try {
    const result = await autoApplyDiscount(carId, carNo)
    return NextResponse.json(result, { status: result.ok ? 200 : 409 })
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e instanceof Error ? e.message : '') || '자동 등록 실패' }, { status: 502 })
  }
}
