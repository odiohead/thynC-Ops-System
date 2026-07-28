import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { couponsForCar } from '@/lib/parking'

export const dynamic = 'force-dynamic'

// POST { carId } → 해당 차량에 대한 4개 계정의 사용 가능 할인권·잔여 (읽기 전용)
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { carId } = await request.json().catch(() => ({}))
  const id = String(carId || '').trim()
  if (!id) return NextResponse.json({ error: '차량이 선택되지 않았습니다.' }, { status: 400 })

  try {
    const accounts = await couponsForCar(id)
    return NextResponse.json({ accounts })
  } catch (e) {
    return NextResponse.json({ error: (e instanceof Error ? e.message : '') || '조회 실패' }, { status: 502 })
  }
}
