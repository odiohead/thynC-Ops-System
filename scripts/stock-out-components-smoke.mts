/**
 * 출고요청 시스템 구성품 스모크 (projects/stock_out_v2_design.md §13 — 2026-11-12 개편)
 *  전제: 마이그 20261112150000 + scripts/seed-stock-out-component-kinds.sql (구성품 종류 등록)
 *  준비 — 구성을 가진 시스템 1종(수량 3)을 골라, 그 구성품 품목(대웅제약재고)과 시스템 품목에 테스트 재고 입고(시리얼 ZZTEST-*)
 *  → 요청 생성(미출고 수량 포함) → 구성품 합계·미출고 저장 / 검증 오류(초과·종류 아님·구성품 직접 요청)
 *  → 미리보기(출고분 가상 라인·미출고분 판정·편입 위치) → 오류 경로(시리얼 겹침·개수·재고 부족)
 *  → 출고 실행: 구성품 출고분 대웅제약재고 차감 / 미출고분 대웅제약재고 OUT + 원본(thynC운영팀재고) IN / 시리얼 기록 / 요청 완료
 *  → 재실행 409. 테스트 데이터(요청·티켓·전표·개체·재고)는 전부 원복.   npx tsx scripts/stock-out-components-smoke.mts
 */
import { PrismaClient } from '@prisma/client'
import { createStockOutRequest, StockOutCreateError } from '../lib/stockOutCreate'
import { previewFulfillment, executeFulfillment, FulfillError } from '../lib/stockOutFulfill'
import { createInventoryTransaction } from '../lib/inventory'

const prisma = new PrismaClient()
let pass = 0, fail = 0
const check = (name: string, ok: boolean, note?: string) => { if (ok) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${note ? ` — ${note}` : ''}`) } }
async function expectErr(name: string, fn: () => Promise<unknown>, includes: string) {
  try { await fn(); check(name, false, '에러 없음') } catch (e) {
    check(name, (e instanceof StockOutCreateError || e instanceof FulfillError) && (e as Error).message.includes(includes), e instanceof Error ? e.message : String(e))
  }
}
const PFX = 'ZZTEST-'
const SYS_QTY = 3

async function main() {
  const kinds = await prisma.stockOutComponentKind.findMany({
    select: { itemId: true, sourceItemId: true, item: { select: { id: true, name: true, isSerialManaged: true, isLotManaged: true, inventoryId: true } }, source: { select: { id: true, name: true, inventoryId: true, inventory: { select: { name: true } } } } },
    orderBy: { sortOrder: 'asc' },
  })
  if (!kinds.length) { console.log('구성품 종류가 없습니다 — scripts/seed-stock-out-component-kinds.sql 먼저 실행'); process.exit(1) }
  const kindIds = kinds.map((k) => k.itemId)
  // 구성 수량이 있는 시스템 중 종류를 가장 많이 쓰는 것
  const comps = await prisma.stockOutItemComponent.findMany({ where: { childItemId: { in: kindIds }, quantity: { gt: 0 } }, include: { parent: { select: { id: true, name: true, isSerialManaged: true, inventoryId: true } } } })
  const byParent = new Map<number, typeof comps>()
  for (const c of comps) byParent.set(c.parentItemId, [...(byParent.get(c.parentItemId) ?? []), c])
  const [parentId, parentComps] = Array.from(byParent.entries()).sort((a, b) => b[1].length - a[1].length || b[0] - a[0])[0]
  const parent = parentComps[0].parent
  const unit = new Map(parentComps.map((c) => [c.childItemId, c.quantity]))
  const total = (kindId: number) => (unit.get(kindId) ?? 0) * SYS_QTY
  const used = kinds.filter((k) => total(k.itemId) > 0)
  const serialKinds = used.filter((k) => k.item.isSerialManaged)
  const qtyKinds = used.filter((k) => !k.item.isSerialManaged && !k.item.isLotManaged)
  console.log(`시스템 ${parent.name} × ${SYS_QTY} — 구성품: ${used.map((k) => `${k.item.name} ${total(k.itemId)}`).join(', ')}`)
  if (!serialKinds.length || qtyKinds.length < 2) { console.log('시리얼 구성품 1종·수량 구성품 2종 이상이 필요합니다.'); process.exit(1) }
  const kSerial = serialKinds[0] // 일부 미출고 (시리얼 분리)
  const kAllHold = qtyKinds[0] // 전량 미출고 (출고 라인 없음)
  const kPartHold = qtyKinds[qtyKinds.length - 1] // 일부 미출고 (수량)
  const unshipped = [
    { itemId: kSerial.itemId, quantity: 1 },
    { itemId: kAllHold.itemId, quantity: total(kAllHold.itemId) },
    { itemId: kPartHold.itemId, quantity: Math.min(2, total(kPartHold.itemId)) },
  ].filter((u, i, a) => a.findIndex((x) => x.itemId === u.itemId) === i)
  const un = (kindId: number) => unshipped.find((u) => u.itemId === kindId)?.quantity ?? 0

  const actor = await prisma.user.findFirstOrThrow({ where: { name: '이준호' }, select: { id: true, name: true } })
  const project = await prisma.project.findFirstOrThrow({ orderBy: { createdAt: 'desc' }, select: { projectCode: true } })
  const dwWh = await prisma.warehouse.findFirstOrThrow({ where: { inventoryId: parent.inventoryId, isActive: true }, orderBy: { id: 'asc' } })
  const inReason = await prisma.statusCode.findFirstOrThrow({ where: { category: 'STOCK_IN_TYPE', name: '기타' } })
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })

  // 원복용 스냅샷 — 관련 품목의 재고 버킷·전표 최대 id
  const itemIds = [parentId, ...used.map((k) => k.itemId), ...used.map((k) => k.sourceItemId)]
  const stockBefore = await prisma.inventoryStock.findMany({ where: { itemId: { in: itemIds } } })
  const maxTx = (await prisma.inventoryTransaction.aggregate({ _max: { id: true } }))._max.id ?? 0
  const requestIds: number[] = []
  const sum = async (itemId: number) => (await prisma.inventoryStock.aggregate({ where: { itemId }, _sum: { quantity: true } }))._sum.quantity ?? 0
  const stock0 = new Map<number, number>()
  for (const id of itemIds) stock0.set(id, await sum(id))

  try {
    // ── 준비: 테스트 재고 입고 (시스템 시리얼 + 구성품)
    const sysSerials = Array.from({ length: SYS_QTY }, (_, i) => `${PFX}SYS-${i + 1}`)
    const inTx = (itemId: number, quantity: number, serials?: string[]) => createInventoryTransaction({ txType: 'IN', reasonId: inReason.id, itemId, warehouseId: dwWh.id, quantity, serials, destination: 'SMOKE', note: 'SMOKE 구성품 테스트 입고' }, actor.id)
    if (parent.isSerialManaged) await inTx(parentId, SYS_QTY, sysSerials)
    else await inTx(parentId, SYS_QTY)
    const compSerials = new Map<number, string[]>()
    for (const k of used) {
      if (k.item.isSerialManaged) { const ss = Array.from({ length: total(k.itemId) }, (_, i) => `${PFX}C${k.itemId}-${i + 1}`); compSerials.set(k.itemId, ss); await inTx(k.itemId, ss.length, ss) }
      else if (k.itemId !== kPartHold.itemId) await inTx(k.itemId, total(k.itemId))
      else await inTx(k.itemId, total(k.itemId) - 1) // 1개 모자라게 — 재고 부족 경로 확인 후 채움
    }

    // ── 요청 생성
    console.log('\n▶ 요청 생성')
    const body = { purpose: 'BUILD', projectCode: project.projectCode, requestDate: today, note: 'SMOKE 시스템 구성품', items: [{ inventoryItemId: parentId, quantity: SYS_QTY }] }
    await expectErr('미출고 > 구성품 수량 → 거부', () => createStockOutRequest({ ...body, unshipped: [{ itemId: kSerial.itemId, quantity: total(kSerial.itemId) + 1 }] }, { userId: actor.id, name: actor.name }), '구성품 수량')
    await expectErr('구성품 종류가 아닌 품목의 미출고 → 거부', () => createStockOutRequest({ ...body, unshipped: [{ itemId: parentId, quantity: 1 }] }, { userId: actor.id, name: actor.name }), '구성품이 올바르지')
    await expectErr('구성품 품목을 직접 요청 → 거부', () => createStockOutRequest({ ...body, items: [...body.items, { inventoryItemId: kSerial.itemId, quantity: 1 }] }, { userId: actor.id, name: actor.name }), '시스템 구성품이라')
    const created = await createStockOutRequest({ ...body, unshipped }, { userId: actor.id, name: actor.name })
    requestIds.push(created.id)
    const rows = await prisma.stockOutRequestComponent.findMany({ where: { requestId: created.id }, orderBy: { sortOrder: 'asc' } })
    check('구성품 행 = 수량 있는 종류 전부', rows.length === used.length, `${rows.length} / ${used.length}`)
    check('구성품 합계 = 시스템 수량 × 구성 수량', rows.every((r) => r.quantity === total(r.itemId)), rows.map((r) => `${r.itemId}:${r.quantity}`).join(' '))
    check('미출고 = 입력값', rows.every((r) => r.unshippedQuantity === un(r.itemId)), rows.map((r) => `${r.itemId}:${r.unshippedQuantity}`).join(' '))

    // ── 미리보기
    console.log('\n▶ 미리보기')
    let pv = await previewFulfillment(created.id, {})
    const shipLines = pv.lines.filter((l) => l.component)
    check('요청 라인 1 + 구성품 출고분 라인(전량 미출고 종류 제외)', pv.lines.length - shipLines.length === 1 && shipLines.length === used.filter((k) => total(k.itemId) - un(k.itemId) > 0).length, `${pv.lines.length} / comp ${shipLines.length}`)
    check('출고분 수량 = 합계 − 미출고', shipLines.every((l) => l.quantity === total(l.inventoryItemId) - un(l.inventoryItemId)))
    check('전량 미출고 구성품은 출고분 라인 없음', !shipLines.some((l) => l.inventoryItemId === kAllHold.itemId))
    check('미출고분 = 미출고 수량 있는 종류', pv.holds.length === unshipped.length && pv.holds.every((h) => h.quantity === un(h.itemId)))
    check('편입 대상 = 원본 품목의 인벤토리 + 창고 기본 선택', pv.holdTarget?.inventoryName === kSerial.source.inventory.name && !!pv.holdTarget?.warehouseId && pv.holdTarget.warehouses.length > 0, JSON.stringify(pv.holdTarget))
    check('시리얼 미출고분은 입력 대기', pv.holds.find((h) => h.itemId === kSerial.itemId)?.status === 'pending')
    check('수량 미출고분(전량) 재고 충분 → ok', pv.holds.find((h) => h.itemId === kAllHold.itemId)?.status === 'ok')
    check('수량 미출고분 재고 부족(출고+미출고) → error', pv.holds.find((h) => h.itemId === kPartHold.itemId)?.status === 'error', pv.holds.find((h) => h.itemId === kPartHold.itemId)?.messages.join(' / '))
    check('실행 불가(ok=false)', pv.ok === false)
    await inTx(kPartHold.itemId, 1) // 부족분 채움

    const ss = compSerials.get(kSerial.itemId)!
    const shipSerial = ss.slice(0, ss.length - 1), holdSerial = ss.slice(ss.length - 1)
    const lines = [
      { inventoryItemId: parentId, ...(parent.isSerialManaged ? { serials: sysSerials } : {}) },
      ...used.filter((k) => total(k.itemId) - un(k.itemId) > 0).map((k) => (k.item.isSerialManaged
        ? { inventoryItemId: k.itemId, serials: k.itemId === kSerial.itemId ? shipSerial : compSerials.get(k.itemId)! }
        : { inventoryItemId: k.itemId, serialsNote: `NOTE-SHIP-${k.itemId}` })),
    ]
    const holds = unshipped.map((u) => (u.itemId === kSerial.itemId ? { itemId: u.itemId, serials: holdSerial } : { itemId: u.itemId, serialsNote: `NOTE-HOLD-${u.itemId}` }))
    pv = await previewFulfillment(created.id, { lines, holds: holds.map((h) => (h.itemId === kSerial.itemId ? { itemId: h.itemId, serials: [shipSerial[0]] } : h)) })
    check('출고분과 겹치는 미출고 시리얼 → error', pv.holds.find((h) => h.itemId === kSerial.itemId)?.status === 'error' && !!pv.holds.find((h) => h.itemId === kSerial.itemId)?.messages.some((m) => m.includes('출고분에도')))
    pv = await previewFulfillment(created.id, { lines, holds: holds.map((h) => (h.itemId === kSerial.itemId ? { itemId: h.itemId, serials: [...holdSerial, `${PFX}NOPE`] } : h)) })
    check('미출고 시리얼 개수·미등록 → error', pv.holds.find((h) => h.itemId === kSerial.itemId)?.status === 'error')
    pv = await previewFulfillment(created.id, { lines, holds, holdWarehouseId: dwWh.id })
    check('편입 위치가 대상 인벤토리 창고가 아님 → 전역 오류', pv.errors.some((e) => e.includes('편입 위치')), pv.errors.join(' / '))
    const toWh = pv.holdTarget!.warehouses[pv.holdTarget!.warehouses.length - 1].id
    pv = await previewFulfillment(created.id, { lines, holds, holdWarehouseId: toWh })
    check('전 라인·미출고분 ok → 실행 가능', pv.ok && pv.holds.every((h) => h.status === 'ok') && pv.lines.every((l) => l.status === 'ok' || l.status === 'warning'), [...pv.errors, ...pv.lines.filter((l) => l.status === 'error').flatMap((l) => l.messages), ...pv.holds.flatMap((h) => h.messages)].join(' / '))

    // ── 실행
    console.log('\n▶ 출고 실행')
    const result = await executeFulfillment(created.id, { lines, holds, holdWarehouseId: toWh, txDate: today }, { userId: actor.id, name: actor.name })
    const heldSum = unshipped.reduce((s, u) => s + u.quantity, 0)
    check('편입 수량 합', result.held === heldSum, `${result.held} / ${heldSum}`)
    for (const k of used) check(`${k.item.name}(대웅제약재고) 재고 원위치 — 출고분+미출고분 전부 차감`, (await sum(k.itemId)) === (stock0.get(k.itemId) ?? 0), `${await sum(k.itemId)} vs ${stock0.get(k.itemId)}`)
    for (const k of used) check(`${k.source.name}(${k.source.inventory.name}) 재고 +${un(k.itemId)}`, (await sum(k.sourceItemId)) === (stock0.get(k.sourceItemId) ?? 0) + un(k.itemId), `${await sum(k.sourceItemId)} vs ${(stock0.get(k.sourceItemId) ?? 0) + un(k.itemId)}`)
    const movedUnit = await prisma.inventoryUnit.findFirst({ where: { itemId: kSerial.sourceItemId, serialNo: holdSerial[0] } })
    check('미출고 시리얼 → 원본 품목 개체(IN_STOCK, 선택한 창고)', movedUnit?.status === 'IN_STOCK' && movedUnit.warehouseId === toWh && movedUnit.inventoryId === kSerial.source.inventoryId)
    const oldUnit = await prisma.inventoryUnit.findFirst({ where: { itemId: kSerial.itemId, serialNo: holdSerial[0] } })
    check('미출고 시리얼 — 대웅제약재고 개체는 출고됨', oldUnit?.status === 'OUT')
    const shippedUnits = await prisma.inventoryUnit.findMany({ where: { itemId: kSerial.itemId, serialNo: { in: shipSerial } } })
    check('출고 시리얼 — 대웅제약재고 개체 출고됨', shippedUnits.length === shipSerial.length && shippedUnits.every((u) => u.status === 'OUT'))
    const txs = await prisma.inventoryTransaction.findMany({ where: { stockOutRequestId: created.id }, include: { reasonCode: { select: { name: true } }, inventory: { select: { name: true } } } })
    check('전표가 요청에 연결', txs.length === result.txCodes.length && txs.length > 0, `${txs.length} / ${result.txCodes.length}`)
    const holdOut = txs.filter((t) => t.txType === 'OUT' && (t.note ?? '').includes('미출고분'))
    const holdIn = txs.filter((t) => t.txType === 'IN')
    check('편입 OUT — 유형 기타·병원 연결 없음', holdOut.length >= unshipped.length && holdOut.every((t) => t.reasonCode?.name === '기타' && t.hospitalCode === null))
    check('편입 IN — 원본 인벤토리·유형 기타·수량 합 = 미출고 합', holdIn.length === unshipped.length && holdIn.every((t) => t.reasonCode?.name === '기타' && t.inventory.name === kSerial.source.inventory.name) && holdIn.reduce((s, t) => s + t.quantity, 0) === heldSum)
    const shipOut = txs.filter((t) => t.txType === 'OUT' && !(t.note ?? '').includes('미출고분') && kindIds.includes(t.itemId))
    check('구성품 출고분 OUT — 수량 합 = 합계 − 미출고', shipOut.reduce((s, t) => s + t.quantity, 0) === used.reduce((s, k) => s + total(k.itemId) - un(k.itemId), 0))
    const after = await prisma.stockOutRequestComponent.findMany({ where: { requestId: created.id } })
    const rowOf = (id: number) => after.find((r) => r.itemId === id)
    check('출고분 시리얼 기록(시리얼 품목)', rowOf(kSerial.itemId)?.shippedSerials === shipSerial.join('\n'))
    check('미출고분 시리얼 기록(시리얼 품목)', rowOf(kSerial.itemId)?.unshippedSerials === holdSerial.join('\n'))
    check('미출고분 기록(수량 품목 — 메모)', rowOf(kAllHold.itemId)?.unshippedSerials === `NOTE-HOLD-${kAllHold.itemId}` && rowOf(kAllHold.itemId)?.shippedSerials === null)
    check('출고분 기록(수량 품목 — 메모)', rowOf(kPartHold.itemId)?.shippedSerials === `NOTE-SHIP-${kPartHold.itemId}`)
    const reqAfter = await prisma.stockOutRequest.findUnique({ where: { id: created.id }, select: { fulfilledAt: true, status: { select: { name: true } } } })
    check('요청 완료 처리', !!reqAfter?.fulfilledAt && reqAfter.status?.name === '완료')
    try { await executeFulfillment(created.id, { lines, holds }, { userId: actor.id, name: actor.name }); check('재실행 409', false) } catch (e) { check('재실행 409', e instanceof FulfillError && e.status === 409) }
  } finally {
    // ── 원복
    const reqs = await prisma.stockOutRequest.findMany({ where: { id: { in: requestIds } }, select: { ticketId: true, sorCode: true } })
    const newTx = await prisma.inventoryTransaction.findMany({ where: { id: { gt: maxTx }, itemId: { in: itemIds } }, select: { id: true } })
    await prisma.inventoryTransactionUnit.deleteMany({ where: { transactionId: { in: newTx.map((t) => t.id) } } })
    await prisma.inventoryTransaction.deleteMany({ where: { id: { in: newTx.map((t) => t.id) } } })
    await prisma.inventoryUnit.deleteMany({ where: { serialNo: { startsWith: PFX } } })
    await prisma.inventoryStock.deleteMany({ where: { itemId: { in: itemIds } } })
    if (stockBefore.length) await prisma.inventoryStock.createMany({ data: stockBefore })
    await prisma.stockOutRequest.deleteMany({ where: { id: { in: requestIds } } })
    await prisma.ticket.deleteMany({ where: { id: { in: reqs.map((r) => r.ticketId).filter((v): v is number => !!v) } } })
    const left = await prisma.inventoryUnit.count({ where: { serialNo: { startsWith: PFX } } })
    let same = true
    for (const id of itemIds) if ((await sum(id)) !== (stock0.get(id) ?? 0)) same = false
    console.log(`\n원복: 전표 ${newTx.length}건·요청 ${requestIds.length}건 삭제, 테스트 개체 잔여 ${left}, 재고 원상 ${same ? '일치' : '불일치!'}`)
  }
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
