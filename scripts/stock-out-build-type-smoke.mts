/**
 * 출고요청 유형(구축(일반)/구축(라이트)/데모(PoC)) → 기기 상품유형 등록 · 품목 경고 · 임시 저장 스모크 (2026-11-18)
 *  배경: 일반·라이트 계약이 함께 있는 병원으로 출고하면 기기현황 등록이 '상품유형 필수'로 거부됐고 화면엔 원인이 안 보였다(PROD SOR-202611-0014).
 *        → 요청 작성 때 유형을 고르고, 출고되는 기기는 그 유형(일반/라이트)으로 등록한다. 데모(PoC)는 대웅제약재고에서 나가지 않는다.
 *  준비 — 계약이 섞인 병원의 프로젝트, 대웅제약재고 L심전계에 테스트 시리얼 4개 입고
 *  ① 요청 유형 검증: 잘못된 유형 거부 / 데모(PoC)+대웅제약재고 품목 거부 / 데모(PoC)+운영팀 재고 품목 생성(등록 대상 없음)
 *  ② 구축(라이트) + L 품목 → 경고 없음 → 실행 → 라이트로 등록, 임시 저장분 비워짐
 *  ③ 유형 없는 옛 요청(혼합 병원) → 처리 화면 선택 필수(미선택 실행 거부) / 고르면 통과
 *  ④ 구축(일반) + L 품목 → 경고만(차단 아님) → 실행 → 일반으로 등록
 *  ⑤ 유형 없는 옛 요청(계약 한 종류 병원) → 병원 계약 기준 자동(미리보기만)
 *  테스트 데이터(요청·티켓·전표·개체·재고·기기현황)는 전부 원복.   npx tsx scripts/stock-out-build-type-smoke.mts   (DEV 전용)
 */
import { PrismaClient } from '@prisma/client'
import { createStockOutRequest, StockOutCreateError } from '../lib/stockOutCreate'
import { previewFulfillment, executeFulfillment, FulfillError } from '../lib/stockOutFulfill'
import { createInventoryTransaction } from '../lib/inventory'
import { isLiteItemName, stockOutProductTypeOf, stockOutKindLabel, subPurposeLabel } from '../lib/stockOutShared'

if (process.cwd().includes('thynC-Ops-PROD')) throw new Error('DEV 전용')
const prisma = new PrismaClient()
let pass = 0, fail = 0
const check = (name: string, ok: boolean, note?: string) => { if (ok) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${note ? ` — ${note}` : ''}`) } }
const SERIALS = ['A999901', 'A999902', 'A999903', 'A999904'] // 실재하지 않는 심전계 형식 시리얼

async function main() {
  check("isLiteItemName — 'L심전계(L-MC200M-T)'는 라이트용, '심전계(MC200M-T)'·'LAN 케이블'은 아님", isLiteItemName('L심전계(L-MC200M-T)') && !isLiteItemName('심전계(MC200M-T)') && !isLiteItemName('LAN 케이블'))
  check('유형 → 상품유형: 구축(일반)=일반 · 구축(라이트)=라이트 · 데모(PoC)/미지정/영업 유형=없음',
    stockOutProductTypeOf('BUILD', 'GENERAL') === '일반' && stockOutProductTypeOf('BUILD', 'LITE') === '라이트' && stockOutProductTypeOf('BUILD', 'POC') === null
    && stockOutProductTypeOf('BUILD', null) === null && stockOutProductTypeOf('SALES', 'LOST_REPLACE') === null)
  check('표시 라벨: 구축(일반)/구축(라이트)/데모(PoC), 유형 없는 구축은 종전 라벨',
    stockOutKindLabel('BUILD', 'GENERAL') === '구축(일반)' && stockOutKindLabel('BUILD', 'LITE') === '구축(라이트)' && stockOutKindLabel('BUILD', 'POC') === '데모(PoC)'
    && subPurposeLabel('BUILD', 'POC') === '데모(PoC)' && stockOutKindLabel('BUILD', null) === stockOutKindLabel('BUILD', undefined) && !stockOutKindLabel('BUILD', null).includes('('))

  // 계약이 섞인 병원 + 그 병원의 프로젝트 / 계약이 한 종류뿐인 병원의 프로젝트
  const byHospital = await prisma.$queryRaw<{ hospital_code: string; types: number; one: string | null }[]>`
    SELECT sd.hospital_code, count(DISTINCT sd.product_type)::int AS types, min(sd.product_type) AS one
    FROM sales_deals sd JOIN status_codes sc ON sc.id = sd.status_id
    WHERE sc.category = 'SALES_DEAL_STATUS' AND sc.name = '계약완료' AND sd.product_type IS NOT NULL GROUP BY 1`
  const mixedCodes = byHospital.filter((h) => h.types > 1).map((h) => h.hospital_code)
  const mixedProject = await prisma.project.findFirst({ where: { hospitalCode: { in: mixedCodes } }, orderBy: { id: 'desc' }, select: { projectCode: true, hospitalCode: true } })
  if (!mixedProject?.hospitalCode) { console.log('일반·라이트 계약이 섞인 병원의 프로젝트가 없습니다'); process.exit(1) }
  const singles = byHospital.filter((h) => h.types === 1)
  const singleProject = await prisma.project.findFirst({ where: { hospitalCode: { in: singles.map((h) => h.hospital_code) } }, orderBy: { id: 'desc' }, select: { projectCode: true, hospitalCode: true } })
  const singleType = singles.find((h) => h.hospital_code === singleProject?.hospitalCode)?.one ?? null
  const item = await prisma.inventoryItem.findFirstOrThrow({
    where: { isActive: true, isSerialManaged: true, name: { startsWith: 'L심전계' }, inventory: { name: '대웅제약재고' }, deviceInfo: { serialTracked: true } },
    select: { id: true, name: true, inventoryId: true },
  })
  const opsItem = await prisma.inventoryItem.findFirstOrThrow({
    where: { isActive: true, inventory: { name: 'thynC운영팀재고' }, stockOutPurposes: { some: { purpose: 'BUILD' } } }, orderBy: { id: 'asc' }, select: { id: true, name: true },
  })
  const hospital = await prisma.hospital.findUniqueOrThrow({ where: { hospitalCode: mixedProject.hospitalCode }, select: { hospitalName: true } })
  const hc = mixedProject.hospitalCode
  console.log(`혼합 병원 ${hospital.hospitalName}(${hc}) 프로젝트 ${mixedProject.projectCode} / 품목 ${item.name} · 운영팀 재고 품목 ${opsItem.name} / 단일 계약 병원 프로젝트 ${singleProject?.projectCode ?? '-'}(${singleType ?? '-'})`)

  const clash = (await prisma.deviceUnit.count({ where: { serialNo: { in: SERIALS } } })) + (await prisma.inventoryUnit.count({ where: { serialNo: { in: SERIALS } } }))
  if (clash) { console.log('테스트 시리얼이 이미 존재합니다 — 중단'); process.exit(1) }
  const actor = await prisma.user.findFirstOrThrow({ where: { name: '이준호' }, select: { id: true, name: true } })
  const wh = await prisma.warehouse.findFirstOrThrow({ where: { inventoryId: item.inventoryId, isActive: true }, orderBy: { id: 'asc' } })
  const inReason = await prisma.statusCode.findFirstOrThrow({ where: { category: 'STOCK_IN_TYPE', name: '기타' } })
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  const who = { userId: actor.id, name: actor.name }

  // 원복용 스냅샷
  const stockBefore = await prisma.inventoryStock.findMany({ where: { itemId: item.id } })
  const maxTx = (await prisma.inventoryTransaction.aggregate({ _max: { id: true } }))._max.id ?? 0
  const activeBefore = await prisma.hospitalDevice.count({ where: { hospitalCode: hc, status: 'ACTIVE' } })
  const notif0 = await prisma.notificationLog.count()
  const requestIds: number[] = []
  const mk = async (subPurpose: string | undefined, o: { projectCode?: string; itemId?: number } = {}) => {
    const r = await createStockOutRequest({ purpose: 'BUILD', projectCode: o.projectCode ?? mixedProject.projectCode, requestDate: today, note: 'SMOKE 요청 유형', ...(subPurpose ? { subPurpose } : {}), items: [{ inventoryItemId: o.itemId ?? item.id, quantity: 2 }] }, who)
    requestIds.push(r.id)
    return r
  }
  const typeOf = async (id: number) => (await prisma.stockOutRequest.findUniqueOrThrow({ where: { id }, select: { subPurpose: true } })).subPurpose

  try {
    await createInventoryTransaction({ txType: 'IN', reasonId: inReason.id, itemId: item.id, warehouseId: wh.id, quantity: SERIALS.length, serials: SERIALS, lotBySerial: Object.fromEntries(SERIALS.map((x) => [x, 'SMOKE-TYPE'])), destination: 'SMOKE', note: 'SMOKE 요청 유형' }, actor.id)

    console.log('\n▶ ① 요청 유형 검증')
    try { await mk('XYZ'); check('잘못된 유형 → 거부', false) } catch (e) { check('잘못된 유형 → 거부', e instanceof StockOutCreateError, (e as Error).message) }
    try { await mk('POC'); check('데모(PoC) + 대웅제약재고 품목 → 거부', false) } catch (e) { check('데모(PoC) + 대웅제약재고 품목 → 거부(데모(PoC) 목록에 없음)', e instanceof StockOutCreateError && /대웅제약재고|데모\(PoC\)/.test((e as Error).message), (e as Error).message) }
    const poc = await mk('POC', { itemId: opsItem.id })
    check('데모(PoC) + 운영팀 재고 품목 → 생성, 유형 저장', (await typeOf(poc.id)) === 'POC')
    const pvPoc = await previewFulfillment(poc.id, {})
    check('데모(PoC) 요청 — 기기현황 등록 대상 없음(상품유형 판정 없음·선택 요구 없음)', !pvPoc.productType && !pvPoc.errors.some((e) => e.includes('일반형')), `${JSON.stringify(pvPoc.productType)} ${pvPoc.errors.join(' | ')}`)

    console.log('\n▶ ② 구축(라이트) → 라이트로 등록')
    const a = await mk('LITE')
    check('유형 저장 = LITE', (await typeOf(a.id)) === 'LITE')
    const linesA = [{ inventoryItemId: item.id, serials: SERIALS.slice(0, 2) }]
    let pv = await previewFulfillment(a.id, { lines: linesA })
    check('상품유형 = 라이트 · 출처 = 요청 유형 · 선택 불필요', pv.productType?.value === '라이트' && pv.productType.source === 'REQUEST' && pv.productType.requestKind === '구축(라이트)' && !pv.productType.needsChoice, JSON.stringify(pv.productType))
    const la = pv.lines.find((l) => l.inventoryItemId === item.id)
    check('혼합 계약 병원인데도 오류 없음 · L 품목 경고 없음(ok)', pv.ok && la?.status === 'ok' && la.registry === true, `ok=${pv.ok} ${la?.status} ${[...pv.errors, ...(la?.messages ?? [])].join(' | ')}`)
    pv = await previewFulfillment(a.id, { lines: linesA, productType: '일반' })
    check('요청 유형이 있으면 처리 화면 값은 무시(여전히 라이트)', pv.productType?.value === '라이트' && pv.productType.source === 'REQUEST')
    await prisma.stockOutRequest.update({ where: { id: a.id }, data: { fulfillDraft: { serialText: { [item.id]: SERIALS.slice(0, 2).join('\n') }, confirmed: [item.id] }, fulfillDraftAt: new Date() } })
    const resA = await executeFulfillment(a.id, { lines: linesA }, who)
    check('실행 성공 — 기기 2대 등록', resA.registered === 2, JSON.stringify(resA))
    const regA = await prisma.hospitalDevice.findMany({ where: { unit: { serialNo: { in: SERIALS.slice(0, 2) } } }, select: { status: true, hospitalCode: true, productType: true, dealCode: true } })
    check('등록 결과 — 그 병원 ACTIVE · 상품유형 라이트', regA.length === 2 && regA.every((d) => d.status === 'ACTIVE' && d.hospitalCode === hc && d.productType === '라이트'), JSON.stringify(regA))
    console.log(`     (등록된 계약건: ${regA.map((d) => d.dealCode ?? '없음').join(', ')})`)
    const afterA = await prisma.stockOutRequest.findUnique({ where: { id: a.id }, select: { fulfilledAt: true, fulfillDraft: true, fulfillDraftAt: true, status: { select: { name: true } } } })
    check('요청 완료 + 임시 저장분 비워짐', !!afterA?.fulfilledAt && afterA.status?.name === '완료' && afterA.fulfillDraft === null && afterA.fulfillDraftAt === null)
    const unitsA = await prisma.inventoryUnit.findMany({ where: { serialNo: { in: SERIALS.slice(0, 2) } }, select: { status: true } })
    check('재고 개체 출고됨(OUT)', unitsA.length === 2 && unitsA.every((u) => u.status === 'OUT'))

    console.log('\n▶ ③ 유형 없는 옛 요청 + 혼합 계약 병원 → 처리 화면에서 선택')
    const c = await mk(undefined)
    check('유형 없음(null)으로 저장', (await typeOf(c.id)) === null)
    const linesC = [{ inventoryItemId: item.id, serials: SERIALS.slice(2, 4) }]
    pv = await previewFulfillment(c.id, { lines: linesC })
    check('선택 필요 + 전역 오류(원인이 화면에 보임) + 실행 불가', pv.productType?.needsChoice === true && pv.productType.value === null && !pv.ok && pv.errors.some((e) => e.includes('일반형·라이트형')), `${JSON.stringify(pv.productType)} ${pv.errors.join(' | ')}`)
    try { await executeFulfillment(c.id, { lines: linesC }, who); check('미선택 실행 → 거부', false) } catch (e) { check('미선택 실행 → 거부(400)', e instanceof FulfillError && e.status === 400, (e as Error).message) }
    const unitsC = await prisma.inventoryUnit.findMany({ where: { serialNo: { in: SERIALS.slice(2, 4) } }, select: { status: true } })
    check('거부 뒤 재고 변동 없음(개체 2개 그대로 보유)', unitsC.length === 2 && unitsC.every((u) => u.status !== 'OUT'), JSON.stringify(unitsC))
    pv = await previewFulfillment(c.id, { lines: linesC, productType: '라이트' })
    check('라이트형을 고르면 통과 — 출처 = 처리 화면 선택', pv.ok && pv.productType?.value === '라이트' && pv.productType.source === 'CHOSEN', `${pv.ok} ${JSON.stringify(pv.productType)} ${pv.errors.join(' | ')}`)
    pv = await previewFulfillment(c.id, { lines: linesC, productType: '아무거나' })
    check('엉뚱한 값은 선택으로 치지 않음', !pv.ok && pv.productType?.value === null)

    console.log('\n▶ ④ 구축(일반) + L 품목 → 경고만, 일반으로 등록')
    const b = await mk('GENERAL')
    pv = await previewFulfillment(b.id, { lines: linesC })
    const lb = pv.lines.find((l) => l.inventoryItemId === item.id)
    check('경고(warning)지만 실행 가능', lb?.status === 'warning' && pv.ok && !!lb.messages.some((m) => m.includes('라이트용(L) 품목')), `${lb?.status} ok=${pv.ok} ${lb?.messages.join(' | ')}`)
    const resB = await executeFulfillment(b.id, { lines: linesC }, who)
    check('경고가 있어도 실행됨', resB.registered === 2)
    const regB = await prisma.hospitalDevice.findMany({ where: { unit: { serialNo: { in: SERIALS.slice(2, 4) } } }, select: { productType: true, dealCode: true } })
    check('등록 결과 — 상품유형 일반', regB.length === 2 && regB.every((d) => d.productType === '일반'), JSON.stringify(regB))

    console.log('\n▶ ⑤ 유형 없는 옛 요청 + 계약이 한 종류뿐인 병원 → 종전처럼 자동')
    if (singleProject && singleType) {
      const s = await mk(undefined, { projectCode: singleProject.projectCode })
      pv = await previewFulfillment(s.id, {})
      check(`병원 계약 기준(${singleType}) · 선택 불필요 · 관련 오류 없음`, pv.productType?.source === 'HOSPITAL' && pv.productType.value === singleType && !pv.productType.needsChoice && !pv.errors.some((e) => e.includes('일반형')), `${JSON.stringify(pv.productType)} ${pv.errors.join(' | ')}`)
    } else console.log('  (계약이 한 종류뿐인 병원의 프로젝트가 없어 건너뜀)')
    check('알림 로그 증가 없음(스모크는 lib 직접 호출)', (await prisma.notificationLog.count()) === notif0)
  } finally {
    // ── 원복
    const units = await prisma.deviceUnit.findMany({ where: { serialNo: { in: SERIALS } }, select: { id: true } })
    const ids = units.map((u) => u.id)
    await prisma.hospitalDeviceEvent.deleteMany({ where: { deviceId: { in: ids } } })
    await prisma.hospitalDevice.deleteMany({ where: { deviceId: { in: ids } } })
    await prisma.deviceUnit.deleteMany({ where: { id: { in: ids } } })
    const reqs = await prisma.stockOutRequest.findMany({ where: { id: { in: requestIds } }, select: { ticketId: true } })
    const newTx = await prisma.inventoryTransaction.findMany({ where: { id: { gt: maxTx }, itemId: item.id }, select: { id: true } })
    await prisma.inventoryTransactionUnit.deleteMany({ where: { transactionId: { in: newTx.map((t) => t.id) } } })
    await prisma.inventoryTransaction.deleteMany({ where: { id: { in: newTx.map((t) => t.id) } } })
    await prisma.inventoryUnit.deleteMany({ where: { serialNo: { in: SERIALS } } })
    await prisma.inventoryStock.deleteMany({ where: { itemId: item.id } })
    if (stockBefore.length) await prisma.inventoryStock.createMany({ data: stockBefore })
    await prisma.stockOutRequest.deleteMany({ where: { id: { in: requestIds } } })
    await prisma.ticket.deleteMany({ where: { id: { in: reqs.map((r) => r.ticketId).filter((v): v is number => !!v) } } })
    const left = (await prisma.deviceUnit.count({ where: { serialNo: { in: SERIALS } } })) + (await prisma.inventoryUnit.count({ where: { serialNo: { in: SERIALS } } }))
    const activeAfter = await prisma.hospitalDevice.count({ where: { hospitalCode: hc, status: 'ACTIVE' } })
    const stockAfter = await prisma.inventoryStock.findMany({ where: { itemId: item.id } })
    const same = JSON.stringify(stockAfter.map((s) => [s.warehouseId, s.lotNo, s.quantity]).sort()) === JSON.stringify(stockBefore.map((s) => [s.warehouseId, s.lotNo, s.quantity]).sort())
    const reqLeft = await prisma.stockOutRequest.count({ where: { note: 'SMOKE 요청 유형' } })
    console.log(`\n원복: 전표 ${newTx.length}건·요청 ${requestIds.length}건 삭제(잔여 ${reqLeft}), 테스트 시리얼 잔여 ${left}, 재고 ${same ? '원상' : '불일치!'}, 병원 ACTIVE 기기 ${activeBefore} → ${activeAfter}`)
    if (left || !same || activeBefore !== activeAfter || reqLeft) fail++
  }
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
