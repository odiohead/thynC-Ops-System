import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { searchCars } from '@/lib/parking'

export const dynamic = 'force-dynamic'

// POST { carNo } → 입차 차량 검색 (읽기 전용)
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { carNo, entryDate } = await request.json().catch(() => ({}))
  const q = String(carNo || '').trim()
  if (q.length < 2) {
    return NextResponse.json({ error: '차량번호 2자리 이상 입력하세요.' }, { status: 400 })
  }
  const date = entryDate ? String(entryDate).trim() : undefined

  try {
    const result = await searchCars(q, date)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: (e instanceof Error ? e.message : '') || '검색 실패' }, { status: 502 })
  }
}
