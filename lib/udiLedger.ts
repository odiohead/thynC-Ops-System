import { prisma } from '@/lib/prisma'
import { ledgerDisplayName } from '@/lib/itemUdi'
import { resolveTxLotRows, getLotStocks } from '@/lib/inventoryLot'

/**
 * UDI 입출고대장 조립 (projects/inventory_udi_ledger_design.md §5.2)
 *
 * 문서 1부 = **모델 1종** (예: 'MP100W 입출고대장', 2026-08-04 사용자 확정).
 * 문서 안의 각 행은 **UDI × LOT** 단위로 식별된다 — 원 양식에 UDI·LOT NO 컬럼이 행마다 있는 이유다.
 * 인벤토리는 필터로만 좁힌다(미지정 = 전체 합산).
 *
 * UDI-DI는 품목 속성이고 품목은 인벤토리별로 분리되어 있으므로,
 * 한 모델에 여러 UDI(사양·포장 변경분)와 여러 인벤토리 품목이 함께 묶일 수 있다.
 * 사내 이동(MOVE/TRANSFER)과 취소 전표는 대외 입출고가 아니므로 제외한다.
 */

export interface LedgerRow {
  txId: number
  txCode: string
  date: string // YYYY.MM.DD
  udi: string
  productName: string
  lotNo: string
  quantity: number
  counterpart: string // IN=발송처정보 / OUT=입고처정보
  note: string
  checked: boolean // IN 전용 — '동일 LOT NO 제품 출고완료' 수동 체크
}

export interface LedgerHeader {
  modelName: string
  productClass: string
  materialNo: string
}

/** UDI × LOT 잔량 소계 */
export interface LedgerStockRow {
  udi: string
  lotNo: string
  remain: number
}

/** 대장 대상 모델 = 같은 model_name을 가진 (UDI 등록) 품목 묶음 */
export interface LedgerModel {
  modelName: string
  ledgerName: string
  productClass: string | null
  materialNo: string | null
  packUnit: string
  udiList: string[]
  itemIds: number[]
  itemCount: number
  inventoryNames: string[]
  /** 묶인 품목들의 대장 표기 정보가 서로 다르면 true — 품목별 입력이라 어긋날 수 있다 */
  hasConflict: boolean
}

export interface Ledger {
  model: LedgerModel
  header: LedgerHeader
  inRows: LedgerRow[]
  outRows: LedgerRow[]
  inTotal: number
  outTotal: number
  /** UDI × LOT 잔량 소계 (화면 표시용) */
  stockRows: LedgerStockRow[]
  currentStock: number
  itemIds: number[]
  inventoryNames: string[]
}

/** @db.Date 값을 대장 표기(YYYY.MM.DD)로 — UTC 자정 저장이라 TZ 보정 불필요 */
function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '.')
}

type UdiItem = {
  id: number
  name: string
  modelName: string | null
  udiDi: string | null
  ledgerName: string | null
  productClass: string | null
  materialNo: string | null
  packUnit: string
  inventory: { id: number; name: string }
}

const udiItemSelect = {
  id: true,
  name: true,
  modelName: true,
  udiDi: true,
  ledgerName: true,
  productClass: true,
  materialNo: true,
  packUnit: true,
  inventory: { select: { id: true, name: true } },
} as const

function distinct<T>(vals: (T | null | undefined)[]): T[] {
  return Array.from(new Set(vals.filter((v): v is T => v != null && v !== ('' as unknown as T))))
}

/** UDI가 등록된 품목을 모델명 기준으로 묶는다 */
function groupByModel(items: UdiItem[]): LedgerModel[] {
  const map = new Map<string, UdiItem[]>()
  for (const it of items) {
    if (!it.udiDi) continue
    const key = it.modelName?.trim() || it.name // 모델명이 없으면 품목명으로 대체
    const list = map.get(key) ?? []
    list.push(it)
    map.set(key, list)
  }

  return Array.from(map.entries())
    .map(([modelName, list]) => {
      const names = distinct(list.map((i) => ledgerDisplayName(i)))
      const classes = distinct(list.map((i) => i.productClass))
      const materials = distinct(list.map((i) => i.materialNo))
      return {
        modelName,
        ledgerName: names[0] ?? modelName,
        productClass: classes[0] ?? null,
        materialNo: materials[0] ?? null,
        packUnit: list[0].packUnit,
        udiList: distinct(list.map((i) => i.udiDi)).sort(),
        itemIds: list.map((i) => i.id),
        itemCount: list.length,
        inventoryNames: distinct(list.map((i) => i.inventory.name)).sort(),
        // 품목별로 따로 입력하는 값이라 인벤토리 간 불일치가 생길 수 있다 → 화면에서 경고
        hasConflict: names.length > 1 || classes.length > 1 || materials.length > 1,
      }
    })
    .sort((a, b) => a.ledgerName.localeCompare(b.ledgerName))
}

async function fetchUdiItems(where: { modelName?: string; inventoryIds?: number[] }): Promise<UdiItem[]> {
  return prisma.inventoryItem.findMany({
    where: {
      udiDi: { not: null },
      ...(where.modelName ? { modelName: where.modelName } : {}),
      ...(where.inventoryIds?.length ? { inventoryId: { in: where.inventoryIds } } : {}),
    },
    select: udiItemSelect,
    orderBy: { id: 'asc' },
  })
}

/** 대장을 만들 수 있는 모델 목록 (UDI가 등록된 품목이 있는 것만) */
export async function listLedgerModels(inventoryIds?: number[]): Promise<LedgerModel[]> {
  return groupByModel(await fetchUdiItems({ inventoryIds }))
}

async function resolveModel(modelName: string, inventoryIds?: number[]): Promise<LedgerModel | null> {
  const items = await fetchUdiItems({ modelName, inventoryIds })
  if (items.length === 0) return null
  return groupByModel(items)[0] ?? null
}

export async function buildLedger(opts: {
  modelName: string
  inventoryIds?: number[]
  from?: string | null
  to?: string | null
}): Promise<Ledger | null> {
  const items = await fetchUdiItems({ modelName: opts.modelName, inventoryIds: opts.inventoryIds })
  if (items.length === 0) return null
  const model = groupByModel(items)[0]

  const itemById = new Map(items.map((i) => [i.id, i]))
  const itemIds = model.itemIds

  const txs = await prisma.inventoryTransaction.findMany({
    where: {
      itemId: { in: itemIds },
      canceledAt: null,
      txType: { in: ['IN', 'OUT'] }, // 사내 이동(MOVE/TRANSFER) 제외
      ...(opts.inventoryIds?.length ? { inventoryId: { in: opts.inventoryIds } } : {}),
      ...(opts.from || opts.to
        ? {
            txDate: {
              ...(opts.from ? { gte: new Date(`${opts.from}T00:00:00.000Z`) } : {}),
              ...(opts.to ? { lte: new Date(`${opts.to}T00:00:00.000Z`) } : {}),
            },
          }
        : {}),
    },
    select: {
      id: true,
      txCode: true,
      txType: true,
      txDate: true,
      quantity: true,
      lotNo: true,
      destination: true,
      note: true,
      itemId: true,
      inventory: { select: { name: true } },
      item: { select: { isSerialManaged: true } },
      units: { select: { unit: { select: { lotNo: true } } } },
    },
    orderBy: [{ txDate: 'asc' }, { id: 'asc' }],
  })

  // 출고완료 수동 체크 (입고 전표 × LOT)
  const checks = txs.length
    ? await prisma.udiLedgerCheck.findMany({
        where: { transactionId: { in: txs.map((t) => t.id) } },
        select: { transactionId: true, lotNo: true, checked: true },
      })
    : []
  const checkedSet = new Set(checks.filter((c) => c.checked).map((c) => `${c.transactionId}|${c.lotNo}`))

  const inRows: LedgerRow[] = []
  const outRows: LedgerRow[] = []
  const inventoryNames = new Set<string>()

  for (const tx of txs) {
    const item = itemById.get(tx.itemId)
    if (!item) continue
    // 한 전표가 복수 LOT을 담을 수 있으므로 LOT별로 행을 분해한다
    for (const part of resolveTxLotRows(tx)) {
      const row: LedgerRow = {
        txId: tx.id,
        txCode: tx.txCode,
        date: fmtDate(tx.txDate),
        udi: item.udiDi ?? '',
        productName: ledgerDisplayName(item),
        lotNo: part.lotNo,
        quantity: part.quantity,
        counterpart: tx.destination ?? '',
        note: tx.note ?? '',
        checked: checkedSet.has(`${tx.id}|${part.lotNo}`),
      }
      if (tx.txType === 'IN') inRows.push(row)
      else outRows.push(row)
      inventoryNames.add(tx.inventory.name)
    }
  }

  // UDI × LOT 잔량 — UDI가 품목 속성이므로 UDI별 품목 묶음마다 집계한다
  const byUdi = new Map<string, number[]>()
  for (const it of items) {
    if (!it.udiDi) continue
    byUdi.set(it.udiDi, [...(byUdi.get(it.udiDi) ?? []), it.id])
  }

  const stockRows: LedgerStockRow[] = []
  for (const [udi, ids] of Array.from(byUdi.entries())) {
    const stocks = await getLotStocks(ids, { inventoryIds: opts.inventoryIds })
    stocks.forEach((remain, lotNo) => {
      if (lotNo === '' && remain === 0) return
      stockRows.push({ udi, lotNo, remain })
    })
  }
  stockRows.sort((a, b) => a.udi.localeCompare(b.udi) || a.lotNo.localeCompare(b.lotNo))

  return {
    model,
    header: {
      modelName: model.ledgerName,
      productClass: model.productClass ?? '',
      materialNo: model.materialNo ?? '-',
    },
    inRows,
    outRows,
    inTotal: inRows.reduce((s, r) => s + r.quantity, 0),
    outTotal: outRows.reduce((s, r) => s + r.quantity, 0),
    stockRows,
    currentStock: stockRows.reduce((s, r) => s + r.remain, 0),
    itemIds,
    inventoryNames: Array.from(inventoryNames).sort(),
  }
}

export { resolveModel }
