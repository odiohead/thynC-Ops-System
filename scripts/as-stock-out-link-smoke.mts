/**
 * 분실 AS ↔ 출고업무 연동 스모크 (projects/as_lost_stock_out_link_design.md §7)
 *  준비 — 첫 병원에 분실 대상 기기 4대 등록(심전 A960001·A960002·A960003, 산소 P960001) + 고장 대조용 A960004
 *       판매용재고 WMS 입고: 심전계(판매용) A960101·A960102, 산소포화도본체(판매용) P960101, 센서 MP2000F LOT SMKLOT 1개
 *  → 분실 접수(4라인) → 3라인 [출고요청] (자리표시 품목·라인 잠금·비고) → 잠금 가드(초안·확정·시리얼 보정·재요청) · 고장 접수 400
 *  → 4번째 라인 분실종결 → preview(pending·카탈로그·기기군 불일치·미등록 시리얼·중복) → executeFulfillment(본체 3 + 센서 1)
 *  → 요청 완료·품목 보정·전표 / AS 라인 REPLACE·교체기·발송일 / 원장(분실 회수·새 기기 배치) / 헤더 발송완료 / 분실 수량 +3 / 되찾음 가능
 *  → 두 번째 접수로 취소 경로(잠금 해제) 확인. 테스트 데이터는 전부 삭제.   npx tsx scripts/as-stock-out-link-smoke.mts
 */
import { PrismaClient } from '@prisma/client'
import { createAsReceipt, createStockOutForAsLines, draftAsLines, resolveAsLines, correctAsLineSerial, unlinkAsLinesFromStockOut, AsServiceError } from '../lib/asReceiptService'
import { previewFulfillment, executeFulfillment, FulfillError } from '../lib/stockOutFulfill'
import { computeAsLostQuota } from '../lib/asLostQuota'
import { canMarkAsLineFound } from '../lib/asReceiptShared'
import { registerDevices } from '../lib/deviceRegistry/write'
import { todayKst } from '../lib/deviceRegistryShared'
import { planInventoryTransaction, applyInventoryTransaction } from '../lib/inventory'

const prisma = new PrismaClient()
let pass = 0, fail = 0
const check = (name: string, ok: boolean, note?: string) => { if (ok) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${note ? ` — ${note}` : ''}`) } }
async function expectErr(name: string, fn: () => Promise<unknown>, status: number, includes?: string) {
  try { await fn(); check(name, false, '에러 없음') } catch (e) {
    const st = (e as { status?: number }).status
    const ok = (e instanceof AsServiceError || e instanceof FulfillError) && st === status && (!includes || (e as Error).message.includes(includes))
    check(name, ok, e instanceof Error ? `${st ?? ''} ${e.message}` : String(e))
  }
}
const LOST = ['A960001', 'A960002', 'A960003'], LOST_P = 'P960001', FAULT_S = 'A960004', LOST2 = 'A960005'
const NEW_E = ['A960101', 'A960102'], NEW_P = 'P960101', LOT = 'SMKLOT'
const ALL = [...LOST, LOST_P, FAULT_S, LOST2, ...NEW_E, NEW_P]
const WARD = 'SMOKE출고병동'
const ITEM_ECG = 9, ITEM_SPO2 = 10, ITEM_SENSOR = 12, WH = 6

async function cleanup(hospitalCode: string, receiptIds: number[], requestIds: number[], txIds: number[]) {
  const rows = await prisma.asReceipt.findMany({ where: { id: { in: receiptIds } }, select: { ticketId: true, asCode: true } })
  const reqs = await prisma.stockOutRequest.findMany({ where: { id: { in: requestIds } }, select: { ticketId: true, sorCode: true } })
  const txs = await prisma.inventoryTransaction.findMany({ where: { OR: [{ id: { in: txIds } }, { stockOutRequestId: { in: requestIds } }] }, select: { id: true } })
  const allTx = Array.from(new Set([...txIds, ...txs.map((t) => t.id)]))
  await prisma.stockOutRequest.deleteMany({ where: { id: { in: requestIds } } })
  await prisma.asReceipt.deleteMany({ where: { id: { in: receiptIds } } })
  await prisma.ticket.deleteMany({ where: { id: { in: [...rows, ...reqs].map((r) => r.ticketId).filter((v): v is number => !!v) } } })
  try { await prisma.inventoryTransactionUnit.deleteMany({ where: { transactionId: { in: allTx } } }) } catch { /* 모델명 다르면 무시 */ }
  try { await prisma.inventoryTransaction.deleteMany({ where: { id: { in: allTx } } }) } catch (e) { console.log('  (전표 정리 실패 — 수동 확인)', (e as Error).message.slice(0, 80)) }
  await prisma.inventoryUnit.deleteMany({ where: { serialNo: { in: ALL } } }).catch(() => {})
  await prisma.inventoryStock.deleteMany({ where: { lotNo: LOT } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { OR: [...rows.map((r) => ({ resourceLabel: { startsWith: r.asCode } })), ...reqs.map((r) => ({ resourceLabel: { startsWith: r.sorCode } }))] } }).catch(() => {})
  const units = await prisma.deviceUnit.findMany({ where: { serialNo: { in: ALL } }, select: { id: true } })
  const ids = units.map((u) => u.id)
  if (ids.length) {
    await prisma.hospitalDeviceEvent.deleteMany({ where: { OR: [{ deviceId: { in: ids } }, { relatedDeviceId: { in: ids } }] } })
    await prisma.hospitalDevice.deleteMany({ where: { deviceId: { in: ids } } })
    await prisma.deviceUnit.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.hospitalWard.deleteMany({ where: { hospitalCode, name: WARD } }).catch(() => {})
}
const unitOf = (serial: string) => prisma.deviceUnit.findUnique({ where: { serialNo: serial }, select: { id: true, condition: true, placement: { select: { status: true, hospitalCode: true } } } })

async function main() {
  const receiptIds: number[] = [], requestIds: number[] = [], txIds: number[] = []
  let hospitalCode = ''
  try {
    const hospital = await prisma.hospital.findFirstOrThrow({ select: { hospitalCode: true, hospitalName: true }, orderBy: { id: 'asc' } })
    const user = await prisma.user.findFirstOrThrow({ where: { isActive: true, role: { in: ['ADMIN', 'SUPER_ADMIN'] } }, select: { id: true, name: true } })
    const actor = { userId: user.id, name: user.name }
    hospitalCode = hospital.hospitalCode
    await cleanup(hospitalCode, [], [], [])
    const ecgItem = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: ITEM_ECG }, select: { deviceInfoId: true } })
    const spo2Item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: ITEM_SPO2 }, select: { deviceInfoId: true } })
    const today = todayKst()
    const reg = await registerDevices({ hospitalCode, actor, occurredOn: today, source: 'MANUAL', memo: '[SMOKE] 출고연동' }, [
      ...[...LOST, FAULT_S, LOST2].map((s) => ({ serialInput: s, deviceInfoId: ecgItem.deviceInfoId!, wardName: WARD, productType: '일반' })),
      { serialInput: LOST_P, deviceInfoId: spo2Item.deviceInfoId!, wardName: WARD, productType: '일반' },
    ])
    check('분실 대상 기기 6대 원장 등록', reg.created.length + reg.reregistered.length === 6, JSON.stringify(reg.skipped))
    // WMS 입고 (판매용재고 903호)
    const inReason = await prisma.statusCode.findFirstOrThrow({ where: { category: 'STOCK_IN_TYPE', name: '구매' }, select: { id: true } })
    const plans = [
      await planInventoryTransaction({ txType: 'IN', reasonId: inReason.id, itemId: ITEM_ECG, warehouseId: WH, quantity: 2, serials: NEW_E, lotBySerial: Object.fromEntries(NEW_E.map((s) => [s, LOT])), destination: '[SMOKE]', note: '[SMOKE] 출고연동', txDate: today }),
      await planInventoryTransaction({ txType: 'IN', reasonId: inReason.id, itemId: ITEM_SPO2, warehouseId: WH, quantity: 1, serials: [NEW_P], lotBySerial: { [NEW_P]: LOT }, destination: '[SMOKE]', note: '[SMOKE] 출고연동', txDate: today }),
      await planInventoryTransaction({ txType: 'IN', reasonId: inReason.id, itemId: ITEM_SENSOR, warehouseId: WH, quantity: 1, lotNo: LOT, destination: '[SMOKE]', note: '[SMOKE] 출고연동', txDate: today }),
    ]
    for (const pl of plans) { const t = await prisma.$transaction((tx) => applyInventoryTransaction(tx, pl, user.id)); if (t) txIds.push(t.id) }
    const inStock = await prisma.inventoryUnit.count({ where: { serialNo: { in: [...NEW_E, NEW_P] }, status: 'IN_STOCK' } })
    check('판매용 본체 3대 WMS 입고(IN_STOCK)', inStock === 3, `${inStock}`)

    const lostR = await createAsReceipt({ hospitalCode, category: 'LOST', receiptDate: new Date(today), pickupMethod: 'NONE', destType: 'HOSPITAL', destInfo: '[SMOKE] 본관 3병동 / 김간호', reporterName: '[SMOKE] 김간호', note: '[SMOKE] 출고연동', lines: [...LOST, LOST_P].map((s) => ({ serial: s, symptom: '분실' })) }, actor)
    const faultR = await createAsReceipt({ hospitalCode, category: 'FAULT', receiptDate: new Date(today), pickupMethod: 'PARCEL', destType: 'HOSPITAL', destInfo: '[SMOKE]', note: '[SMOKE] 출고연동', lines: [{ serial: FAULT_S, symptom: '전원' }] }, actor)
    receiptIds.push(lostR.id, faultR.id)
    const lines = await prisma.asReceiptItem.findMany({ where: { receiptId: lostR.id }, orderBy: { id: 'asc' } })
    const byS = new Map(lines.map((l) => [l.serialNo, l]))
    const faultLine = await prisma.asReceiptItem.findFirstOrThrow({ where: { receiptId: faultR.id } })
    const q0 = (await computeAsLostQuota({ id: lostR.id, hospitalCode })).groups.find((g) => g.group === '심전계')!.before

    console.log('▶ [출고요청] 3라인')
    await expectErr('고장 접수 400', () => createStockOutForAsLines(faultR.id, actor, { itemIds: [faultLine.id], requestDate: today }), 400, '분실 접수')
    const so = await createStockOutForAsLines(lostR.id, actor, { itemIds: [byS.get(LOST[0])!.id, byS.get(LOST[1])!.id, byS.get(LOST_P)!.id], requestDate: today, shipAddress: '[SMOKE] 수령지', recipient: '[SMOKE] 수취인' })
    requestIds.push(so.requestId)
    const req = await prisma.stockOutRequest.findUniqueOrThrow({ where: { id: so.requestId }, include: { items: true, status: true } })
    check('출고요청 생성 — 판매용·분실기기 제공·납품처 접수 병원·AS 연결', req.purpose === 'SALES' && req.subPurpose === 'LOST_REPLACE' && req.destType === 'HOSPITAL' && req.destHospitalCode === hospitalCode && req.asReceiptId === lostR.id && !!req.ticketId && req.status?.name === '요청')
    check('자리표시 품목 — 심전계 2 · 산소포화도 1', req.items.some((i) => i.inventoryItemId === ITEM_ECG && i.quantity === 2) && req.items.some((i) => i.inventoryItemId === ITEM_SPO2 && i.quantity === 1) && req.items.length === 2, JSON.stringify(req.items.map((i) => [i.inventoryItemId, i.quantity])))
    const linked = await prisma.asReceiptItem.count({ where: { receiptId: lostR.id, stockOutRequestId: so.requestId } })
    check('라인 3개 잠금 연결', linked === 3)
    const note0 = (await prisma.asReceipt.findUniqueOrThrow({ where: { id: lostR.id }, select: { note: true } })).note ?? ''
    check('접수 비고 [출고요청]', note0.includes('[출고요청') && note0.includes(so.sorCode))

    console.log('▶ 잠금 가드')
    await expectErr('잠긴 라인 초안 409', () => draftAsLines(lostR.id, { lines: [{ itemId: byS.get(LOST[0])!.id, outcome: 'LOST' }] }), 409, '출고요청')
    await expectErr('잠긴 라인 확정 409', () => resolveAsLines(lostR.id, actor, { lines: [{ itemId: byS.get(LOST[0])!.id, outcome: 'LOST' }] }), 409, '출고요청')
    await expectErr('잠긴 라인 시리얼 보정 409', () => correctAsLineSerial(lostR.id, actor, { itemId: byS.get(LOST[0])!.id, serial: 'A960099' }), 409, '출고요청')
    await expectErr('잠긴 라인 재요청 409', () => createStockOutForAsLines(lostR.id, actor, { itemIds: [byS.get(LOST[0])!.id], requestDate: today }), 409, '이미 출고요청')

    console.log('▶ 4번째 라인 분실종결 (잠금 아님)')
    await resolveAsLines(lostR.id, actor, { lines: [{ itemId: byS.get(LOST[2])!.id, outcome: 'LOST' }] })
    check('분실종결 확정', (await prisma.asReceiptItem.findUniqueOrThrow({ where: { id: byS.get(LOST[2])!.id } })).outcome === 'LOST')

    console.log('▶ 출고 처리 preview')
    const p0 = await previewFulfillment(so.requestId, {})
    check('AS 모드 — 접수 라인 3개 pending·실행 불가', !!p0.asLink && p0.asLink.lines.length === 3 && p0.asLink.lines.every((l) => l.status === 'pending') && p0.ok === false)
    check('센서류 카탈로그에 본체 제외·센서 포함', !!p0.extraCatalog && p0.extraCatalog.some((c) => c.inventoryItemId === ITEM_SENSOR) && !p0.extraCatalog.some((c) => c.inventoryItemId === ITEM_ECG))
    const asId = (s: string) => byS.get(s)!.id
    const p1 = await previewFulfillment(so.requestId, { asLines: [{ asItemId: asId(LOST[0]), serial: NEW_P }, { asItemId: asId(LOST[1]), serial: 'A999999' }, { asItemId: asId(LOST_P), serial: NEW_P }] })
    const l1 = p1.asLink!.lines
    check('기기군 불일치 → error', l1.find((l) => l.asItemId === asId(LOST[0]))?.status === 'error' && !!l1.find((l) => l.asItemId === asId(LOST[0]))?.messages.join().includes('기기군'))
    check('미등록 시리얼 → error', l1.find((l) => l.asItemId === asId(LOST[1]))?.status === 'error')
    check('같은 시리얼 중복 → error', l1.find((l) => l.asItemId === asId(LOST_P))?.status === 'error' && l1.find((l) => l.asItemId === asId(LOST_P))!.messages.join().includes('다른 라인'))
    const good = { txDate: today, asLines: [{ asItemId: asId(LOST[0]), serial: NEW_E[0] }, { asItemId: asId(LOST[1]), serial: NEW_E[1] }, { asItemId: asId(LOST_P), serial: NEW_P }], extraLines: [{ inventoryItemId: ITEM_SENSOR, quantity: 1, lots: [{ warehouseId: WH, lotNo: LOT, quantity: 1 }] }] }
    const p2 = await previewFulfillment(so.requestId, good)
    check('정상 입력 → 본체 3 ok · 가상 라인 3품목(심전2·산소1·센서1) · ok', !!p2.asLink && p2.asLink.lines.every((l) => l.status === 'ok') && p2.lines.length === 3 && p2.ok, JSON.stringify({ e: p2.errors, lines: p2.lines.map((l) => [l.inventoryItemId, l.quantity, l.status, l.messages]) }))

    console.log('▶ 출고 실행 + AS 교체 확정')
    const r = await executeFulfillment(so.requestId, good, { userId: user.id, name: user.name ?? '' })
    check('전표 생성', r.txCodes.length >= 2, JSON.stringify(r))
    const reqAfter = await prisma.stockOutRequest.findUniqueOrThrow({ where: { id: so.requestId }, include: { items: true, status: true } })
    check("요청 완료·fulfilledAt", reqAfter.status?.name === '완료' && !!reqAfter.fulfilledAt)
    check('요청 품목 보정 — 심전계 2·산소 1·센서 1', reqAfter.items.length === 3 && reqAfter.items.some((i) => i.inventoryItemId === ITEM_SENSOR && i.quantity === 1), JSON.stringify(reqAfter.items.map((i) => [i.inventoryItemId, i.quantity])))
    const after = await prisma.asReceiptItem.findMany({ where: { receiptId: lostR.id }, orderBy: { id: 'asc' } })
    const m = new Map(after.map((l) => [l.serialNo, l]))
    check('AS 라인 REPLACE + 교체기 매핑', m.get(LOST[0])!.outcome === 'REPLACE' && m.get(LOST[0])!.newSerialNo === NEW_E[0] && m.get(LOST[1])!.newSerialNo === NEW_E[1] && m.get(LOST_P)!.newSerialNo === NEW_P && !!m.get(LOST[0])!.newDeviceId)
    check('발송일 = 출고일 · 택배 · 송장 없음', m.get(LOST[0])!.shippedAt?.toISOString().slice(0, 10) === today && m.get(LOST[0])!.shipMethod === 'PARCEL' && !m.get(LOST[0])!.shipTrackingNo)
    const uOld = await unitOf(LOST[0]), uNew = await unitOf(NEW_E[0])
    check('원장 — 분실 기기 LOST·회수, 새 기기 IN_USE·병원 ACTIVE', uOld?.condition === 'LOST' && uOld.placement?.status === 'RECOVERED' && uNew?.condition === 'IN_USE' && uNew.placement?.status === 'ACTIVE' && uNew.placement.hospitalCode === hospitalCode, JSON.stringify({ uOld, uNew }))
    const wmsOut = await prisma.inventoryUnit.count({ where: { serialNo: { in: [...NEW_E, NEW_P] }, status: 'OUT' } })
    check('WMS 개체 3대 OUT', wmsOut === 3)
    const hdr = await prisma.asReceipt.findUniqueOrThrow({ where: { id: lostR.id }, select: { note: true, status: { select: { name: true } } } })
    check("헤더 '발송완료' 자동 전이(전 라인 종결)", hdr.status?.name === '발송완료', hdr.status?.name)
    check('접수 비고 [출고 완료]', (hdr.note ?? '').includes('[출고 완료') && (hdr.note ?? '').includes(`${LOST[0]}→${NEW_E[0]}`))
    const q1 = (await computeAsLostQuota({ id: lostR.id, hospitalCode })).groups.find((g) => g.group === '심전계')!.before
    check('분실 수량(심전계) +2', q1 === q0 + 2, `${q0} → ${q1}`)
    check('되찾음 처리 가능 라인', canMarkAsLineFound('LOST', m.get(LOST[0])!))
    await expectErr('완료 요청 재실행 409', () => executeFulfillment(so.requestId, good, { userId: user.id, name: user.name ?? '' }), 409)

    console.log('▶ 취소 경로 — 두 번째 접수')
    const lost2 = await createAsReceipt({ hospitalCode, category: 'LOST', receiptDate: new Date(today), pickupMethod: 'NONE', destType: 'HOSPITAL', destInfo: '[SMOKE]', note: '[SMOKE] 출고연동2', lines: [{ serial: LOST2, symptom: '분실' }] }, actor)
    receiptIds.push(lost2.id)
    const l2 = await prisma.asReceiptItem.findFirstOrThrow({ where: { receiptId: lost2.id } })
    const so2 = await createStockOutForAsLines(lost2.id, actor, { itemIds: [l2.id], requestDate: today, shipAddress: 'x', recipient: 'y' })
    requestIds.push(so2.requestId)
    const n = await prisma.$transaction((tx) => unlinkAsLinesFromStockOut(tx, so2.requestId, actor, '취소'))
    const l2b = await prisma.asReceiptItem.findUniqueOrThrow({ where: { id: l2.id } })
    check('취소 → 잠금 해제·비고', n === 1 && l2b.stockOutRequestId === null && ((await prisma.asReceipt.findUniqueOrThrow({ where: { id: lost2.id }, select: { note: true } })).note ?? '').includes('[출고요청 취소'))
    await resolveAsLines(lost2.id, actor, { lines: [{ itemId: l2.id, outcome: 'LOST' }] })
    check('해제 후 분실종결 가능', (await prisma.asReceiptItem.findUniqueOrThrow({ where: { id: l2.id } })).outcome === 'LOST')
  } finally {
    if (hospitalCode) await cleanup(hospitalCode, receiptIds, requestIds, txIds)
    await prisma.$disconnect()
  }
  console.log(`\n결과: ${pass} pass / ${fail} fail`)
  process.exit(fail ? 1 : 0)
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(2) })
