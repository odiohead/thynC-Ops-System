import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { planAutoDiscount } from '@/lib/parking'

export const dynamic = 'force-dynamic'

// POST { carId } → 주차시간 기반 자동 할인권 조합 미리보기 (읽기 전용)
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { carId } = await request.json().catch(() => ({}))
  const id = String(carId || '').trim()
  if (!id) return NextResponse.json({ error: '차량이 선택되지 않았습니다.' }, { status: 400 })

  try {
    const plan = await planAutoDiscount(id)
    return NextResponse.json(plan)
  } catch (e) {
    return NextResponse.json({ error: (e instanceof Error ? e.message : '') || '계산 실패' }, { status: 502 })
  }
}
