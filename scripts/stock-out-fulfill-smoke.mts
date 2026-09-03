/**
 * 출고업무 P2 — 출고 처리 스모크 (stock_out_request_design.md §13.5)
 *
 * 자체 테스트 데이터(임시 창고·가짜 시리얼 A9871xx·SMKLOT)로 판매용재고에서 검증:
 *  preview — 모드 판정(serial/lot)·재고 품목 없음(시스템@판매용)·전량 불일치·미등록 시리얼·LOT 합 불일치·타 병원 배치 차단
 *  execute — 전표 생성(링크·workType PROJECT)·재고 차감·개체 OUT·기기현황 등록(용도 판매용·source WMS·ref INVENTORY_TX)·
 *            fulfilledSerials 기록·요청 완료·티켓 CLOSED·이중 처리 409
 * 테스트 데이터는 전부 삭제한다 (재고·개체·전표·창고·요청·티켓·기기현황).
 *
 *   npx tsx scripts/stock-out-fulfill-smoke.mts
 */
import { PrismaClient } from '@prisma/client'
import { planInventoryTransaction, applyInventoryTransaction } from '../lib/inventory'
import { previewFulfillment, executeFulfillment, FulfillError } from '../lib/stockOutFulfill'
import { createTicketForStockOut } from '../lib/ticket-domains/stockOut'
import { registerDevicesIn } from '../lib/deviceRegistry/write'
import { nextSorCode } from '../lib/stockOut'

const prisma = new PrismaClient()

let pass = 0
let fail = 0
function check(name: string, ok: boolean, note?: string) {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${note ? ` — ${note}` : ''}`) }
}

const S1 = 'A987101'
const S2 = 'A987102'
const SERIALS = [S1, S2]

async function cleanupAll(ctx: { warehouseId?: number; requestIds: number[]; ticketIds: number[] }) {
  // 기기현황 (이벤트 → 배치 → 유닛)
  const units = await prisma.deviceUnit.findMany({ where: { serialNo: { in: SERIALS } }, select: { id: true } })
  const unitIds = units.map((u) => u.id)
  if (unitIds.length) {
    await prisma.hospitalDeviceEvent.deleteMany({ where: { deviceId: { in: unitIds } } }).catch(() => {})
    await prisma.hospitalDevice.deleteMany({ where: { deviceId: { in: unitIds } } }).catch(() => {})
    await prisma.deviceUnit.deleteMany({ where: { id: { in: unitIds } } }).catch(() => {})
  }
  // WMS (전표유닛 → 전표 → 개체 → 재고버킷 → 창고)
  if (ctx.warehouseId) {
    const txs = await prisma.inventoryTransaction.findMany({ where: { warehouseId: ctx.warehouseId }, select: { id: true } })
    const txIds = txs.map((t) => t.id)
    if (txIds.length) {
      await prisma.inventoryTransactionUnit.deleteMany({ where: { transactionId: { in: txIds } } }).catch(() => {})
      await prisma.udiLedgerCheck.deleteMany({ where: { transactionId: { in: txIds } } }).catch(() => {})
      await prisma.inventoryTransaction.deleteMany({ where: { id: { in: txIds } } }).catch(() => {})
    }
    await prisma.inventoryUnit.deleteMany({ where: { serialNo: { startsWith: 'A9871' } } }).catch(() => {})
    await prisma.inventoryStock.deleteMany({ where: { warehouseId: ctx.warehouseId } }).catch(() => {})
    await prisma.warehouse.deleteMany({ where: { id: ctx.warehouseId } }).catch(() => {})
  }
  // 요청·티켓
  if (ctx.requestIds.length) await prisma.stockOutRequest.deleteMany({ where: { id: { in: ctx.requestIds } } }).catch(() => {})
  if (ctx.ticketIds.length) await prisma.ticket.deleteMany({ where: { id: { in: ctx.ticketIds } } }).catch(() => {})
}

async function main() {
  const ctx: { warehouseId?: number; requestIds: number[]; ticketIds: number[] } = { requestIds: [], ticketIds: [] }
  try {
    // ── 셋업 ─────────────────────────────────────────────────
    console.log('▶ 셋업 — 판매용재고 임시 창고·재고')
    const inv = await prisma.inventory.findFirst({ where: { name: '판매용재고' } })
    if (!inv) throw new Error('판매용재고 인벤토리 없음')
    const ecgItem = await prisma.inventoryItem.findFirst({ where: { inventoryId: inv.id, modelName: 'MC200M-T', isActive: true } })
    const sensorItem = await prisma.inventoryItem.findFirst({ where: { inventoryId: inv.id, modelName: 'MP1000F', isActive: true } })
    if (!ecgItem || !sensorItem) throw new Error('판매용재고에 MC200M-T/MP1000F 품목 없음')
    check('WMS 품목 매칭 (시리얼·LOT)', ecgItem.isSerialManaged && !sensorItem.isSerialManaged && sensorItem.isLotManaged)

    const wh = await prisma.warehouse.create({ data: { name: `SMOKE-P2-${Date.now() % 100000}`, inventoryId: inv.id } })
    ctx.warehouseId = wh.id
    const inReason = (await prisma.statusCode.findFirst({ where: { category: 'STOCK_IN_TYPE', name: '구매' } }))
      ?? (await prisma.statusCode.findFirst({ where: { category: 'STOCK_IN_TYPE', value: null }, orderBy: { order: 'asc' } }))
    if (!inReason) throw new Error('STOCK_IN_TYPE 없음')
    const anyUser = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true, name: true } })
    if (!anyUser) throw new Error('사용자 없음')

    // 입고: 심전계 시리얼 2 + 센서 LOT 5
    const inPlan1 = await planInventoryTransaction({
      txType: 'IN', reasonId: inReason.id, itemId: ecgItem.id, warehouseId: wh.id, quantity: 2,
      serials: SERIALS, lotBySerial: { [S1]: 'SMKLOT', [S2]: 'SMKLOT' },
    })
    const inPlan2 = await planInventoryTransaction({
      txType: 'IN', reasonId: inReason.id, itemId: sensorItem.id, warehouseId: wh.id, quantity: 5, lotNo: 'SMKLOT1',
    })
    await prisma.$transaction(async (c) => {
      await applyInventoryTransaction(c, inPlan1, anyUser.id)
      await applyInventoryTransaction(c, inPlan2, anyUser.id)
    })
    check('테스트 재고 입고 (심전계 2·센서 LOT 5)', true)

    // 요청 R1 (심전계 2 + MP1000F 3) — 프로젝트·티켓
    const project = await prisma.project.findFirst({
      select: { projectCode: true, projectName: true, hospitalCode: true },
      orderBy: { id: 'asc' },
    })
    if (!project) throw new Error('프로젝트 없음')
    const soEcg = await prisma.stockOutItem.findFirst({ where: { wmsModelName: 'MC200M-T' } })
    const soSensor = await prisma.stockOutItem.findFirst({ where: { wmsModelName: 'MP1000F' } })
    const soSystem = await prisma.stockOutItem.findFirst({ where: { wmsModelName: 'thynC시스템10' } })
    if (!soEcg || !soSensor || !soSystem) throw new Error('출고 품목 마스터 매핑 누락')
    const reqStatus = await prisma.statusCode.findFirst({ where: { category: 'STOCK_OUT_STATUS', name: '요청' } })

    async function makeRequest(items: { itemId: number; quantity: number }[]) {
      const r = await prisma.stockOutRequest.create({
        data: { sorCode: await nextSorCode(), projectCode: project!.projectCode, statusId: reqStatus?.id ?? null, requestDate: new Date(), createdById: anyUser!.id },
      })
      ctx.requestIds.push(r.id)
      await prisma.stockOutRequestItem.createMany({ data: items.map((i) => ({ requestId: r.id, ...i })) })
      const tid = await prisma.$transaction((tx) =>
        createTicketForStockOut(tx, {
          id: r.id, sorCode: r.sorCode, projectName: project!.projectName, hospitalCode: project!.hospitalCode,
          statusName: '요청', statusId: r.statusId, note: null, requestDate: r.requestDate, resolvedAt: null, createdAt: r.createdAt,
        }, anyUser!.id, 'domain')
      )
      ctx.ticketIds.push(tid)
      return r
    }
    const r1 = await makeRequest([{ itemId: soEcg.id, quantity: 2 }, { itemId: soSensor.id, quantity: 3 }])
    const r2 = await makeRequest([{ itemId: soSystem.id, quantity: 1 }])

    // ── preview ──────────────────────────────────────────────
    console.log('▶ preview — 모드 판정·검증')
    let pv = await previewFulfillment(r1.id, { outType: 'SELF_SALE' })
    const lEcg = pv.lines.find((l) => l.itemId === soEcg.id)!
    const lSen = pv.lines.find((l) => l.itemId === soSensor.id)!
    check('모드 판정 serial/lot + 기기현황 대상', lEcg.mode === 'serial' && lEcg.registry && lSen.mode === 'lot' && !lSen.registry)
    check('재고 버킷에 임시 창고 포함', lSen.buckets.some((b) => b.warehouseId === wh.id && b.lotNo === 'SMKLOT1'))
    check('입력 대기 = pending·실행 불가', lEcg.status === 'pending' && !pv.ok)

    const pv2 = await previewFulfillment(r2.id, { outType: 'SELF_SALE', lines: [{ itemId: soSystem.id }] })
    check("시스템@판매용 → '재고 품목 없음' 오류", pv2.lines[0].status === 'error' && pv2.lines[0].mode === 'missing')

    pv = await previewFulfillment(r1.id, {
      outType: 'SELF_SALE',
      lines: [{ itemId: soEcg.id, serials: [S1] }, { itemId: soSensor.id, lots: [{ warehouseId: wh.id, lotNo: 'SMKLOT1', quantity: 2 }] }],
    })
    check('전량 불일치(시리얼 1/2·LOT 합 2/3) → 오류', pv.lines.every((l) => l.status === 'error') && !pv.ok)

    pv = await previewFulfillment(r1.id, {
      outType: 'SELF_SALE',
      lines: [{ itemId: soEcg.id, serials: [S1, S1] }, { itemId: soSensor.id, lots: [{ warehouseId: wh.id, lotNo: 'SMKLOT1', quantity: 3 }] }],
    })
    check('중복 시리얼 → 오류', pv.lines.find((l) => l.itemId === soEcg.id)!.messages.some((m) => m.includes('중복')))

    pv = await previewFulfillment(r1.id, {
      outType: 'SELF_SALE',
      lines: [{ itemId: soEcg.id, serials: [S1, 'A999999'] }, { itemId: soSensor.id, lots: [{ warehouseId: wh.id, lotNo: 'SMKLOT1', quantity: 3 }] }],
    })
    check('미등록 시리얼 → 오류', pv.lines.find((l) => l.itemId === soEcg.id)!.status === 'error')
    check('LOT 합 일치 라인은 통과', pv.lines.find((l) => l.itemId === soSensor.id)!.status === 'ok')

    // 타 병원 배치 차단 — S2를 다른 병원에 등록
    const otherHospital = await prisma.hospital.findFirst({
      where: { hospitalCode: { not: project.hospitalCode } },
      select: { hospitalCode: true },
    })
    if (!otherHospital) throw new Error('다른 병원 없음')
    await prisma.$transaction((tx) =>
      registerDevicesIn(tx, { hospitalCode: otherHospital.hospitalCode, actor: { userId: anyUser.id, name: 'SMOKE' }, source: 'MANUAL' },
        [{ serialInput: S2, modelInput: 'MC200M-T' }])
    )
    pv = await previewFulfillment(r1.id, {
      outType: 'SELF_SALE',
      lines: [{ itemId: soEcg.id, serials: SERIALS }, { itemId: soSensor.id, lots: [{ warehouseId: wh.id, lotNo: 'SMKLOT1', quantity: 3 }] }],
    })
    check('타 병원 배치 중 시리얼 → 진행 불가', pv.lines.find((l) => l.itemId === soEcg.id)!.status === 'error' && !pv.ok)
    // 차단 해제 (테스트 배치 제거)
    const s2unit = await prisma.deviceUnit.findFirst({ where: { serialNo: S2 }, select: { id: true } })
    if (s2unit) {
      await prisma.hospitalDeviceEvent.deleteMany({ where: { deviceId: s2unit.id } })
      await prisma.hospitalDevice.deleteMany({ where: { deviceId: s2unit.id } })
      await prisma.deviceUnit.delete({ where: { id: s2unit.id } })
    }

    // ── execute ──────────────────────────────────────────────
    console.log('▶ execute — 전량 처리')
    const goodInput = {
      outType: 'SELF_SALE' as const,
      lines: [
        { itemId: soEcg.id, serials: SERIALS },
        { itemId: soSensor.id, lots: [{ warehouseId: wh.id, lotNo: 'SMKLOT1', quantity: 3 }], serialsNote: 'SN-A\nSN-B\nSN-C' },
      ],
    }
    const result = await executeFulfillment(r1.id, goodInput, { userId: anyUser.id, name: anyUser.name })
    check('전표 2건 생성(창고 자동) + 기기 2대 등록', result.txCodes.length === 2 && result.registered === 2, JSON.stringify(result))

    const txs = await prisma.inventoryTransaction.findMany({ where: { stockOutRequestId: r1.id }, include: { units: true } })
    check('전표 링크·workType PROJECT·refCode', txs.length === 2 && txs.every((t) => t.workType === 'PROJECT' && t.refCode === project.projectCode))
    const ecgTx = txs.find((t) => t.itemId === ecgItem.id)
    check('시리얼 전표 개체 2건 연결', ecgTx?.units.length === 2)

    const stockEcg = await prisma.inventoryStock.findFirst({ where: { itemId: ecgItem.id, warehouseId: wh.id, lotNo: '' } })
    const stockSen = await prisma.inventoryStock.findFirst({ where: { itemId: sensorItem.id, warehouseId: wh.id, lotNo: 'SMKLOT1' } })
    check('재고 차감 (심전계 2→0·센서 5→2)', (stockEcg?.quantity ?? -1) === 0 && stockSen?.quantity === 2)
    const outUnits = await prisma.inventoryUnit.findMany({ where: { serialNo: { in: SERIALS } } })
    check('WMS 개체 OUT + 병원 미기록(비대웅)', outUnits.length === 2 && outUnits.every((u) => u.status === 'OUT'))

    // 기기현황
    const regUnits = await prisma.deviceUnit.findMany({
      where: { serialNo: { in: SERIALS } },
      include: { usageType: { select: { value: true } }, placement: { select: { hospitalCode: true, status: true } } },
    })
    check('기기현황 등록 — 프로젝트 병원 ACTIVE·용도 판매용',
      regUnits.length === 2 && regUnits.every((u) => u.usageType?.value === 'SALE' && u.placement?.status === 'ACTIVE' && u.placement?.hospitalCode === project.hospitalCode),
      JSON.stringify(regUnits.map((u) => ({ s: u.serialNo, p: u.placement }))))
    const regEvents = await prisma.hospitalDeviceEvent.findMany({ where: { device: { serialNo: { in: SERIALS } }, eventType: 'REGISTER' } })
    check('REGISTER 이벤트 source WMS·ref INVENTORY_TX',
      regEvents.length === 2 && regEvents.every((e) => e.source === 'WMS' && e.refType === 'INVENTORY_TX' && !!e.refCode))

    const r1After = await prisma.stockOutRequest.findUnique({
      where: { id: r1.id },
      include: { status: true, ticket: { select: { status: true } }, items: true },
    })
    check("요청 완료 스탬프·상태 '완료'", !!r1After?.fulfilledAt && r1After?.fulfilledById === anyUser.id && r1After?.status?.name === '완료' && !!r1After?.resolvedAt)
    check('티켓 CLOSED (완료 → 직행)', r1After?.ticket?.status === 'CLOSED')
    const lineEcg = r1After!.items.find((i) => i.itemId === soEcg.id)!
    const lineSen = r1After!.items.find((i) => i.itemId === soSensor.id)!
    check('fulfilledSerials 기록 (실출고·과도기 수기)', lineEcg.fulfilledSerials === SERIALS.join('\n') && lineSen.fulfilledSerials === 'SN-A\nSN-B\nSN-C')

    // 이중 처리
    let dup = false
    try { await executeFulfillment(r1.id, goodInput, { userId: anyUser.id, name: anyUser.name }) } catch (e) {
      dup = e instanceof FulfillError && e.status === 409
    }
    check('이중 처리 409', dup)
  } finally {
    console.log('▶ 정리')
    await cleanupAll(ctx)
    // 원상복구 확인
    const leftUnits = await prisma.inventoryUnit.count({ where: { serialNo: { startsWith: 'A9871' } } })
    const leftDev = await prisma.deviceUnit.count({ where: { serialNo: { startsWith: 'A9871' } } })
    const leftReq = await prisma.stockOutRequest.count({ where: { id: { in: ctx.requestIds } } })
    check('테스트 데이터 원상복구 (WMS·기기현황·요청 0)', leftUnits === 0 && leftDev === 0 && leftReq === 0)
    await prisma.$disconnect()
  }

  console.log(`\n결과: ${pass} pass / ${fail} fail`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
