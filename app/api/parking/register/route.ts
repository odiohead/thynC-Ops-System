import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { registerDiscount } from '@/lib/parking'

export const dynamic = 'force-dynamic'

// POST { userId, carNo, carId?, discountType } → 한 계정으로 할인권 1건 등록
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const userId = String(body.userId || '').trim()
  const carNo = String(body.carNo || '').trim()
  const discountType = String(body.discountType || '').trim()
  const carId = body.carId ? String(body.carId).trim() : undefined
  const entryDate = body.entryDate ? String(body.entryDate).trim() : undefined

  if (!userId || !carNo || !discountType) {
    return NextResponse.json({ error: '필수 값이 누락되었습니다.' }, { status: 400 })
  }

  try {
    const result = await registerDiscount({ userId, carNo, carId, discountType, entryDate })
    return NextResponse.json(result, { status: result.ok ? 200 : 409 })
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e instanceof Error ? e.message : '') || '등록 실패' }, { status: 502 })
  }
}
