/**
 * 출고업무 P2 — 출고 처리 코어 (stock_out_request_design.md §13)
 *
 * previewFulfillment: 검증·라인 판정만 (쓰기 없음) — 화면의 품목별 [확인]과 실행 전 게이트가 공유.
 * executeFulfillment: 전량 일치(all-or-nothing) 원칙으로 WMS 전표(재고 차감·시리얼 개체 OUT) +
 * 기기현황 등록(웨어러블 시리얼 — source WMS·ref INVENTORY_TX) + 요청 상태 '완료'(티켓 CLOSED)를
 * **단일 트랜잭션**으로 수행한다.
 *
 * 창고는 입력받지 않는다 (2026-09-03 개정 — 출고유형→인벤토리만 구분):
 *  - 시리얼 품목: 개체의 실제 위치로 자동 그룹핑 (창고별 전표 분할)
 *  - LOT 품목: LOT 버킷(창고×LOT) 선택에 위치가 내장
 *  - 수량 품목: 재고 버킷에서 잔량 많은 순으로 자동 배분 (창고별 전표 분할)
 * 라인 모드는 WMS 품목의 관리 방식에서 파생 — 센서가 시리얼 품목으로 전환되면(별도 과제)
 * 코드 수정 없이 serial 경로를 탄다.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { planInventoryTransaction, applyInventoryTransaction, InventoryError, TxPlan } from '@/lib/inventory'
import { registerDevicesIn, findUnitsBySerial } from '@/lib/deviceRegistry'
import { normalizeSerial } from '@/lib/deviceRegistryShared'
import { syncStockOutToTicket } from '@/lib/ticket-domains/stockOut'
import { OUT_TYPE_META, isStockOutOutType, type StockOutOutType, type FulfillLineMode } from '@/lib/stockOutShared'

export class FulfillError extends Error {
  status: number
  payload?: Record<string, unknown>
  constructor(message: string, status = 400, payload?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.payload = payload
  }
}

export interface FulfillLineInput {
  itemId: number // stock_out_items.id
  serials?: string[] // 시리얼 품목 — 스캔/입력 (개수 = 요청 수량)
  lots?: { warehouseId: number; lotNo: string; quantity: number }[] // 비시리얼 LOT 품목 — 버킷(창고×LOT)별 차감 (합 = 요청 수량)
  serialsNote?: string | null // 과도기 시리얼 기록 (비시리얼 품목 — 개체 미생성, 원문 보존)
}

export interface FulfillInput {
  outType: StockOutOutType
  txDate?: string | null
  lines?: FulfillLineInput[]
}

export interface FulfillLinePreview {
  itemId: number
  name: string
  itemGroup: string
  quantity: number
  mode: FulfillLineMode
  wmsItemId: number | null
  wmsItemName: string | null
  isLotManaged: boolean
  /** 기기현황 등록 대상 (웨어러블 + WMS 시리얼 + device_info 모델 존재) */
  registry: boolean
  /** 재고 버킷(창고×LOT) — LOT 옵션·현재고 표시용 */
  buckets: { warehouseId: number; warehouseName: string; lotNo: string; quantity: number }[]
  /** 이 품목의 인벤토리 내 총 재고 (수량 모드 자동 배분 판정 기준) */
  stockTotal: number
  status: 'ok' | 'warning' | 'error' | 'pending' // pending = 입력 대기 (실행 불가)
  messages: string[]
}

export interface FulfillPreview {
  requestId: number
  sorCode: string
  outType: StockOutOutType
  usageInput: string
  inventory: { id: number; name: string; linkHospital: boolean } | null
  reasonName: string
  reasonId: number | null
  hospital: { hospitalCode: string; hospitalName: string } | null
  projectCode: string
  lines: FulfillLinePreview[]
  errors: string[] // 라인 외 전역 오류
  ok: boolean // 실행 가능 (전역 오류 없음 + 전 라인 ok/warning)
}

interface LoadedRequest {
  id: number
  sorCode: string
  statusId: number | null
  fulfilledAt: Date | null
  createdBy: { name: string } | null
  status: { ticketStatus: string | null } | null
  project: { projectCode: string; projectName: string; hospitalCode: string; hospital: { hospitalCode: string; hospitalName: string } | null }
  items: { id: number; itemId: number; quantity: number; item: { id: number; name: string; itemGroup: string; wmsModelName: string | null } }[]
}

async function loadRequest(requestId: number): Promise<LoadedRequest> {
  const req = await prisma.stockOutRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true, sorCode: true, statusId: true, fulfilledAt: true,
      createdBy: { select: { name: true } },
      status: { select: { ticketStatus: true } },
      project: {
        select: {
          projectCode: true, projectName: true, hospitalCode: true,
          hospital: { select: { hospitalCode: true, hospitalName: true } },
        },
      },
      items: {
        select: {
          id: true, itemId: true, quantity: true,
          item: { select: { id: true, name: true, itemGroup: true, wmsModelName: true } },
        },
        orderBy: { id: 'asc' },
      },
    },
  })
  if (!req) throw new FulfillError('출고요청을 찾을 수 없습니다.', 404)
  if (req.fulfilledAt) throw new FulfillError('이미 출고 처리된 요청입니다.', 409)
  const ts = req.status?.ticketStatus
  if (ts === 'RESOLVED' || ts === 'CLOSED') throw new FulfillError('종결(완료·취소) 상태의 요청은 처리할 수 없습니다.', 409)
  if (req.items.length === 0) throw new FulfillError('요청에 품목 라인이 없습니다.', 400)
  return req as LoadedRequest
}

/** 검증·라인 판정 (쓰기 없음). 입력이 불완전한 라인은 'pending' — 실행은 전 라인 ok/warning일 때만. */
export async function previewFulfillment(requestId: number, input: FulfillInput): Promise<FulfillPreview> {
  if (!isStockOutOutType(input.outType)) throw new FulfillError('출고유형이 올바르지 않습니다.', 400)
  const meta = OUT_TYPE_META[input.outType]
  const req = await loadRequest(requestId)
  const errors: string[] = []

  // 인벤토리·전표 유형 해석 (시드 고정 이름) — 창고는 자동 결정이라 입력받지 않는다
  const inventory = await prisma.inventory.findFirst({
    where: { name: meta.inventoryName },
    select: { id: true, name: true, linkHospital: true, isActive: true },
  })
  if (!inventory) errors.push(`인벤토리 '${meta.inventoryName}'를 찾을 수 없습니다.`)
  else if (!inventory.isActive) errors.push(`인벤토리 '${meta.inventoryName}'가 비활성 상태입니다.`)

  const reason = await prisma.statusCode.findFirst({
    where: { category: 'STOCK_OUT_TYPE', name: meta.reasonName },
    select: { id: true },
  })
  if (!reason) errors.push(`WMS 출고 유형 '${meta.reasonName}'이(가) 없습니다. 설정 > 입출고 유형 관리를 확인하세요.`)

  const linesInput = new Map<number, FulfillLineInput>()
  for (const l of input.lines ?? []) {
    if (linesInput.has(l.itemId)) errors.push('같은 품목 라인이 중복 전달되었습니다.')
    linesInput.set(l.itemId, l)
  }

  const lines: FulfillLinePreview[] = []
  for (const line of req.items) {
    const p: FulfillLinePreview = {
      itemId: line.itemId,
      name: line.item.name,
      itemGroup: line.item.itemGroup,
      quantity: line.quantity,
      mode: 'missing',
      wmsItemId: null,
      wmsItemName: null,
      isLotManaged: false,
      registry: false,
      buckets: [],
      stockTotal: 0,
      status: 'pending',
      messages: [],
    }
    lines.push(p)
    const err = (m: string) => { p.status = 'error'; p.messages.push(m) }
    const warn = (m: string) => { if (p.status !== 'error') p.status = 'warning'; p.messages.push(m) }

    if (!inventory) { err('인벤토리 없음'); continue }
    if (!line.item.wmsModelName) { err('WMS 품목 매핑이 없습니다. 설정 > 출고 품목 관리에서 모델명을 지정하세요.'); continue }

    // 품목 해석 — (인벤토리, model_name)
    const wmsItems = await prisma.inventoryItem.findMany({
      where: { inventoryId: inventory.id, modelName: line.item.wmsModelName, isActive: true },
      select: { id: true, name: true, isSerialManaged: true, isLotManaged: true },
    })
    if (wmsItems.length === 0) { err(`'${inventory.name}'에 재고 품목이 없습니다. (모델 ${line.item.wmsModelName}) — 처리 불가`); continue }
    if (wmsItems.length > 1) { err(`'${inventory.name}'에 같은 모델 품목이 ${wmsItems.length}건 있어 매칭할 수 없습니다.`); continue }
    const wms = wmsItems[0]
    p.wmsItemId = wms.id
    p.wmsItemName = wms.name
    p.isLotManaged = wms.isLotManaged
    p.mode = wms.isSerialManaged ? 'serial' : wms.isLotManaged ? 'lot' : 'qty'

    // 기기현황 등록 대상 — 웨어러블 + WMS 시리얼 + device_info 시리얼 추적 모델 (MGW1010은 SYSTEM 그룹이라 제외)
    if (p.mode === 'serial' && line.item.itemGroup === 'WEARABLE') {
      const di = await prisma.deviceInfo.findFirst({
        where: { deviceModel: line.item.wmsModelName, serialTracked: true, isActive: true },
        select: { id: true },
      })
      p.registry = !!di
    }

    // 재고 버킷 (창고×LOT — LOT 옵션·현재고 표시·수량 자동 배분 기준)
    const buckets = await prisma.inventoryStock.findMany({
      where: { itemId: wms.id, quantity: { gt: 0 } },
      include: { warehouse: { select: { name: true } } },
      orderBy: [{ warehouseId: 'asc' }, { lotNo: 'asc' }],
    })
    p.buckets = buckets.map((b) => ({ warehouseId: b.warehouseId, warehouseName: b.warehouse.name, lotNo: b.lotNo, quantity: b.quantity }))
    p.stockTotal = p.buckets.reduce((s, b) => s + b.quantity, 0)

    const li = linesInput.get(line.itemId)

    if (p.mode === 'serial') {
      const serials = (li?.serials ?? []).map((s) => s.trim()).filter(Boolean)
      if (serials.length === 0) { p.messages.push(`시리얼 ${line.quantity}개 입력 대기`); continue } // pending
      const uniq = new Set(serials)
      if (uniq.size !== serials.length) err('입력한 시리얼에 중복이 있습니다.')
      if (serials.length !== line.quantity) err(`시리얼 수가 요청 수량과 다릅니다. (입력 ${serials.length} / 요청 ${line.quantity} — 전량 처리 원칙)`)
      // WMS 개체 검증 — 인벤토리 내 IN_STOCK이면 위치 무관 (창고는 실행 시 개체 위치로 자동 그룹핑)
      const units = await prisma.inventoryUnit.findMany({
        where: { itemId: wms.id, serialNo: { in: serials } },
        select: { serialNo: true, status: true },
      })
      const bySerial = new Map(units.map((u) => [u.serialNo, u]))
      for (const s of serials) {
        const u = bySerial.get(s)
        if (!u) err(`${s}: '${inventory.name}'에 등록되지 않은 시리얼입니다.`)
        else if (u.status !== 'IN_STOCK') err(`${s}: 재고 상태가 아닙니다. (현재 ${u.status === 'OUT' ? '출고됨' : '폐기됨'})`)
      }
      // 기기현황 충돌 검증 (타 병원 배치 중 → 진행 불가, 같은 병원 → 등록 생략 경고)
      if (p.registry) {
        const normalized = serials.map((s) => normalizeSerial(s).serialNo).filter(Boolean)
        const found = await findUnitsBySerial(prisma, normalized)
        for (const s of serials) {
          const ns = normalizeSerial(s).serialNo
          const hit = ns ? found.get(ns) : undefined
          const dev = hit?.device
          if (dev && dev.status === 'ACTIVE') {
            if (dev.hospitalCode && dev.hospitalCode !== req.project.hospitalCode) {
              err(`${s}: 다른 병원에서 사용 중인 기기입니다. (기기 현황 확인 필요 — 진행 불가)`)
            } else {
              warn(`${s}: 이미 이 병원에 배치된 기기 — 기기현황 등록은 생략됩니다.`)
            }
          }
        }
      }
    } else if (p.mode === 'lot') {
      const lots = (li?.lots ?? []).filter((l) => l.lotNo !== undefined)
      if (lots.length === 0) { p.messages.push(`LOT별 수량 입력 대기 (요청 ${line.quantity})`); continue }
      const seen = new Set<string>()
      let sum = 0
      for (const l of lots) {
        const q = Math.trunc(l.quantity)
        const key = `${l.warehouseId} ${l.lotNo}`
        if (!Number.isInteger(q) || q <= 0) { err('LOT 수량은 1 이상의 정수여야 합니다.'); continue }
        if (seen.has(key)) { err(`LOT '${l.lotNo || '(없음)'}'이 중복 입력되었습니다.`); continue }
        seen.add(key)
        sum += q
        const b = p.buckets.find((x) => x.warehouseId === l.warehouseId && x.lotNo === l.lotNo)
        if (!b) err(`LOT '${l.lotNo || '(없음)'}' 재고 버킷을 찾을 수 없습니다.`)
        else if (b.quantity < q) err(`LOT '${l.lotNo || '(없음)'}' 재고 부족 (현재 ${b.quantity}, 요청 ${q})`)
      }
      if (sum !== line.quantity) err(`LOT 수량 합이 요청 수량과 다릅니다. (합 ${sum} / 요청 ${line.quantity} — 전량 처리 원칙)`)
    } else {
      // qty — 수량 고정, 재고 총량 확인 (실행 시 잔량 많은 버킷부터 자동 배분)
      const total = p.buckets.filter((b) => b.lotNo === '').reduce((s, b) => s + b.quantity, 0)
      if (total < line.quantity) {
        err(`재고 부족 (현재 ${total}, 요청 ${line.quantity}) — 출고 불가`)
      } else {
        p.messages.push(`재고 ${total}개 — 잔량 많은 위치부터 자동 차감`)
      }
    }
    if (p.status === 'pending') p.status = 'ok'
  }

  const ok = errors.length === 0 && lines.every((l) => l.status === 'ok' || l.status === 'warning')
  return {
    requestId: req.id,
    sorCode: req.sorCode,
    outType: input.outType,
    usageInput: meta.usageInput,
    inventory: inventory ? { id: inventory.id, name: inventory.name, linkHospital: inventory.linkHospital } : null,
    reasonName: meta.reasonName,
    reasonId: reason?.id ?? null,
    hospital: req.project.hospital,
    projectCode: req.project.projectCode,
    lines,
    errors,
    ok,
  }
}

export interface FulfillResult {
  txCodes: string[]
  registered: number
  registrySkipped: number
  warnings: string[]
}

/** 출고 실행 — 전량 일치·단일 트랜잭션. 실패 시 전부 롤백. */
export async function executeFulfillment(
  requestId: number,
  input: FulfillInput,
  actor: { userId: string; name: string }
): Promise<FulfillResult> {
  const preview = await previewFulfillment(requestId, input)
  if (!preview.ok) {
    throw new FulfillError('검증을 통과하지 못한 라인이 있어 출고할 수 없습니다.', 400, { preview })
  }
  const req = await loadRequest(requestId)
  const meta = OUT_TYPE_META[input.outType]
  const hospitalName = req.project.hospital?.hospitalName ?? req.project.projectName
  const requester = req.createdBy?.name ?? req.sorCode
  const linesInput = new Map((input.lines ?? []).map((l) => [l.itemId, l]))

  const doneStatus = await prisma.statusCode.findFirst({
    where: { category: 'STOCK_OUT_STATUS', name: '완료' },
    select: { id: true },
  })
  if (!doneStatus) throw new FulfillError("STOCK_OUT_STATUS '완료' 상태가 없습니다. seed-stock-out-masters.sql을 적용하세요.", 500)

  // 전표 계획 (쓰기 없음 — bulk-serial 패턴: 계획은 밖에서, 적용은 단일 트랜잭션)
  interface PlannedLine {
    reqItemId: number
    plans: TxPlan[]
    serials: string[] // serial 모드 원문 (기록·기기현황 등록)
    registry: boolean
    serialsNote: string | null
  }
  const planned: PlannedLine[] = []
  const base = {
    txType: 'OUT' as const,
    reasonId: preview.reasonId!,
    destination: hospitalName.slice(0, 100),
    requester: requester.slice(0, 100),
    hospitalCode: preview.inventory!.linkHospital ? req.project.hospitalCode : null,
    workType: 'PROJECT',
    refCode: req.project.projectCode,
    txDate: input.txDate ?? null,
  }
  for (const line of req.items) {
    const p = preview.lines.find((x) => x.itemId === line.itemId)!
    const li = linesInput.get(line.itemId)
    const note = `출고요청 ${req.sorCode} 처리`
    const plans: TxPlan[] = []
    let serials: string[] = []
    if (p.mode === 'serial') {
      // 창고 자동 — 개체의 실제 위치로 그룹핑 (창고별 전표 분할)
      serials = (li?.serials ?? []).map((s) => s.trim()).filter(Boolean)
      const units = await prisma.inventoryUnit.findMany({
        where: { itemId: p.wmsItemId!, serialNo: { in: serials } },
        select: { serialNo: true, warehouseId: true },
      })
      const byWh = new Map<number, string[]>()
      for (const u of units) {
        if (u.warehouseId == null) throw new FulfillError(`${u.serialNo}: 개체 위치가 없습니다.`, 409)
        const arr = byWh.get(u.warehouseId) ?? []
        arr.push(u.serialNo)
        byWh.set(u.warehouseId, arr)
      }
      for (const [whId, group] of Array.from(byWh.entries())) {
        plans.push(await planInventoryTransaction({ ...base, itemId: p.wmsItemId!, warehouseId: whId, quantity: group.length, serials: group, note }))
      }
    } else if (p.mode === 'lot') {
      for (const l of li?.lots ?? []) {
        plans.push(await planInventoryTransaction({ ...base, itemId: p.wmsItemId!, warehouseId: l.warehouseId, quantity: Math.trunc(l.quantity), lotNo: l.lotNo, note }))
      }
    } else {
      // qty — 잔량 많은 버킷부터 자동 배분 (창고별 전표 분할)
      let remain = line.quantity
      const buckets = p.buckets.filter((b) => b.lotNo === '').sort((a, b) => b.quantity - a.quantity)
      for (const b of buckets) {
        if (remain <= 0) break
        const take = Math.min(remain, b.quantity)
        plans.push(await planInventoryTransaction({ ...base, itemId: p.wmsItemId!, warehouseId: b.warehouseId, quantity: take, note }))
        remain -= take
      }
      if (remain > 0) throw new FulfillError(`${line.item.name}: 재고가 부족합니다.`, 409)
    }
    const noteSerials = p.mode === 'serial' ? serials.join('\n') : (li?.serialsNote ?? '').trim().slice(0, 4000) || null
    planned.push({ reqItemId: line.id, plans, serials, registry: p.registry, serialsNote: noteSerials })
  }

  // 실행 — 전표코드 P2002 재시도 (계획 재사용)
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (client) => {
          const txCodes: string[] = []
          let registered = 0
          let registrySkipped = 0
          const warnings: string[] = []

          for (const pl of planned) {
            let firstTxCode: string | null = null
            for (const plan of pl.plans) {
              const tx = await applyInventoryTransaction(client, plan, actor.userId)
              await client.inventoryTransaction.update({ where: { id: tx!.id }, data: { stockOutRequestId: req.id } })
              txCodes.push(tx!.txCode)
              if (!firstTxCode) firstTxCode = tx!.txCode
            }
            // 기기현황 등록 (웨어러블 시리얼 — 같은 트랜잭션, source WMS·ref INVENTORY_TX)
            if (pl.registry && pl.serials.length > 0) {
              const line = req.items.find((x) => x.id === pl.reqItemId)!
              const result = await registerDevicesIn(
                client,
                {
                  hospitalCode: req.project.hospitalCode,
                  actor: { userId: actor.userId, name: actor.name },
                  source: 'WMS',
                  ref: firstTxCode ? { type: 'INVENTORY_TX', code: firstTxCode } : null,
                  memo: `출고요청 ${req.sorCode} 출고`,
                },
                pl.serials.map((s) => ({ serialInput: s, modelInput: line.item.wmsModelName, usageTypeInput: meta.usageInput }))
              )
              registered += result.created.length + result.reregistered.length + result.transferred.length
              registrySkipped += result.skipped.length
              for (const w of result.warnings) warnings.push(w)
            }
            // 시리얼 기록 (serial 모드 = 실제 출고 시리얼 / lot·qty 모드 = 과도기 수기 기록)
            if (pl.serialsNote) {
              await client.stockOutRequestItem.update({ where: { id: pl.reqItemId }, data: { fulfilledSerials: pl.serialsNote } })
            }
          }

          // 요청 처리 스탬프 + 상태 '완료' → 티켓 CLOSED (어댑터 동기화)
          await client.stockOutRequest.update({
            where: { id: req.id },
            data: {
              fulfilledAt: new Date(),
              fulfilledById: actor.userId,
              statusId: doneStatus.id,
              statusChangedAt: new Date(),
              resolvedAt: new Date(),
            },
          })
          await syncStockOutToTicket(client, req.id, actor.userId)

          return { txCodes, registered, registrySkipped, warnings }
        },
        { timeout: 120_000, maxWait: 10_000 }
      )
    } catch (e) {
      const isTxCodeDup = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
      if (isTxCodeDup && attempt < 2) continue
      if (e instanceof InventoryError) throw new FulfillError(e.message, e.status)
      throw e
    }
  }
}
