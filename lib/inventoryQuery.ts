import { Prisma } from '@prisma/client'

/** 입출고 전표 목록·Excel export 공용 include */
export const txInclude = {
  item: { select: { id: true, itemCode: true, name: true, unit: true, isSerialManaged: true } },
  warehouse: { select: { id: true, name: true } },
  toWarehouse: { select: { id: true, name: true } },
  inventory: { select: { id: true, name: true } },
  toInventory: { select: { id: true, name: true } },
  reasonCode: { select: { id: true, name: true, value: true } },
  hospital: { select: { hospitalCode: true, hospitalName: true } },
  actor: { select: { id: true, name: true } },
  canceledBy: { select: { id: true, name: true } },
  parentTx: { select: { id: true, txCode: true } },
  childTxs: { select: { id: true, txCode: true, item: { select: { name: true } }, quantity: true } },
} satisfies Prisma.InventoryTransactionInclude

/** 입출고 전표 목록·Excel export 공용 필터 (일자는 KST 기준 일 단위) */
export function buildTxWhere(searchParams: URLSearchParams): Prisma.InventoryTransactionWhereInput {
  const txType = searchParams.get('txType')
  const itemId = searchParams.get('itemId')
  const warehouseId = searchParams.get('warehouseId')
  const hospitalCode = searchParams.get('hospitalCode')
  const inventoryId = searchParams.get('inventoryId')
  const refCode = searchParams.get('refCode')
  const from = searchParams.get('from') // YYYY-MM-DD
  const to = searchParams.get('to')

  // 기간 필터는 입출고일(tx_date, DATE) 기준 — 소급 등록 전표도 업무 기준일로 조회 (2026-07-20)
  const txDate: Prisma.DateTimeFilter = {}
  if (from) txDate.gte = new Date(from)
  if (to) txDate.lte = new Date(to)

  // warehouseId·inventoryId 필터는 출발/도착 어느 쪽이든 매칭 — 둘 다 있으면 AND로 결합
  const and: Prisma.InventoryTransactionWhereInput[] = []
  if (warehouseId) and.push({ OR: [{ warehouseId: parseInt(warehouseId) }, { toWarehouseId: parseInt(warehouseId) }] })
  if (inventoryId) and.push({ OR: [{ inventoryId: parseInt(inventoryId) }, { toInventoryId: parseInt(inventoryId) }] })

  return {
    ...(txType ? { txType } : {}),
    ...(itemId ? { itemId: parseInt(itemId) } : {}),
    ...(hospitalCode ? { hospitalCode } : {}),
    ...(refCode ? { refCode } : {}),
    ...(from || to ? { txDate } : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  }
}
