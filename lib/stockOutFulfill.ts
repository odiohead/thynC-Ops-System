/**
 * 출고업무 — 출고 처리 코어 (stock_out_request_design.md §13 · v2 stock_out_v2_design.md §5)
 *
 * previewFulfillment: 검증·라인 판정만 (쓰기 없음) — 화면의 품목별 [확인]과 실행 전 게이트가 공유.
 * executeFulfillment: 전량 일치(all-or-nothing) 원칙으로 WMS 전표(재고 차감·시리얼 개체 OUT) +
 * 기기현황 등록(시리얼 추적 기기 — source WMS·ref INVENTORY_TX) + 요청 상태 '완료'(티켓 CLOSED)를
 * **단일 트랜잭션**으로 수행한다.
 *
 * v2 (2026-11-01): 출고유형 입력 폐기 — 요청 라인이 자재관리 품목(인벤토리×품목 행)을 직접 가리키므로
 *  - 인벤토리 = 라인 품목의 inventory (한 요청에 여러 인벤토리 가능 → 인벤토리별 전표 분리)
 *  - 전표 유형·기기 용도 = 인벤토리명 매핑(INVENTORY_OUT_META)
 *  - 기기현황 등록 대상 = 품목에 연결된 device_info가 시리얼 추적(serialTracked)인 시리얼 품목
 * 창고는 입력받지 않는다 (2026-09-03 개정):
 *  - 시리얼 품목: 개체의 실제 위치로 자동 그룹핑 (창고별 전표 분할)
 *  - LOT 품목: LOT 버킷(창고×LOT) 선택에 위치가 내장
 *  - 수량 품목: 재고 버킷에서 잔량 많은 순으로 자동 배분 (창고별 전표 분할)
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { planInventoryTransaction, applyInventoryTransaction, InventoryError, TxPlan } from '@/lib/inventory'
import { registerDevicesIn, findUnitsBySerial } from '@/lib/deviceRegistry'
import { normalizeSerial } from '@/lib/deviceRegistryShared'
import { syncStockOutToTicket } from '@/lib/ticket-domains/stockOut'
import { outMetaForInventory, stockOutTitle, type FulfillLineMode } from '@/lib/stockOutShared'
import { resolveAsLinesIn, AsServiceError } from '@/lib/asReceiptService' // 분실 AS 연동 — 출고 실행 시 라인 교체 확정 (2026-11-10)
import { asDeviceGroupOf, appendAsNote, isValidAsSerial, AS_SERIAL_RULE_TEXT, type AsDeviceGroup } from '@/lib/asReceiptShared'

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
  inventoryItemId: number // inventory_items.id (요청 라인 식별)
  serials?: string[] // 시리얼 품목 — 스캔/입력 (개수 = 요청 수량)
  lots?: { warehouseId: number; lotNo: string; quantity: number }[] // 비시리얼 LOT 품목 — 버킷(창고×LOT)별 차감 (합 = 요청 수량)
  serialsNote?: string | null // 과도기 시리얼 기록 (비시리얼 품목 — 개체 미생성, 원문 보존)
}

export interface FulfillInput {
  txDate?: string | null
  lines?: FulfillLineInput[]
  /** 분실 AS 연동 요청(AS 모드) — 접수 라인별 출고 본체 시리얼 1개 (2026-11-10, as_lost_stock_out_link_design.md §5.3) */
  asLines?: { asItemId: number; serial: string }[]
  /** AS 모드 — 센서류·부자재 추가 라인(판매용 노출 품목, 본체 제외). 출고 실행 시 요청 품목으로 기록 */
  extraLines?: (FulfillLineInput & { quantity: number })[]
}

/** AS 모드 — 접수 라인별 판정 */
export interface AsLinePreview {
  asItemId: number
  lostSerialNo: string
  deviceGroup: AsDeviceGroup
  deviceName: string | null
  wardName: string | null
  serial: string | null
  /** 시리얼이 가리키는 판매용 품목명 (판정 성공 시) */
  itemName: string | null
  status: 'ok' | 'error' | 'pending'
  messages: string[]
}
/** AS 모드 — 센서류·부자재로 고를 수 있는 판매용 노출 품목 */
export interface ExtraCatalogItem {
  inventoryItemId: number
  name: string
  modelName: string | null
  inventoryName: string
  categoryName: string | null
  mode: 'serial' | 'lot' | 'qty'
  buckets: { warehouseId: number; warehouseName: string; lotNo: string; quantity: number }[]
  stockTotal: number
}

export interface FulfillLinePreview {
  inventoryItemId: number
  name: string
  modelName: string | null
  inventoryId: number
  inventoryName: string
  categoryName: string | null
  quantity: number
  mode: FulfillLineMode
  isLotManaged: boolean
  /** 기기현황 등록 대상 (시리얼 품목 + device_info 시리얼 추적) */
  registry: boolean
  /** 재고 버킷(창고×LOT) — LOT 옵션·현재고 표시용 */
  buckets: { warehouseId: number; warehouseName: string; lotNo: string; quantity: number }[]
  /** 이 품목의 인벤토리 내 총 재고 (수량 모드 자동 배분 판정 기준) */
  stockTotal: number
  status: 'ok' | 'warning' | 'error' | 'pending' // pending = 입력 대기 (실행 불가)
  messages: string[]
}

export interface FulfillInventoryPreview {
  id: number
  name: string
  linkHospital: boolean
  reasonName: string
  reasonId: number | null
  usageInput: string
}

export interface FulfillPreview {
  requestId: number
  sorCode: string
  purpose: string
  /** 분실 AS 연동 요청이면 접수·라인 판정 (2026-11-10) */
  asLink?: { receipt: { id: number; asCode: string; hospitalName: string | null }; lines: AsLinePreview[] } | null
  extraCatalog?: ExtraCatalogItem[]
  /** AS 모드 — 본체 시리얼이 결정한 품목 id (화면이 일반 라인 목록에서 숨김) */
  asBodyItemIds?: number[]
  /** 라인이 속한 인벤토리(중복 제거) — 전표는 인벤토리별로 분리 */
  inventories: FulfillInventoryPreview[]
  hospital: { hospitalCode: string; hospitalName: string } | null
  /** 프로젝트 요청만 — 영업 유형(평가용·판매용·오산영업소)은 null */
  projectCode: string | null
  /** 출고처 표시명 (병원명·프로젝트명 또는 영업 유형 납품처) */
  destinationLabel: string
  lines: FulfillLinePreview[]
  errors: string[] // 라인 외 전역 오류
  ok: boolean // 실행 가능 (전역 오류 없음 + 전 라인 ok/warning)
}

interface LoadedLine {
  id: number
  inventoryItemId: number
  quantity: number
  item: {
    id: number; name: string; modelName: string | null; isActive: boolean; isSerialManaged: boolean; isLotManaged: boolean
    inventory: { id: number; name: string; linkHospital: boolean; isActive: boolean }
    category: { name: string } | null
    deviceInfo: { id: number; deviceModel: string; serialTracked: boolean; isActive: boolean } | null
  }
}

interface LoadedRequest {
  id: number
  sorCode: string
  purpose: string
  statusId: number | null
  fulfilledAt: Date | null
  createdBy: { name: string } | null
  status: { ticketStatus: string | null } | null
  subPurpose: string | null
  destType: string | null
  destText: string | null
  destHospital: { hospitalCode: string; hospitalName: string } | null
  project: { projectCode: string; projectName: string; hospitalCode: string; hospital: { hospitalCode: string; hospitalName: string } | null } | null
  items: LoadedLine[]
  /** 분실 AS 연동 (2026-11-10) */
  asReceiptId: number | null
  asReceipt: { id: number; asCode: string; hospitalCode: string; hospital: { hospitalName: string } | null } | null
  asItems: { id: number; serialNo: string; outcome: string | null; deviceKind: string | null; wardName: string | null; device: { deviceInfo: { deviceName: string } | null } | null }[]
}

/**
 * 출고 대상 — 프로젝트 요청은 프로젝트 병원, 영업 유형은 납품처(병원이면 병원, 기타면 병원 없음).
 * hospital이 null이면 기기현황 등록은 생략(배치 병원이 없음)하고 전표 출고처는 납품처 텍스트.
 */
function targetOf(req: LoadedRequest) {
  const hospital = req.project ? req.project.hospital : req.destHospital
  return {
    hospital,
    hospitalCode: req.project?.hospitalCode ?? req.destHospital?.hospitalCode ?? null,
    destination: req.project?.hospital?.hospitalName ?? req.destHospital?.hospitalName ?? stockOutTitle(req),
    workType: req.project ? 'PROJECT' : null,
    refCode: req.project?.projectCode ?? null,
  }
}

async function loadRequest(requestId: number): Promise<LoadedRequest> {
  const req = await prisma.stockOutRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true, sorCode: true, purpose: true, statusId: true, fulfilledAt: true,
      subPurpose: true, destType: true, destText: true,
      asReceiptId: true,
      asReceipt: { select: { id: true, asCode: true, hospitalCode: true, hospital: { select: { hospitalName: true } } } },
      asItems: { select: { id: true, serialNo: true, outcome: true, deviceKind: true, wardName: true, device: { select: { deviceInfo: { select: { deviceName: true } } } } }, orderBy: { id: 'asc' } },
      destHospital: { select: { hospitalCode: true, hospitalName: true } },
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
          id: true, inventoryItemId: true, quantity: true,
          item: {
            select: {
              id: true, name: true, modelName: true, isActive: true, isSerialManaged: true, isLotManaged: true,
              inventory: { select: { id: true, name: true, linkHospital: true, isActive: true } },
              category: { select: { name: true } },
              deviceInfo: { select: { id: true, deviceModel: true, serialTracked: true, isActive: true } },
            },
          },
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

/** 라인들이 속한 인벤토리(중복 제거) + 전표 유형 해석 */
async function resolveInventories(req: LoadedRequest, errors: string[]): Promise<Map<number, FulfillInventoryPreview>> {
  const map = new Map<number, FulfillInventoryPreview>()
  for (const line of req.items) {
    const inv = line.item.inventory
    if (map.has(inv.id)) continue
    const meta = outMetaForInventory(inv.name)
    const reason = await prisma.statusCode.findFirst({ where: { category: 'STOCK_OUT_TYPE', name: meta.reasonName }, select: { id: true } })
    if (!inv.isActive) errors.push(`인벤토리 '${inv.name}'가 비활성 상태입니다.`)
    if (!reason) errors.push(`WMS 출고 유형 '${meta.reasonName}'이(가) 없습니다. 설정 > 입출고 유형 관리를 확인하세요.`)
    map.set(inv.id, { id: inv.id, name: inv.name, linkHospital: inv.linkHospital, reasonName: meta.reasonName, reasonId: reason?.id ?? null, usageInput: meta.usageInput })
  }
  return map
}

/** 검증·라인 판정 (쓰기 없음). 입력이 불완전한 라인은 'pending' — 실행은 전 라인 ok/warning일 때만. AS 모드는 `prepareFulfillment`가 가상 라인을 만들어 넘긴다 */
async function previewCore(req: LoadedRequest, input: FulfillInput): Promise<FulfillPreview> {
  const target = targetOf(req)
  const errors: string[] = []
  const inventories = await resolveInventories(req, errors)

  const linesInput = new Map<number, FulfillLineInput>()
  for (const l of input.lines ?? []) {
    if (linesInput.has(l.inventoryItemId)) errors.push('같은 품목 라인이 중복 전달되었습니다.')
    linesInput.set(l.inventoryItemId, l)
  }

  const lines: FulfillLinePreview[] = []
  for (const line of req.items) {
    const wms = line.item
    const inv = inventories.get(wms.inventory.id)!
    const p: FulfillLinePreview = {
      inventoryItemId: line.inventoryItemId,
      name: wms.name,
      modelName: wms.modelName,
      inventoryId: wms.inventory.id,
      inventoryName: wms.inventory.name,
      categoryName: wms.category?.name ?? null,
      quantity: line.quantity,
      mode: 'missing',
      isLotManaged: wms.isLotManaged,
      registry: false,
      buckets: [],
      stockTotal: 0,
      status: 'pending',
      messages: [],
    }
    lines.push(p)
    const err = (m: string) => { p.status = 'error'; p.messages.push(m) }
    const warn = (m: string) => { if (p.status !== 'error') p.status = 'warning'; p.messages.push(m) }

    if (!wms.inventory.isActive || !inv.reasonId) { err('인벤토리 또는 전표 유형을 해석할 수 없습니다.'); continue }
    if (!wms.isActive) { err(`'${wms.name}'은(는) 자재관리에서 비활성 품목입니다. — 처리 불가`); continue }
    p.mode = wms.isSerialManaged ? 'serial' : wms.isLotManaged ? 'lot' : 'qty'

    // 기기현황 등록 대상 — 시리얼 품목 + 연결된 device_info가 시리얼 추적 (MGW1010은 device_info 미연결이라 제외)
    // 배치 병원이 없는 출고(영업 유형 납품처 '기타')는 등록 생략
    if (p.mode === 'serial' && wms.deviceInfo?.serialTracked && wms.deviceInfo.isActive && target.hospitalCode) p.registry = true

    // 재고 버킷 (창고×LOT — LOT 옵션·현재고 표시·수량 자동 배분 기준)
    const buckets = await prisma.inventoryStock.findMany({
      where: { itemId: wms.id, quantity: { gt: 0 } },
      include: { warehouse: { select: { name: true } } },
      orderBy: [{ warehouseId: 'asc' }, { lotNo: 'asc' }],
    })
    p.buckets = buckets.map((b) => ({ warehouseId: b.warehouseId, warehouseName: b.warehouse.name, lotNo: b.lotNo, quantity: b.quantity }))
    p.stockTotal = p.buckets.reduce((s, b) => s + b.quantity, 0)

    const li = linesInput.get(line.inventoryItemId)

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
        if (!u) err(`${s}: '${wms.inventory.name}'의 '${wms.name}'에 등록되지 않은 시리얼입니다.`)
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
            if (dev.hospitalCode && dev.hospitalCode !== target.hospitalCode) {
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
    purpose: req.purpose,
    inventories: Array.from(inventories.values()),
    hospital: target.hospital,
    projectCode: req.project?.projectCode ?? null,
    destinationLabel: target.destination,
    lines,
    errors,
    ok,
  }
}

// ── 분실 AS 연동(AS 모드) — projects/as_lost_stock_out_link_design.md §5 (2026-11-10) ──────────────
// 요청 품목은 자리표시일 뿐이다. 자재담당자가 접수 라인마다 입력한 **출고 본체 시리얼**이 품목을 결정하고(D2 — 같은 기기군이면 모델 무관),
// 센서류·부자재는 판매용 노출 품목에서 추가한다. 가상 라인으로 기존 판정·전표 엔진을 그대로 태우고, 실행 시 요청 품목을 가상 라인으로 덮어쓴다.

const LINE_ITEM_SELECT = {
  id: true, name: true, modelName: true, isActive: true, isSerialManaged: true, isLotManaged: true,
  inventory: { select: { id: true, name: true, linkHospital: true, isActive: true } },
  category: { select: { name: true } },
  deviceInfo: { select: { id: true, deviceModel: true, deviceName: true, serialTracked: true, isActive: true } },
} as const

/** 판매용 노출·활성 품목 where (본체·센서 공통) */
const SALES_EXPOSED_WHERE: Prisma.InventoryItemWhereInput = { isActive: true, stockOutPurposes: { some: { purpose: 'SALES' } }, inventory: { isActive: true } }
const isBodyItem = (it: { isSerialManaged: boolean; deviceInfo: { serialTracked: boolean; isActive: boolean } | null }) => it.isSerialManaged && !!it.deviceInfo?.serialTracked && it.deviceInfo.isActive

interface AsPrep {
  req: LoadedRequest
  input: FulfillInput
  asLink: NonNullable<FulfillPreview['asLink']>
  extraCatalog: ExtraCatalogItem[]
  ok: boolean
  errors: string[]
  /** asItemId → 출고 시리얼(판정 통과분) */
  asMap: { asItemId: number; serial: string; inventoryItemId: number }[]
  bodyItemIds: Set<number>
}

async function buildAsMode(req: LoadedRequest, input: FulfillInput): Promise<AsPrep> {
  const errors: string[] = []
  const receipt = req.asReceipt!
  const openItems = req.asItems.filter((i) => !i.outcome)
  if (!openItems.length) errors.push('이 출고요청에 묶인 미종결 AS 라인이 없습니다 (이미 처리됐거나 잠금이 해제됨).')
  const inputBy = new Map<number, string>()
  for (const l of input.asLines ?? []) if (Number.isInteger(l.asItemId)) inputBy.set(l.asItemId, (l.serial ?? '').trim().toUpperCase())
  const seen = new Map<string, number>()
  const linePreviews: AsLinePreview[] = []
  const asMap: AsPrep['asMap'] = []
  const bodyBuckets = new Map<number, string[]>()
  for (const it of openItems) {
    const group = asDeviceGroupOf(it.device?.deviceInfo?.deviceName ?? null, it.deviceKind, it.serialNo)
    const lp: AsLinePreview = { asItemId: it.id, lostSerialNo: it.serialNo, deviceGroup: group, deviceName: it.device?.deviceInfo?.deviceName ?? it.deviceKind ?? null, wardName: it.wardName, serial: inputBy.get(it.id) || null, itemName: null, status: 'pending', messages: [] }
    linePreviews.push(lp)
    const err = (m: string) => { lp.status = 'error'; lp.messages.push(m) }
    const serial = lp.serial
    if (!serial) { lp.messages.push('출고 시리얼 입력 대기'); continue }
    if (!isValidAsSerial(serial)) { err(`시리얼 형식 오류 (${AS_SERIAL_RULE_TEXT})`); continue }
    if (seen.has(serial)) { err('같은 시리얼이 다른 라인에도 입력됐습니다'); continue }
    seen.set(serial, it.id)
    if (serial === it.serialNo) { err('분실 기기와 같은 시리얼입니다'); continue }
    const unit = await prisma.inventoryUnit.findFirst({
      where: { serialNo: serial, item: { ...SALES_EXPOSED_WHERE, isSerialManaged: true, deviceInfo: { serialTracked: true, isActive: true } } },
      select: { status: true, itemId: true, item: { select: { name: true, deviceInfo: { select: { deviceName: true } } } } },
    })
    if (!unit) { err('판매용 재고(노출 품목)의 본체 시리얼이 아닙니다'); continue }
    if (unit.status !== 'IN_STOCK') { err(`재고 상태가 아닙니다 (현재 ${unit.status === 'OUT' ? '출고됨' : '폐기됨'})`); continue }
    const itemGroup = asDeviceGroupOf(unit.item.deviceInfo?.deviceName ?? null, null, serial)
    if (itemGroup !== group) { err(`기기군이 다릅니다 — 접수 기기 ${group}, 입력 시리얼은 ${itemGroup} 품목(${unit.item.name})`); continue }
    const found = await findUnitsBySerial(prisma, [serial])
    const dev = found.get(serial)?.device
    if (dev && dev.status === 'ACTIVE' && dev.hospitalCode && dev.hospitalCode !== receipt.hospitalCode) { err('다른 병원에서 사용 중인 기기입니다 (기기현황 확인)'); continue }
    lp.itemName = unit.item.name
    lp.status = 'ok'
    asMap.push({ asItemId: it.id, serial, inventoryItemId: unit.itemId })
    bodyBuckets.set(unit.itemId, [...(bodyBuckets.get(unit.itemId) ?? []), serial])
  }

  // 센서류·부자재 — 판매용 노출 중 본체 제외
  const exposed = await prisma.inventoryItem.findMany({ where: SALES_EXPOSED_WHERE, select: LINE_ITEM_SELECT, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })
  const extraItems = exposed.filter((it) => !isBodyItem(it))
  const extraCatalog: ExtraCatalogItem[] = []
  for (const it of extraItems) {
    const buckets = await prisma.inventoryStock.findMany({ where: { itemId: it.id, quantity: { gt: 0 } }, include: { warehouse: { select: { name: true } } }, orderBy: [{ warehouseId: 'asc' }, { lotNo: 'asc' }] })
    const bs = buckets.map((b) => ({ warehouseId: b.warehouseId, warehouseName: b.warehouse.name, lotNo: b.lotNo, quantity: b.quantity }))
    extraCatalog.push({ inventoryItemId: it.id, name: it.name, modelName: it.modelName, inventoryName: it.inventory.name, categoryName: it.category?.name ?? null, mode: it.isSerialManaged ? 'serial' : it.isLotManaged ? 'lot' : 'qty', buckets: bs, stockTotal: bs.reduce((a, b) => a + b.quantity, 0) })
  }
  const extraById = new Map(extraItems.map((it) => [it.id, it]))
  const extraInputs: (FulfillLineInput & { quantity: number })[] = []
  const seenExtra = new Set<number>()
  for (const e of input.extraLines ?? []) {
    if (!Number.isInteger(e.inventoryItemId)) continue
    const it = extraById.get(e.inventoryItemId)
    if (!it) { errors.push(`품목 #${e.inventoryItemId}: 판매용 노출 센서류·부자재 품목이 아닙니다`); continue }
    if (seenExtra.has(e.inventoryItemId)) { errors.push(`${it.name}: 같은 품목이 중복 추가됐습니다`); continue }
    const q = Math.trunc(Number(e.quantity))
    if (!Number.isInteger(q) || q <= 0) { errors.push(`${it.name}: 수량은 1 이상의 정수여야 합니다`); continue }
    seenExtra.add(e.inventoryItemId)
    extraInputs.push({ ...e, quantity: q })
  }

  // 가상 라인 (본체: 시리얼이 결정한 품목×개수 / 센서류: 입력 수량)
  const bodyItemIds = new Set(Array.from(bodyBuckets.keys()))
  const neededIds = Array.from(new Set([...Array.from(bodyBuckets.keys()), ...extraInputs.map((e) => e.inventoryItemId)]))
  const rows = neededIds.length ? await prisma.inventoryItem.findMany({ where: { id: { in: neededIds } }, select: LINE_ITEM_SELECT }) : []
  const rowBy = new Map(rows.map((r) => [r.id, r]))
  const virtualItems: LoadedLine[] = []
  const lines: FulfillLineInput[] = []
  for (const [itemId, serials] of Array.from(bodyBuckets.entries())) {
    const row = rowBy.get(itemId)!
    virtualItems.push({ id: 0, inventoryItemId: itemId, quantity: serials.length, item: row })
    lines.push({ inventoryItemId: itemId, serials })
  }
  for (const e of extraInputs) {
    const row = rowBy.get(e.inventoryItemId)!
    virtualItems.push({ id: 0, inventoryItemId: e.inventoryItemId, quantity: e.quantity, item: row })
    lines.push({ inventoryItemId: e.inventoryItemId, serials: e.serials, lots: e.lots, serialsNote: e.serialsNote })
  }
  const allBodyOk = openItems.length > 0 && linePreviews.every((l) => l.status === 'ok')
  return {
    req: { ...req, items: virtualItems },
    input: { txDate: input.txDate, lines },
    asLink: { receipt: { id: receipt.id, asCode: receipt.asCode, hospitalName: receipt.hospital?.hospitalName ?? null }, lines: linePreviews },
    extraCatalog, ok: allBodyOk && errors.length === 0, errors, asMap, bodyItemIds,
  }
}

interface Prepared { req: LoadedRequest; input: FulfillInput; preview: FulfillPreview; asPrep: AsPrep | null }

/** 요청 로드 → (AS 모드면 가상 라인 구성) → 판정. preview·execute 공용 */
async function prepareFulfillment(requestId: number, input: FulfillInput): Promise<Prepared> {
  const loaded = await loadRequest(requestId)
  if (!loaded.asReceiptId || !loaded.asReceipt) {
    const preview = await previewCore(loaded, input)
    return { req: loaded, input, preview, asPrep: null }
  }
  const asPrep = await buildAsMode(loaded, input)
  const preview = await previewCore(asPrep.req, asPrep.input)
  preview.asLink = asPrep.asLink
  preview.extraCatalog = asPrep.extraCatalog
  preview.asBodyItemIds = Array.from(asPrep.bodyItemIds)
  preview.errors.push(...asPrep.errors)
  preview.ok = preview.ok && asPrep.ok
  return { req: asPrep.req, input: asPrep.input, preview, asPrep }
}

export async function previewFulfillment(requestId: number, input: FulfillInput): Promise<FulfillPreview> {
  return (await prepareFulfillment(requestId, input)).preview
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
  const prepared = await prepareFulfillment(requestId, input)
  const preview = prepared.preview
  if (!preview.ok) {
    throw new FulfillError('검증을 통과하지 못한 라인이 있어 출고할 수 없습니다.', 400, { preview })
  }
  const req = prepared.req // AS 모드면 가상 라인(시리얼이 결정한 품목·센서류)
  input = prepared.input
  const asPrep = prepared.asPrep
  const invMeta = new Map(preview.inventories.map((i) => [i.id, i]))
  const target = targetOf(req)
  const hospitalName = target.destination
  const requester = req.createdBy?.name ?? req.sorCode
  const linesInput = new Map((input.lines ?? []).map((l) => [l.inventoryItemId, l]))

  const doneStatus = await prisma.statusCode.findFirst({
    where: { category: 'STOCK_OUT_STATUS', name: '완료' },
    select: { id: true },
  })
  if (!doneStatus) throw new FulfillError("STOCK_OUT_STATUS '완료' 상태가 없습니다. seed-stock-out-masters.sql을 적용하세요.", 500)

  // 전표 계획 (쓰기 없음 — bulk-serial 패턴: 계획은 밖에서, 적용은 단일 트랜잭션)
  interface PlannedLine {
    reqItemId: number
    inventoryItemId: number
    plans: TxPlan[]
    serials: string[] // serial 모드 원문 (기록·기기현황 등록)
    registry: boolean
    usageInput: string
    modelInput: string | null
    serialsNote: string | null
  }
  const planned: PlannedLine[] = []
  for (const line of req.items) {
    const p = preview.lines.find((x) => x.inventoryItemId === line.inventoryItemId)!
    const inv = invMeta.get(p.inventoryId)!
    const li = linesInput.get(line.inventoryItemId)
    const note = `출고요청 ${req.sorCode} 처리`
    // 전표 공통 — 인벤토리별 전표 유형·병원 연결 (인벤토리가 섞이면 자연히 전표가 분리됨)
    const base = {
      txType: 'OUT' as const,
      reasonId: inv.reasonId!,
      destination: hospitalName.slice(0, 100),
      requester: requester.slice(0, 100),
      hospitalCode: inv.linkHospital ? target.hospitalCode : null,
      workType: target.workType,
      refCode: target.refCode,
      txDate: input.txDate ?? null,
    }
    const plans: TxPlan[] = []
    let serials: string[] = []
    if (p.mode === 'serial') {
      // 창고 자동 — 개체의 실제 위치로 그룹핑 (창고별 전표 분할)
      serials = (li?.serials ?? []).map((s) => s.trim()).filter(Boolean)
      const units = await prisma.inventoryUnit.findMany({
        where: { itemId: line.inventoryItemId, serialNo: { in: serials } },
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
        plans.push(await planInventoryTransaction({ ...base, itemId: line.inventoryItemId, warehouseId: whId, quantity: group.length, serials: group, note }))
      }
    } else if (p.mode === 'lot') {
      for (const l of li?.lots ?? []) {
        plans.push(await planInventoryTransaction({ ...base, itemId: line.inventoryItemId, warehouseId: l.warehouseId, quantity: Math.trunc(l.quantity), lotNo: l.lotNo, note }))
      }
    } else {
      // qty — 잔량 많은 버킷부터 자동 배분 (창고별 전표 분할)
      let remain = line.quantity
      const buckets = p.buckets.filter((b) => b.lotNo === '').sort((a, b) => b.quantity - a.quantity)
      for (const b of buckets) {
        if (remain <= 0) break
        const take = Math.min(remain, b.quantity)
        plans.push(await planInventoryTransaction({ ...base, itemId: line.inventoryItemId, warehouseId: b.warehouseId, quantity: take, note }))
        remain -= take
      }
      if (remain > 0) throw new FulfillError(`${line.item.name}: 재고가 부족합니다.`, 409)
    }
    const noteSerials = p.mode === 'serial' ? serials.join('\n') : (li?.serialsNote ?? '').trim().slice(0, 4000) || null
    planned.push({
      reqItemId: line.id, inventoryItemId: line.inventoryItemId, plans, serials, registry: p.registry, usageInput: inv.usageInput,
      modelInput: line.item.deviceInfo?.deviceModel ?? line.item.modelName, serialsNote: noteSerials,
    })
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

          // AS 모드 — 자리표시 품목을 실제 출고 라인(본체 시리얼 품목 + 센서류)으로 덮어쓴다 (2026-11-10)
          if (asPrep) {
            await client.stockOutRequestItem.deleteMany({ where: { requestId: req.id } })
            await client.stockOutRequestItem.createMany({ data: req.items.map((l) => ({ requestId: req.id, inventoryItemId: l.inventoryItemId, quantity: l.quantity })) })
          }

          for (const pl of planned) {
            let firstTxCode: string | null = null
            for (const plan of pl.plans) {
              const tx = await applyInventoryTransaction(client, plan, actor.userId)
              await client.inventoryTransaction.update({ where: { id: tx!.id }, data: { stockOutRequestId: req.id } })
              txCodes.push(tx!.txCode)
              if (!firstTxCode) firstTxCode = tx!.txCode
            }
            // 기기현황 등록 (시리얼 추적 기기 — 같은 트랜잭션, source WMS·ref INVENTORY_TX). AS 모드 본체는 아래 AS 교체 확정(replaceDevice)이 등록·구기기 회수를 담당
            if (pl.registry && pl.serials.length > 0 && !(asPrep && asPrep.bodyItemIds.has(pl.inventoryItemId))) {
              const result = await registerDevicesIn(
                client,
                {
                  hospitalCode: target.hospitalCode!,
                  actor: { userId: actor.userId, name: actor.name },
                  source: 'WMS',
                  ref: firstTxCode ? { type: 'INVENTORY_TX', code: firstTxCode } : null,
                  memo: `출고요청 ${req.sorCode} 출고`,
                },
                pl.serials.map((s) => ({ serialInput: s, modelInput: pl.modelInput, usageTypeInput: pl.usageInput }))
              )
              registered += result.created.length + result.reregistered.length + result.transferred.length
              registrySkipped += result.skipped.length
              for (const w of result.warnings) warnings.push(w)
            }
            // 시리얼 기록 (serial 모드 = 실제 출고 시리얼 / lot·qty 모드 = 과도기 수기 기록)
            if (pl.serialsNote) {
              await client.stockOutRequestItem.updateMany({ where: { requestId: req.id, inventoryItemId: pl.inventoryItemId }, data: { fulfilledSerials: pl.serialsNote } })
            }
          }

          // AS 모드 — 분실 라인 교체 확정 (같은 트랜잭션): 구기기 RECOVER(분실)·새 기기 REGISTER(관련 기기·계약건 승계)·라인 교체기/발송일 기록·'발송완료' 자동 전이
          if (asPrep && req.asReceiptId) {
            const txDate = input.txDate ?? null
            try {
              const r = await resolveAsLinesIn(client, req.asReceiptId, { userId: actor.userId, name: actor.name }, {
                lines: asPrep.asMap.map((m) => ({ itemId: m.asItemId, outcome: 'REPLACE' as const, newSerial: m.serial, processNote: `출고요청 ${req.sorCode} 출고` })),
                effectiveDate: txDate, shipMethod: 'PARCEL',
              }, { viaStockOutRequestId: req.id })
              warnings.push(...r.warnings)
            } catch (e) {
              if (e instanceof AsServiceError) throw new FulfillError(`AS 라인 교체 확정 실패 — ${e.message}`, e.status)
              throw e
            }
            const rc = await client.asReceipt.findUnique({ where: { id: req.asReceiptId }, select: { note: true } })
            const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
            const extras = req.items.filter((l) => !asPrep.bodyItemIds.has(l.inventoryItemId)).map((l) => `${l.item.name} ${l.quantity}개`)
            await client.asReceipt.update({ where: { id: req.asReceiptId }, data: { note: appendAsNote(rc?.note ?? null, `[출고 완료 ${today} ${actor.name}] ${req.sorCode} — ${asPrep.asMap.map((m) => `${req.asItems.find((i) => i.id === m.asItemId)?.serialNo ?? m.asItemId}→${m.serial}`).join(', ')}${extras.length ? ` · ${extras.join(', ')}` : ''}`) } })
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
