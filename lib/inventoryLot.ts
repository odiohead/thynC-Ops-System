import { prisma } from '@/lib/prisma'

/**
 * LOT 해석 공용 헬퍼 (projects/inventory_udi_ledger_design.md §5.1)
 *
 * 자재관리의 LOT 저장 위치는 품목 유형에 따라 이원화되어 있다.
 *   · 시리얼 관리 품목  : 개체(inventory_units.lot_no) — 전표의 lot_no는 비어 있는 경우가 대부분
 *   · 비시리얼 LOT 품목 : 전표(inventory_transactions.lot_no) — 재고 버킷 키이기도 함
 *
 * 전표의 lot_no만 보면 시리얼 품목의 LOT이 통째로 소실되므로, 반드시 이 헬퍼를 경유한다.
 * (2026-08-04 이전 lot-history API가 이 결함을 갖고 있었다)
 */

/** LOT별로 분해된 전표 수량 한 줄 */
export interface TxLotRow {
  lotNo: string // '' = LOT 없음
  quantity: number
}

/** 전표 → LOT 행 분해에 필요한 최소 형태 */
export interface TxForLot {
  quantity: number
  lotNo: string | null
  item: { isSerialManaged: boolean }
  units?: { unit: { lotNo: string | null } }[]
}

/** 대장·집계에서 제외할 전표 유형 — 사내 이동은 대외 입출고가 아님 */
export const LEDGER_EXCLUDED_TX_TYPES = ['MOVE', 'TRANSFER'] as const

/** 전표 → LOT별 행 분해. 한 전표에 복수 LOT이 섞여 있으면 LOT 수만큼 행이 나온다. */
export function resolveTxLotRows(tx: TxForLot): TxLotRow[] {
  if (!tx.item.isSerialManaged) {
    // 비시리얼: 전표 LOT 하나로 전량 귀속
    return [{ lotNo: tx.lotNo ?? '', quantity: tx.quantity }]
  }

  // 시리얼: 연결된 개체의 LOT으로 집계
  const byLot = new Map<string, number>()
  for (const link of tx.units ?? []) {
    const lot = link.unit.lotNo ?? ''
    byLot.set(lot, (byLot.get(lot) ?? 0) + 1)
  }

  if (byLot.size === 0) {
    // 개체 연결이 없는 예외 전표 — 전표 LOT으로 폴백
    return [{ lotNo: tx.lotNo ?? '', quantity: tx.quantity }]
  }

  return Array.from(byLot.entries())
    .map(([lotNo, quantity]) => ({ lotNo, quantity }))
    .sort((a, b) => a.lotNo.localeCompare(b.lotNo))
}

/** resolveTxLotRows에 필요한 Prisma include 조각 */
export const txLotInclude = {
  item: { select: { isSerialManaged: true } },
  units: { select: { unit: { select: { lotNo: true } } } },
} as const

/**
 * 품목들의 LOT별 현재고.
 * 시리얼 품목은 개체(IN_STOCK) 수, 비시리얼 품목은 재고 버킷 합계.
 */
export async function getLotStocks(
  itemIds: number[],
  opts: { inventoryIds?: number[] } = {},
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (itemIds.length === 0) return out

  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, isSerialManaged: true },
  })
  const serialIds = items.filter((i) => i.isSerialManaged).map((i) => i.id)
  const plainIds = items.filter((i) => !i.isSerialManaged).map((i) => i.id)

  const add = (lot: string | null, qty: number) => {
    const key = lot ?? ''
    out.set(key, (out.get(key) ?? 0) + qty)
  }

  if (serialIds.length > 0) {
    const units = await prisma.inventoryUnit.groupBy({
      by: ['lotNo'],
      where: {
        itemId: { in: serialIds },
        status: 'IN_STOCK',
        ...(opts.inventoryIds?.length ? { inventoryId: { in: opts.inventoryIds } } : {}),
      },
      _count: { _all: true },
    })
    for (const u of units) add(u.lotNo, u._count._all)
  }

  if (plainIds.length > 0) {
    const stocks = await prisma.inventoryStock.groupBy({
      by: ['lotNo'],
      where: {
        itemId: { in: plainIds },
        ...(opts.inventoryIds?.length ? { inventoryId: { in: opts.inventoryIds } } : {}),
      },
      _sum: { quantity: true },
    })
    for (const s of stocks) add(s.lotNo, s._sum.quantity ?? 0)
  }

  return out
}

/** LOT별 입고·출고·잔량 요약 (품목 상세 LOT 이력 / 대장 LOT 선택 공용) */
export interface LotSummary {
  lotNo: string
  inQty: number
  outQty: number
  remain: number
}

export async function summarizeLots(
  itemIds: number[],
  opts: { inventoryIds?: number[] } = {},
): Promise<LotSummary[]> {
  if (itemIds.length === 0) return []

  const txs = await prisma.inventoryTransaction.findMany({
    where: {
      itemId: { in: itemIds },
      canceledAt: null,
      txType: { in: ['IN', 'OUT'] },
      ...(opts.inventoryIds?.length ? { inventoryId: { in: opts.inventoryIds } } : {}),
    },
    select: { txType: true, quantity: true, lotNo: true, ...txLotInclude },
  })

  const map = new Map<string, LotSummary>()
  const bucket = (lotNo: string) => {
    if (!map.has(lotNo)) map.set(lotNo, { lotNo, inQty: 0, outQty: 0, remain: 0 })
    return map.get(lotNo)!
  }

  for (const tx of txs) {
    for (const row of resolveTxLotRows(tx)) {
      const e = bucket(row.lotNo)
      if (tx.txType === 'IN') e.inQty += row.quantity
      else e.outQty += row.quantity
    }
  }

  const stocks = await getLotStocks(itemIds, opts)
  stocks.forEach((qty, lotNo) => { bucket(lotNo).remain = qty })

  return Array.from(map.values())
    .filter((l) => l.lotNo !== '' || l.inQty || l.outQty || l.remain)
    .sort((a, b) => a.lotNo.localeCompare(b.lotNo))
}
