import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET — LOT 관리 품목의 LOT번호별 입고·출고·잔량 요약 (취소 전표 제외)
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const [grouped, stocks] = await Promise.all([
    prisma.inventoryTransaction.groupBy({
      by: ['lotNo', 'txType'],
      where: { itemId: id, canceledAt: null, txType: { in: ['IN', 'OUT'] } },
      _sum: { quantity: true },
    }),
    prisma.inventoryStock.groupBy({
      by: ['lotNo'],
      where: { itemId: id },
      _sum: { quantity: true },
    }),
  ])

  const map = new Map<string, { lotNo: string; inQty: number; outQty: number; remain: number }>()
  const bucket = (lot: string | null) => {
    const key = lot ?? ''
    if (!map.has(key)) map.set(key, { lotNo: key, inQty: 0, outQty: 0, remain: 0 })
    return map.get(key)!
  }

  for (const g of grouped) {
    const e = bucket(g.lotNo)
    if (g.txType === 'IN') e.inQty += g._sum.quantity ?? 0
    else e.outQty += g._sum.quantity ?? 0
  }
  for (const s of stocks) bucket(s.lotNo).remain = s._sum.quantity ?? 0

  const lots = Array.from(map.values())
    .filter((l) => l.lotNo !== '' || l.inQty || l.outQty || l.remain)
    .sort((a, b) => a.lotNo.localeCompare(b.lotNo))

  return NextResponse.json({ lots })
}
