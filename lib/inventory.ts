import { prisma } from '@/lib/prisma'
import { isAdminOrAbove } from '@/lib/auth'
import { Prisma } from '@prisma/client'

/**
 * 품목 코드 생성: ITEM-NNNN (전체 순번 4자리). function_wms.md §6-5
 */
export async function nextItemCode(): Promise<string> {
  const last = await prisma.inventoryItem.findFirst({
    where: { itemCode: { startsWith: 'ITEM-' } },
    orderBy: { itemCode: 'desc' },
    select: { itemCode: true },
  })
  const seq = last?.itemCode ? parseInt(last.itemCode.slice(5)) + 1 : 1
  return `ITEM-${String(seq).padStart(4, '0')}`
}

/**
 * 재고 처리 권한: ADMIN 이상이거나 재고 담당자 풀(inventory_managers) 등록자.
 * function_wms.md §5 — 서버에서 DB 실시간 조회로 확인 (JWT에 넣지 않음).
 */
export async function canManageStock(user: { userId: string; role: string }): Promise<boolean> {
  if (isAdminOrAbove(user.role)) return true
  const mgr = await prisma.inventoryManager.findUnique({ where: { userId: user.userId } })
  return !!mgr
}

// ─── 전표 유형 (function_wms.md Phase 9 → Phase 10에서 TRANSFER 폐지) ───
// TRANSFER(이관)는 인벤토리별 품목 완전 분리로 폐지 — 과거 전표만 이력에 남음 (신규 생성·취소 불가)

export const TX_TYPES = ['IN', 'OUT', 'MOVE'] as const
export type TxType = (typeof TX_TYPES)[number]

/** IN/OUT 유형(사유)은 StatusCode 마스터로 관리 — 시스템 동작이 걸린 유형은 value로 식별 */
export const REASON_CATEGORY: Record<'IN' | 'OUT', string> = {
  IN: 'STOCK_IN_TYPE',
  OUT: 'STOCK_OUT_TYPE',
}
/** IN 유형 value: 기존 OUT 개체를 복귀시키는 회수(반품) */
export const REASON_VALUE_RETURN = 'RETURN'
/** OUT 유형 value: 개체를 폐기 상태로 만드는 폐기/불량 */
export const REASON_VALUE_DISPOSE = 'DISPOSE'

/** 업무-오류(4xx) 표현용 — API에서 status로 매핑 */
export class InventoryError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

type Tx = Prisma.TransactionClient

async function nextTxCode(client: Tx): Promise<string> {
  const now = new Date()
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const prefix = `STK-${ym}-`
  const last = await client.inventoryTransaction.findFirst({
    where: { txCode: { startsWith: prefix } },
    orderBy: { txCode: 'desc' },
    select: { txCode: true },
  })
  const seq = last?.txCode ? parseInt(last.txCode.slice(-4)) + 1 : 1
  return `${prefix}${String(seq).padStart(4, '0')}`
}

// ─── 재고 버킷 = (품목, 위치, 인벤토리) ───

interface Bucket {
  itemId: number
  warehouseId: number
  inventoryId: number
}

/** 재고 증가 (upsert). */
async function increaseStock(client: Tx, b: Bucket, qty: number) {
  await client.inventoryStock.upsert({
    where: { itemId_warehouseId_inventoryId: b },
    create: { ...b, quantity: qty },
    update: { quantity: { increment: qty } },
  })
}

/** 재고 감소 (조건부 — 부족하면 InventoryError). CHECK 제약과 이중 방어. */
async function decreaseStock(client: Tx, b: Bucket, qty: number, label: string) {
  const res = await client.inventoryStock.updateMany({
    where: { ...b, quantity: { gte: qty } },
    data: { quantity: { decrement: qty } },
  })
  if (res.count === 0) {
    const cur = await client.inventoryStock.findUnique({
      where: { itemId_warehouseId_inventoryId: b },
      select: { quantity: true },
    })
    throw new InventoryError(`재고가 부족합니다. (${label} 현재 ${cur?.quantity ?? 0}개, 요청 ${qty}개)`, 409)
  }
}

export interface ComponentOutInput {
  itemId: number // 부자재 품목
  quantity: number // 출고 수량 (주자재 수량 × 구성 수량 기본, 수정 가능)
}

export interface CreateTxInput {
  txType: TxType
  reasonId?: number | null // IN/OUT 필수 (StatusCode STOCK_IN_TYPE/STOCK_OUT_TYPE)
  itemId: number
  warehouseId: number
  toWarehouseId?: number | null // MOVE 필수
  quantity: number
  destination?: string | null // OUT 출고처 (자유 텍스트)
  hospitalCode?: string | null
  workType?: string | null
  refCode?: string | null
  note?: string | null
  serials?: string[] // 시리얼 품목 IN (신규 또는 회수 대상)
  unitIds?: number[] // 시리얼 품목 OUT/MOVE (선택 개체)
  components?: ComponentOutInput[] // OUT 세트출고 — 매핑된 비시리얼 부자재 동시 출고
}

/** 검증 완료된 전표 실행 계획 — planInventoryTransaction 산출물, applyInventoryTransaction 입력 */
export interface TxPlan {
  input: CreateTxInput
  qty: number
  itemId: number
  itemName: string
  isSerialManaged: boolean
  inventoryId: number
  srcWhName: string
  reasonId: number | null
  reasonValue: string | null
  componentPlans: { itemId: number; quantity: number; name: string; unit: string }[]
}

/**
 * 전표 입력 검증 → 실행 계획 생성 (쓰기 없음).
 * 인벤토리는 품목에서 파생 (품목이 인벤토리에 귀속) — 위치도 같은 인벤토리 소속이어야 한다.
 */
export async function planInventoryTransaction(input: CreateTxInput): Promise<TxPlan> {
  const qty = Math.trunc(input.quantity)
  if (!TX_TYPES.includes(input.txType)) throw new InventoryError('잘못된 전표 유형입니다.')
  if (!Number.isFinite(qty) || qty <= 0) throw new InventoryError('수량은 1 이상이어야 합니다.')

  const item = await prisma.inventoryItem.findUnique({ where: { id: input.itemId } })
  if (!item) throw new InventoryError('품목을 찾을 수 없습니다.', 404)
  const inventoryId = item.inventoryId // 인벤토리는 품목에서 파생

  const srcWh = await prisma.warehouse.findUnique({ where: { id: input.warehouseId } })
  if (!srcWh) throw new InventoryError('위치를 찾을 수 없습니다.', 404)
  if (srcWh.inventoryId !== inventoryId) throw new InventoryError('선택한 위치가 이 품목의 인벤토리에 속하지 않습니다.')

  // IN/OUT 유형(사유) 검증 — StatusCode 카테고리 일치, value로 시스템 동작 식별
  let reasonValue: string | null = null
  let reasonId: number | null = null
  if (input.txType === 'IN' || input.txType === 'OUT') {
    if (!input.reasonId) throw new InventoryError('입출고 유형을 선택하세요.')
    const reason = await prisma.statusCode.findUnique({ where: { id: input.reasonId } })
    if (!reason || reason.category !== REASON_CATEGORY[input.txType]) {
      throw new InventoryError('전표 유형에 맞지 않는 입출고 유형입니다.')
    }
    reasonValue = reason.value ?? null
    reasonId = reason.id
  }

  // 인벤토리 검증 (품목 소속 인벤토리)
  const inventory = await prisma.inventory.findUnique({ where: { id: inventoryId } })
  if (!inventory) throw new InventoryError('품목의 인벤토리를 찾을 수 없습니다.', 404)
  if (input.txType === 'IN' && !inventory.isActive) throw new InventoryError('비활성 인벤토리에는 입고할 수 없습니다.')

  if (input.txType === 'MOVE') {
    if (!input.toWarehouseId) throw new InventoryError('이동할 도착 위치를 선택하세요.')
    if (input.toWarehouseId === input.warehouseId) throw new InventoryError('출발 위치와 도착 위치가 같습니다.')
    const destWh = await prisma.warehouse.findUnique({ where: { id: input.toWarehouseId }, select: { id: true, inventoryId: true } })
    if (!destWh) throw new InventoryError('도착 위치를 찾을 수 없습니다.', 404)
    if (destWh.inventoryId !== inventoryId) throw new InventoryError('도착 위치가 이 품목의 인벤토리에 속하지 않습니다.')
  }

  if (input.hospitalCode) {
    // 병원 연결은 link_hospital 인벤토리(대웅제약재고) 출고에서만 허용
    if (input.txType !== 'OUT' || !inventory.linkHospital) {
      throw new InventoryError(`병원 연결은 '${inventory.name}'에서 지원하지 않습니다. (병원 연결 허용 인벤토리의 출고에서만 가능)`)
    }
    const h = await prisma.hospital.findUnique({ where: { hospitalCode: input.hospitalCode }, select: { hospitalCode: true } })
    if (!h) throw new InventoryError('연결할 병원을 찾을 수 없습니다.', 404)
  }

  // 세트출고(부자재 동시 출고) 검증 — OUT + 주자재 매핑 + 비시리얼 부자재만 (매핑은 같은 인벤토리 내에서만 생성됨)
  const componentPlans: { itemId: number; quantity: number; name: string; unit: string }[] = []
  const compInputs = (input.components ?? []).filter((c) => Math.trunc(c.quantity) > 0)
  if (compInputs.length > 0) {
    if (input.txType !== 'OUT') throw new InventoryError('부자재 동시 출고는 출고 전표에서만 가능합니다.')
    const mappings = await prisma.inventoryItemComponent.findMany({
      where: { parentItemId: input.itemId },
      include: { child: { select: { id: true, name: true, unit: true, isSerialManaged: true } } },
    })
    const byChild = new Map(mappings.map((m) => [m.childItemId, m]))
    for (const c of compInputs) {
      const m = byChild.get(c.itemId)
      if (!m) throw new InventoryError('주자재에 매핑되지 않은 부자재가 포함되어 있습니다.')
      if (m.child.isSerialManaged) {
        throw new InventoryError(`시리얼 관리 부자재(${m.child.name})는 세트출고 대상이 아닙니다. 개별 출고하세요.`)
      }
      componentPlans.push({ itemId: c.itemId, quantity: Math.trunc(c.quantity), name: m.child.name, unit: m.child.unit })
    }
  }

  return {
    input,
    qty,
    itemId: item.id,
    itemName: item.name,
    isSerialManaged: item.isSerialManaged,
    inventoryId,
    srcWhName: srcWh.name,
    reasonId,
    reasonValue,
    componentPlans,
  }
}

/**
 * 검증된 계획을 주어진 트랜잭션 클라이언트에서 실행 — 전표 생성 + 재고 스냅샷 + 시리얼 개체 + 세트출고 자식 전표.
 * 일괄 처리(bulk)에서 여러 계획을 한 트랜잭션에 묶을 수 있도록 분리.
 */
export async function applyInventoryTransaction(client: Tx, plan: TxPlan, actorId: string) {
  const { input, qty, inventoryId, reasonId, reasonValue, componentPlans } = plan
  const srcBucket: Bucket = { itemId: input.itemId, warehouseId: input.warehouseId, inventoryId }

  const txCode = await nextTxCode(client)

  // 1) 전표 생성
  const tx = await client.inventoryTransaction.create({
    data: {
      txCode,
      txType: input.txType,
      reasonId,
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      toWarehouseId: input.txType === 'MOVE' ? (input.toWarehouseId ?? null) : null,
      inventoryId,
      quantity: qty,
      destination: input.txType === 'OUT' ? (input.destination?.trim() || null) : null,
      hospitalCode: input.txType === 'OUT' ? (input.hospitalCode ?? null) : null,
      workType: input.txType === 'OUT' ? (input.workType ?? null) : null,
      refCode: input.txType === 'OUT' ? (input.refCode ?? null) : null,
      note: input.note?.trim() || null,
      actorId,
    },
  })

  // 2) 재고 스냅샷 증감 (버킷 단위)
  if (input.txType === 'IN') {
    await increaseStock(client, srcBucket, qty)
  } else if (input.txType === 'OUT') {
    await decreaseStock(client, srcBucket, qty, plan.srcWhName)
  } else {
    // MOVE: 같은 인벤토리 안에서 위치만 변경
    await decreaseStock(client, srcBucket, qty, plan.srcWhName)
    await increaseStock(client, { ...srcBucket, warehouseId: input.toWarehouseId! }, qty)
  }

  // 3) 시리얼 개체 처리
  if (plan.isSerialManaged) {
    await applySerialUnits(client, tx.id, input, plan.itemId, qty, reasonValue, inventoryId)
  }

  // 4) 세트출고 — 부자재 자식 전표 (같은 위치에서 차감, parent_tx_id 연결)
  for (const comp of componentPlans) {
    const childCode = await nextTxCode(client)
    await client.inventoryTransaction.create({
      data: {
        txCode: childCode,
        txType: 'OUT',
        reasonId,
        itemId: comp.itemId,
        warehouseId: input.warehouseId,
        inventoryId,
        quantity: comp.quantity,
        destination: input.destination?.trim() || null,
        hospitalCode: input.hospitalCode ?? null,
        workType: input.workType ?? null,
        refCode: input.refCode ?? null,
        note: `세트출고 (${plan.itemName} ${txCode})`,
        parentTxId: tx.id,
        actorId,
      },
    })
    await decreaseStock(
      client,
      { itemId: comp.itemId, warehouseId: input.warehouseId, inventoryId },
      comp.quantity,
      `부자재 ${comp.name} — ${plan.srcWhName}`,
    )
  }

  return client.inventoryTransaction.findUnique({
    where: { id: tx.id },
    include: {
      item: { select: { id: true, name: true, itemCode: true } },
      childTxs: { select: { id: true, txCode: true, itemId: true, quantity: true } },
    },
  })
}

/**
 * 입고/출고/이동 전표를 생성하고 재고 스냅샷·시리얼 개체를 한 트랜잭션에서 갱신한다.
 * - MOVE: 같은 인벤토리 안에서 물리 위치만 변경
 * - OUT + components: 주자재와 매핑된 부자재(같은 인벤토리)를 같은 위치에서 함께 출고 (자식 전표, parent_tx_id 연결)
 * 전표코드 동시 채번 충돌(P2002)은 재시도. 실패 시 InventoryError(4xx) 또는 롤백.
 */
export async function createInventoryTransaction(input: CreateTxInput, actorId: string) {
  const plan = await planInventoryTransaction(input)

  // 전표코드 P2002(동시 채번 충돌) 재시도
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction((client) => applyInventoryTransaction(client, plan, actorId))
    } catch (e) {
      const isTxCodeDup = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
      if (isTxCodeDup && attempt < 2) continue
      throw e
    }
  }
}

async function applySerialUnits(
  client: Tx,
  txId: number,
  input: CreateTxInput,
  itemId: number,
  qty: number,
  reasonValue: string | null,
  inventoryId: number,
) {
  const links = (unitIds: number[]) =>
    client.inventoryTransactionUnit.createMany({ data: unitIds.map((unitId) => ({ transactionId: txId, unitId })) })

  if (input.txType === 'IN') {
    const serials = (input.serials ?? []).map((s) => s.trim()).filter(Boolean)
    const uniq = new Set(serials)
    if (serials.length !== qty) throw new InventoryError(`시리얼 ${qty}개를 입력하세요. (현재 ${serials.length}개)`)
    if (uniq.size !== serials.length) throw new InventoryError('입력한 시리얼에 중복이 있습니다.')

    if (reasonValue === REASON_VALUE_RETURN) {
      // 회수(반품): 이 품목(=이 인벤토리)의 기존 OUT 개체를 IN_STOCK으로 복귀
      const existing = await client.inventoryUnit.findMany({ where: { itemId, serialNo: { in: serials } } })
      const map = new Map(existing.map((u) => [u.serialNo, u]))
      const unitIds: number[] = []
      for (const s of serials) {
        const u = map.get(s)
        if (!u) throw new InventoryError(`회수 대상 시리얼을 찾을 수 없습니다: ${s}`)
        if (u.status === 'IN_STOCK') throw new InventoryError(`이미 재고에 있는 시리얼입니다: ${s}`)
        unitIds.push(u.id)
      }
      // 동시성 가드: 상태 조건부 갱신 + 건수 검증 (경합 시 롤백)
      const res = await client.inventoryUnit.updateMany({
        where: { id: { in: unitIds }, status: { not: 'IN_STOCK' } },
        data: { status: 'IN_STOCK', warehouseId: input.warehouseId, hospitalCode: null },
      })
      if (res.count !== unitIds.length) throw new InventoryError('처리 중 개체 상태가 변경되었습니다. 다시 시도하세요.', 409)
      await links(unitIds)
    } else {
      // 신규 입고: 개체 생성 (같은 품목 내 시리얼 중복 금지, 품목의 인벤토리 기록)
      const dup = await client.inventoryUnit.findMany({ where: { itemId, serialNo: { in: serials } }, select: { serialNo: true } })
      if (dup.length > 0) throw new InventoryError(`이미 등록된 시리얼입니다: ${dup.map((d) => d.serialNo).join(', ')}`)
      const unitIds: number[] = []
      for (const s of serials) {
        const u = await client.inventoryUnit.create({
          data: { itemId, serialNo: s, status: 'IN_STOCK', warehouseId: input.warehouseId, inventoryId },
        })
        unitIds.push(u.id)
      }
      await links(unitIds)
    }
    return
  }

  // OUT / MOVE: 개체 지정 — 해당 위치의 IN_STOCK 개체만.
  // 지정 방식 2가지: ① unitIds(목록 선택) ② serials(시리얼 직접 입력·바코드 스캔 — 대량 처리용)
  let unitIds = input.unitIds ?? []
  if (unitIds.length === 0) {
    const serials = (input.serials ?? []).map((s) => s.trim()).filter(Boolean)
    const uniq = new Set(serials)
    if (uniq.size !== serials.length) throw new InventoryError('입력한 시리얼에 중복이 있습니다.')
    if (serials.length === 0) throw new InventoryError(`개체를 선택하거나 시리얼을 입력하세요.`)

    const found = await client.inventoryUnit.findMany({ where: { itemId, serialNo: { in: serials } } })
    const bySerial = new Map(found.map((u) => [u.serialNo, u]))
    const missing: string[] = []
    const notInBucket: string[] = []
    const resolved: number[] = []
    for (const s of serials) {
      const u = bySerial.get(s)
      if (!u) { missing.push(s); continue }
      if (u.status !== 'IN_STOCK' || u.warehouseId !== input.warehouseId) {
        notInBucket.push(s)
        continue
      }
      resolved.push(u.id)
    }
    if (missing.length > 0) throw new InventoryError(`등록되지 않은 시리얼입니다: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ` 외 ${missing.length - 10}건` : ''}`)
    if (notInBucket.length > 0) {
      throw new InventoryError(`해당 위치의 재고 상태가 아닌 시리얼입니다: ${notInBucket.slice(0, 10).join(', ')}${notInBucket.length > 10 ? ` 외 ${notInBucket.length - 10}건` : ''}`, 409)
    }
    unitIds = resolved
  }
  if (unitIds.length !== qty) throw new InventoryError(`개체 ${qty}개를 지정하세요. (현재 ${unitIds.length}개)`)

  const guard = {
    id: { in: unitIds },
    itemId,
    status: 'IN_STOCK',
    warehouseId: input.warehouseId,
  }

  let res: { count: number }
  if (input.txType === 'OUT') {
    const disposed = reasonValue === REASON_VALUE_DISPOSE
    // 동시성 가드: 위치·상태 조건을 갱신 where에 포함 + 건수 검증 (이중 출고 차단)
    res = await client.inventoryUnit.updateMany({
      where: guard,
      data: disposed
        ? { status: 'DISPOSED', warehouseId: null }
        : { status: 'OUT', warehouseId: null, hospitalCode: input.hospitalCode ?? null },
    })
  } else {
    // MOVE
    res = await client.inventoryUnit.updateMany({
      where: guard,
      data: { warehouseId: input.toWarehouseId! },
    })
  }
  if (res.count !== unitIds.length) {
    throw new InventoryError('선택한 개체 중 해당 위치의 재고 상태가 아닌 것이 있습니다. 목록을 새로고침 후 다시 시도하세요.', 409)
  }
  await links(unitIds)
}

type CancelableTx = Prisma.InventoryTransactionGetPayload<{
  include: {
    warehouse: { select: { name: true } }
    toWarehouse: { select: { name: true } }
    inventory: { select: { name: true } }
    toInventory: { select: { name: true } }
    reasonCode: { select: { value: true } }
    units: { select: { unitId: true } }
    item: { select: { isSerialManaged: true } }
  }
}>

/** 단일 전표의 재고·개체를 역방향으로 되돌린다 (취소 공용 — 세트출고 자식 포함). */
async function reverseTransaction(client: Tx, tx: CancelableTx) {
  const bucket: Bucket = { itemId: tx.itemId, warehouseId: tx.warehouseId, inventoryId: tx.inventoryId }

  // 1) 재고 역방향
  if (tx.txType === 'IN') {
    await decreaseStock(client, bucket, tx.quantity, tx.warehouse.name)
  } else if (tx.txType === 'OUT') {
    await increaseStock(client, bucket, tx.quantity)
  } else {
    // MOVE 취소: 도착 위치 → 출발 위치 복귀
    await decreaseStock(client, { ...bucket, warehouseId: tx.toWarehouseId! }, tx.quantity, tx.toWarehouse?.name ?? '도착지')
    await increaseStock(client, bucket, tx.quantity)
  }

  // 2) 시리얼 개체 원복 — 전부 조건부 갱신 + 건수 검증 (경합·후속 전표와 충돌 시 409 롤백)
  if (tx.item.isSerialManaged) {
    const unitIds = tx.units.map((u) => u.unitId)
    const reasonValue = tx.reasonCode?.value ?? null

    if (tx.txType === 'IN' && reasonValue === REASON_VALUE_RETURN) {
      // 회수 취소 → 다시 OUT (현재 IN_STOCK@입고위치·같은 인벤토리여야)
      const res = await client.inventoryUnit.updateMany({
        where: { id: { in: unitIds }, status: 'IN_STOCK', warehouseId: tx.warehouseId, inventoryId: tx.inventoryId },
        data: { status: 'OUT', warehouseId: null },
      })
      if (res.count !== unitIds.length) throw new InventoryError('개체가 이미 변경되어 취소할 수 없습니다.', 409)
    } else if (tx.txType === 'IN') {
      // 신규 입고 취소 → 개체 삭제 (현재 IN_STOCK@입고위치여야)
      const eligible = await client.inventoryUnit.count({
        where: { id: { in: unitIds }, status: 'IN_STOCK', warehouseId: tx.warehouseId, inventoryId: tx.inventoryId },
      })
      if (eligible !== unitIds.length) throw new InventoryError('개체가 이미 사용되어 취소할 수 없습니다.', 409)
      await client.inventoryTransactionUnit.deleteMany({ where: { transactionId: tx.id } })
      await client.inventoryUnit.deleteMany({ where: { id: { in: unitIds } } })
    } else if (tx.txType === 'OUT') {
      // 출고/폐기 취소 → IN_STOCK 복귀 @원위치 (현재 OUT/DISPOSED여야)
      const res = await client.inventoryUnit.updateMany({
        where: { id: { in: unitIds }, status: { in: ['OUT', 'DISPOSED'] }, inventoryId: tx.inventoryId },
        data: { status: 'IN_STOCK', warehouseId: tx.warehouseId, hospitalCode: null },
      })
      if (res.count !== unitIds.length) throw new InventoryError('개체가 이미 재입고되어 취소할 수 없습니다.', 409)
    } else {
      // MOVE 취소 → 출발지로 복귀 (현재 IN_STOCK@도착지여야)
      const res = await client.inventoryUnit.updateMany({
        where: { id: { in: unitIds }, status: 'IN_STOCK', warehouseId: tx.toWarehouseId!, inventoryId: tx.inventoryId },
        data: { warehouseId: tx.warehouseId },
      })
      if (res.count !== unitIds.length) throw new InventoryError('개체가 이미 이동되어 취소할 수 없습니다.', 409)
    }
  }
}

const cancelInclude = {
  warehouse: { select: { name: true } },
  toWarehouse: { select: { name: true } },
  inventory: { select: { name: true } },
  toInventory: { select: { name: true } },
  reasonCode: { select: { value: true } },
  units: { select: { unitId: true } },
  item: { select: { isSerialManaged: true } },
} satisfies Prisma.InventoryTransactionInclude

/**
 * 전표 취소 — 재고를 역방향으로 되돌리고 canceled_at 마킹 (역전표 미생성).
 * 세트출고 주자재 전표를 취소하면 연결된 부자재 자식 전표도 함께 취소된다.
 * function_wms.md §6-3. 되돌림이 음수를 만들거나 개체가 이미 변경됐으면 InventoryError(409).
 */
export async function cancelInventoryTransaction(transactionId: number, actorId: string) {
  const tx = await prisma.inventoryTransaction.findUnique({
    where: { id: transactionId },
    include: cancelInclude,
  })
  if (!tx) throw new InventoryError('전표를 찾을 수 없습니다.', 404)
  if (tx.canceledAt) throw new InventoryError('이미 취소된 전표입니다.', 409)
  if (tx.txType === 'TRANSFER') {
    throw new InventoryError('이관 기능 폐지로 과거 이관 전표는 취소할 수 없습니다. 필요 시 입고/출고 전표로 조정하세요.', 409)
  }

  // 세트출고 자식 전표 (미취소분) — 부모 취소 시 함께 취소
  const children = await prisma.inventoryTransaction.findMany({
    where: { parentTxId: tx.id, canceledAt: null },
    include: cancelInclude,
  })

  return prisma.$transaction(async (client) => {
    const now = new Date()
    for (const t of [tx, ...children]) {
      await reverseTransaction(client, t)
      await client.inventoryTransaction.update({
        where: { id: t.id },
        data: { canceledAt: now, canceledById: actorId },
      })
    }
    return client.inventoryTransaction.findUniqueOrThrow({
      where: { id: tx.id },
      include: { item: { select: { id: true, name: true, itemCode: true } }, childTxs: { select: { txCode: true } } },
    })
  })
}

// ─── 계층형 분류 헬퍼 (Phase 8, function_wms.md §4-9) ───

export interface CategoryNode {
  id: number
  name: string
  parentId: number | null
  sortOrder: number
}

/** 분류 노드의 깊이 (대=1, 중=2, 소=3) */
export function categoryDepth(all: CategoryNode[], id: number): number {
  const map = new Map(all.map((c) => [c.id, c]))
  let depth = 0
  let cur: CategoryNode | undefined = map.get(id)
  while (cur) {
    depth += 1
    if (depth > 10) break // 순환 안전장치
    cur = cur.parentId != null ? map.get(cur.parentId) : undefined
  }
  return depth
}

/** 분류 경로 라벨 (예: "전자제품 > 모니터") */
export function categoryPath(all: CategoryNode[], id: number | null): string {
  if (id == null) return ''
  const map = new Map(all.map((c) => [c.id, c]))
  const names: string[] = []
  let cur = map.get(id)
  let hop = 0
  while (cur && hop < 10) {
    names.unshift(cur.name)
    cur = cur.parentId != null ? map.get(cur.parentId) : undefined
    hop += 1
  }
  return names.join(' > ')
}

/** 해당 노드 + 모든 후손 id (분류 필터용) */
export function categoryWithDescendants(all: CategoryNode[], id: number): number[] {
  const childrenOf = new Map<number | null, CategoryNode[]>()
  for (const c of all) {
    const key = c.parentId
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key)!.push(c)
  }
  const out: number[] = []
  const queue = [id]
  while (queue.length) {
    const cur = queue.shift()!
    out.push(cur)
    for (const child of childrenOf.get(cur) ?? []) queue.push(child.id)
  }
  return out
}
