/**
 * 시스템 수량 관리 + 서버 병상별 분리 스모크 (projects/system_server_split_design.md §6) — DEV DB 전용.
 *  전제: 마이그 20261117100000 + scripts/migrate-system-units-to-servers.sql 적용.
 *  ① 구조: 시스템 6종 수량 관리·개체 0 / 서버 6종 시리얼 관리 / 시스템 수량 = 서버 수량 = 재고 개체 / 서버 10~40병상의 편입 대상이 모두 서버(워크스테이션)
 *  ② 출고: 시스템10 ×1 + 시스템20 ×2 요청(서버 10병상 전량 미출고, 20병상 1대 미출고) → 시스템 라인 수량 모드 →
 *     실행 후 시스템·서버 수량이 같이 줄고, 미출고 2대는 thynC운영팀재고 서버(워크스테이션)으로 편입
 *  테스트 재고(시리얼 ZZTEST-)·요청·전표는 전부 원복.   npx tsx scripts/system-server-split-smoke.mts
 */
import { PrismaClient } from '@prisma/client'
import { createStockOutRequest } from '../lib/stockOutCreate'
import { previewFulfillment, executeFulfillment } from '../lib/stockOutFulfill'
import { createInventoryTransaction } from '../lib/inventory'

if (!/thync_ops_dev(\?|$)/.test(process.env.DATABASE_URL ?? '')) { console.error('DEV DB(thync_ops_dev)에서만 실행합니다.'); process.exit(1) }

const prisma = new PrismaClient()
let pass = 0, fail = 0
const check = (name: string, ok: boolean, note?: unknown) => { if (ok) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}`, note ?? '') } }
const PFX = 'ZZTEST-'
const PAIRS: [string, string][] = [['thynC시스템10', '서버(10병상)'], ['thynC시스템20', '서버(20병상)'], ['thynC시스템30', '서버(30병상)'], ['thynC시스템40', '서버(40병상)'], ['thynC시스템50', '서버(50병상)'], ['thynC시스템100', '서버(100병상)']]

async function main() {
  const dw = await prisma.inventory.findFirstOrThrow({ where: { name: '대웅제약재고' } })
  const items = await prisma.inventoryItem.findMany({
    where: { inventoryId: dw.id, name: { in: PAIRS.flat() } },
    select: { id: true, name: true, modelName: true, isSerialManaged: true, stockOutKind: { select: { source: { select: { id: true, name: true, itemCode: true, inventory: { select: { name: true } } } } } } },
  })
  const by = new Map(items.map((i) => [i.name, i]))
  const sum = async (itemId: number) => (await prisma.inventoryStock.aggregate({ where: { itemId }, _sum: { quantity: true } }))._sum.quantity ?? 0
  const inStock = (itemId: number) => prisma.inventoryUnit.count({ where: { itemId, status: 'IN_STOCK' } })

  console.log('▶ 구조')
  check('시스템 6종·서버 6종 품목 존재', items.length === 12, items.map((i) => i.name))
  for (const [sysName, srvName] of PAIRS) {
    const sys = by.get(sysName)!, srv = by.get(srvName)!
    const [sq, vq, units, sysUnits] = [await sum(sys.id), await sum(srv.id), await inStock(srv.id), await prisma.inventoryUnit.count({ where: { itemId: sys.id } })]
    check(`${sysName}: 수량 관리·개체 0 / ${srvName}: 시리얼 관리 / 수량 ${sq} = ${vq} = 개체 ${units}`, !sys.isSerialManaged && srv.isSerialManaged && sysUnits === 0 && sq === vq && vq === units && sq > 0)
    const cfg = await prisma.stockOutItemComponent.findMany({ where: { parentItemId: sys.id, child: { name: { startsWith: '서버(' } }, quantity: { gt: 0 } }, select: { child: { select: { name: true } }, quantity: true } })
    check(`${sysName} 구성의 서버 = ${srvName} 1대뿐`, cfg.length === 1 && cfg[0].child.name === srvName && cfg[0].quantity === 1, cfg)
  }
  for (const n of ['서버(10병상)', '서버(20병상)', '서버(30병상)', '서버(40병상)']) {
    const src = by.get(n)!.stockOutKind?.source
    check(`${n} 모델명 = 품목명, 편입 대상 = thynC운영팀재고 서버(워크스테이션)`, by.get(n)!.modelName === n && src?.name === '서버(워크스테이션)' && src.inventory.name === 'thynC운영팀재고', src)
  }
  check('대웅제약재고에 서버(워크스테이션) 품목 없음', (await prisma.inventoryItem.count({ where: { inventoryId: dw.id, name: '서버(워크스테이션)' } })) === 0)
  const kinds = await prisma.stockOutComponentKind.findMany({ orderBy: { sortOrder: 'asc' }, select: { item: { select: { name: true } } } })
  check('구성품 종류 10종 — 서버 병상순이 앞', kinds.length === 10 && kinds.slice(0, 6).map((k) => k.item.name).join() === PAIRS.map((p) => p[1]).join(), kinds.map((k) => k.item.name))

  // ── 출고 시나리오
  const s10 = by.get('thynC시스템10')!, s20 = by.get('thynC시스템20')!, v10 = by.get('서버(10병상)')!, v20 = by.get('서버(20병상)')!
  const ws = v10.stockOutKind!.source
  const actor = await prisma.user.findFirstOrThrow({ where: { name: '이준호' }, select: { id: true, name: true } })
  const project = await prisma.project.findFirstOrThrow({ orderBy: { createdAt: 'desc' }, select: { projectCode: true } })
  const dwWh = await prisma.warehouse.findFirstOrThrow({ where: { inventoryId: dw.id, isActive: true }, orderBy: { id: 'asc' } })
  const inReason = await prisma.statusCode.findFirstOrThrow({ where: { category: 'STOCK_IN_TYPE', name: '기타' } })
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  const compRows = await prisma.stockOutItemComponent.findMany({ where: { parentItemId: { in: [s10.id, s20.id] }, quantity: { gt: 0 } }, select: { childItemId: true, child: { select: { stockOutKind: { select: { sourceItemId: true } } } } } })
  const itemIds = Array.from(new Set([s10.id, s20.id, ws.id, ...compRows.map((c) => c.childItemId), ...compRows.map((c) => c.child.stockOutKind!.sourceItemId)]))
  const stockBefore = await prisma.inventoryStock.findMany({ where: { itemId: { in: itemIds } } })
  const stock0 = new Map<number, number>()
  for (const id of itemIds) stock0.set(id, await sum(id))
  const maxTx = (await prisma.inventoryTransaction.aggregate({ _max: { id: true } }))._max.id ?? 0
  const requestIds: number[] = []

  try {
    console.log('\n▶ 출고 — 시스템10 ×1 + 시스템20 ×2')
    const inTx = (itemId: number, quantity: number, serials?: string[]) => createInventoryTransaction({ txType: 'IN', reasonId: inReason.id, itemId, warehouseId: dwWh.id, quantity, serials, destination: 'SMOKE', note: 'SMOKE 시스템·서버 분리' }, actor.id)
    // 입고는 시스템 수량과 서버 시리얼을 각각 — 운영에서 하는 방식 그대로
    await inTx(s10.id, 1); await inTx(s20.id, 2)
    await inTx(v10.id, 1, [`${PFX}V10-1`]); await inTx(v20.id, 2, [`${PFX}V20-1`, `${PFX}V20-2`])
    check('입고 후에도 시스템 수량 = 서버 수량', (await sum(s10.id)) === (await sum(v10.id)) && (await sum(s20.id)) === (await sum(v20.id)))

    const created = await createStockOutRequest({
      purpose: 'BUILD', projectCode: project.projectCode, requestDate: today, note: 'SMOKE 시스템·서버 분리',
      items: [{ inventoryItemId: s10.id, quantity: 1 }, { inventoryItemId: s20.id, quantity: 2 }],
      unshipped: [{ itemId: v10.id, quantity: 1 }, { itemId: v20.id, quantity: 1 }],
    }, { userId: actor.id, name: actor.name })
    requestIds.push(created.id)
    const rows = await prisma.stockOutRequestComponent.findMany({ where: { requestId: created.id }, select: { itemId: true, quantity: true, unshippedQuantity: true, item: { select: { name: true } } } })
    const row = (id: number) => rows.find((r) => r.itemId === id)
    check('구성품: 서버(10병상) 1(미출고 1) · 서버(20병상) 2(미출고 1), 다른 병상 서버 없음',
      row(v10.id)?.quantity === 1 && row(v10.id)?.unshippedQuantity === 1 && row(v20.id)?.quantity === 2 && row(v20.id)?.unshippedQuantity === 1 && rows.filter((r) => r.item.name.startsWith('서버(')).length === 2, rows)

    // 구성품 기록이 없는 요청(개편 전 등록분)은 서버 시리얼 없이 처리되지 않도록 막힌다
    const snapshot = await prisma.stockOutRequestComponent.findMany({ where: { requestId: created.id } })
    await prisma.stockOutRequestComponent.deleteMany({ where: { requestId: created.id } })
    const bare = await previewFulfillment(created.id, {})
    check('구성품 행이 없는 요청 → 전역 오류로 실행 불가(시스템만 수량 차감되는 일 없음)', bare.ok === false && bare.errors.some((e) => e.includes('시스템 구성품')) && !bare.lines.some((l) => l.component), bare.errors)
    await prisma.stockOutRequestComponent.createMany({ data: snapshot })

    let pv = await previewFulfillment(created.id, {})
    const line = (id: number) => pv.lines.find((l) => l.inventoryItemId === id)
    check('시스템 라인 = 수량 모드, 시리얼 입력 없이 ok', line(s10.id)?.mode === 'qty' && line(s10.id)?.status === 'ok' && line(s20.id)?.mode === 'qty' && line(s20.id)?.status === 'ok', [line(s10.id), line(s20.id)])
    check('서버(10병상) 전량 미출고 → 출고분 라인 없음 / 서버(20병상) 출고분 1 시리얼 모드', !line(v10.id) && line(v20.id)?.mode === 'serial' && line(v20.id)?.quantity === 1)
    const hold = (id: number) => pv.holds.find((h) => h.itemId === id)
    check('미출고분 2종 모두 편입 대상 = thynC운영팀재고 서버(워크스테이션)', pv.holds.filter((h) => h.targetItemName === '서버(워크스테이션)' && h.targetInventoryName === 'thynC운영팀재고').length === 2 && pv.holdTarget?.inventoryName === 'thynC운영팀재고', pv.holds)
    check('전역 오류 없음(편입 대상 인벤토리 1개)', pv.errors.length === 0, pv.errors)

    const qtyLines = pv.lines.filter((l) => l.mode !== 'serial').map((l) => ({ inventoryItemId: l.inventoryItemId }))
    const lines = [...qtyLines, { inventoryItemId: v20.id, serials: [`${PFX}V20-1`] }]
    const holds = [{ itemId: v10.id, serials: [`${PFX}V10-1`] }, { itemId: v20.id, serials: [`${PFX}V20-2`] }]
    pv = await previewFulfillment(created.id, { lines, holds })
    check('시리얼 입력 후 실행 가능', pv.ok && hold(v10.id)?.status === 'ok' && hold(v20.id)?.status === 'ok', { errors: pv.errors, bad: pv.lines.filter((l) => l.status !== 'ok' && l.status !== 'warning').map((l) => [l.name, l.status, l.messages]), holds: pv.holds.map((h) => [h.name, h.status, h.messages]) })

    await executeFulfillment(created.id, { lines, holds }, { userId: actor.id, name: actor.name })
    check('시스템10·20 수량 원위치(−1·−2)', (await sum(s10.id)) === stock0.get(s10.id) && (await sum(s20.id)) === stock0.get(s20.id), [await sum(s10.id), await sum(s20.id)])
    check('출고 후 시스템 수량 = 서버 수량 = 재고 개체 (10·20병상)',
      (await sum(s10.id)) === (await sum(v10.id)) && (await sum(v10.id)) === (await inStock(v10.id)) && (await sum(s20.id)) === (await sum(v20.id)) && (await sum(v20.id)) === (await inStock(v20.id)))
    check('thynC운영팀재고 서버(워크스테이션) 재고 +2', (await sum(ws.id)) === (stock0.get(ws.id) ?? 0) + 2, await sum(ws.id))
    const moved = await prisma.inventoryUnit.findMany({ where: { itemId: ws.id, serialNo: { in: [`${PFX}V10-1`, `${PFX}V20-2`] }, status: 'IN_STOCK' } })
    check('미출고 시리얼 2대가 서버(워크스테이션) 재고 개체로 편입', moved.length === 2, moved.map((u) => u.serialNo))
    const shipped = await prisma.inventoryUnit.findFirst({ where: { itemId: v20.id, serialNo: `${PFX}V20-1` } })
    check('출고 시리얼은 서버(20병상) 출고됨', shipped?.status === 'OUT')
    const txs = await prisma.inventoryTransaction.findMany({ where: { stockOutRequestId: created.id }, select: { txType: true, itemId: true, quantity: true, _count: { select: { units: true } } } })
    const sysTx = txs.filter((t) => t.itemId === s10.id || t.itemId === s20.id)
    check('시스템 출고 전표는 수량만(시리얼 연결 없음)', sysTx.length === 2 && sysTx.every((t) => t.txType === 'OUT' && t._count.units === 0) && sysTx.reduce((s, t) => s + t.quantity, 0) === 3, sysTx)
    check('편입 입고 전표 2건이 같은 품목(서버(워크스테이션))으로', txs.filter((t) => t.txType === 'IN' && t.itemId === ws.id).length === 2)
    const after = await prisma.stockOutRequestComponent.findMany({ where: { requestId: created.id, itemId: { in: [v10.id, v20.id] } }, select: { itemId: true, shippedSerials: true, unshippedSerials: true } })
    check('처리 시리얼 기록', after.find((r) => r.itemId === v10.id)?.unshippedSerials === `${PFX}V10-1` && after.find((r) => r.itemId === v20.id)?.shippedSerials === `${PFX}V20-1` && after.find((r) => r.itemId === v20.id)?.unshippedSerials === `${PFX}V20-2`, after)
  } finally {
    const reqs = await prisma.stockOutRequest.findMany({ where: { id: { in: requestIds } }, select: { ticketId: true } })
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
    if (left > 0 || !same) fail++
  }
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
