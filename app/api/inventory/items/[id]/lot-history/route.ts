import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { summarizeLots } from '@/lib/inventoryLot'

export const dynamic = 'force-dynamic'

// GET — LOT 관리 품목의 LOT번호별 입고·출고·잔량 요약 (취소 전표 제외)
//
// 2026-08-04: 전표(lotNo)만 보던 기존 구현은 시리얼 관리 품목의 LOT을 통째로 놓쳤다.
// (시리얼 품목은 LOT이 개체에 기록되어 출고 전표의 lotNo가 비어 있음 → 전량 '(빈 LOT)'으로 뭉개짐)
// LOT 해석은 lib/inventoryLot.ts 단일 소스를 경유한다.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const lots = await summarizeLots([id])

  return NextResponse.json({ lots })
}
