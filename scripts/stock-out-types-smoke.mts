/**
 * 출고요청 유형 추가 스모크 (2026-11-18) — 임상연구용(CLINICAL)·유지보수(MAINTENANCE)·데모(PoC) 품목 목록
 *  ① 유형 정의: 납품처 유형 5종 순서·목적 자동(1개)·품목 목록(탭) 8종·제목에 목적 중복 없음
 *  ② 임상연구용: 납품처로 요청(프로젝트 없음) / 프로젝트 연결(납품처 없음) 둘 다 생성 — 품목은 '임상연구용' 목록 공용
 *  ③ 유지보수: 납품처로 요청 — 프로젝트만 주면 거부(납품처 필수), 목록에 없는 품목 거부
 *  ④ 데모(PoC): '데모(PoC)' 목록 기준 — 목록에서 뺀 품목은 구축 목록에 있어도 거부, 대웅제약재고 품목은 목록에 없음
 *  ⑤ DB 제약: 유지보수+프로젝트·임상연구용 납품처/프로젝트 둘 다 없음 → 거부
 *  테스트용 목록 체크(임상연구용·유지보수 각 1품목)·요청·티켓은 전부 원복.   npx tsx scripts/stock-out-types-smoke.mts   (DEV 전용)
 */
import { PrismaClient } from '@prisma/client'
import { createStockOutRequest, StockOutCreateError } from '../lib/stockOutCreate'
import {
  STOCK_OUT_SALES_TYPES, STOCK_OUT_SUB_PURPOSES, STOCK_OUT_ITEM_LISTS, STOCK_OUT_ITEM_LIST_LABELS, STOCK_OUT_PROJECT_TYPES,
  stockOutItemListOf, stockOutProjectTypeOf, stockOutKindLabel, stockOutTitle, isStockOutDestMode, stockOutProductTypeOf,
} from '../lib/stockOutShared'

if (process.cwd().includes('thynC-Ops-PROD')) throw new Error('DEV 전용')
const prisma = new PrismaClient()
let pass = 0, fail = 0
const check = (name: string, ok: boolean, note?: string) => { if (ok) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${note ? ` — ${note}` : ''}`) } }
const NOTE = 'SMOKE 유형 추가'

async function main() {
  console.log('▶ ① 유형 정의')
  check('납품처 유형 = 평가용·판매용·오산영업소·임상연구용·유지보수', STOCK_OUT_SALES_TYPES.join(',') === 'EVALUATION,SALES,OSAN_OFFICE,CLINICAL,MAINTENANCE')
  check('임상연구용 목적 1개(임상연구) · 유지보수 목적 1개(유지보수)', STOCK_OUT_SUB_PURPOSES.CLINICAL.length === 1 && STOCK_OUT_SUB_PURPOSES.CLINICAL[0].label === '임상연구' && STOCK_OUT_SUB_PURPOSES.MAINTENANCE.length === 1 && STOCK_OUT_SUB_PURPOSES.MAINTENANCE[0].label === '유지보수')
  check('품목 목록(탭) 8종 — 데모(PoC)·임상연구용 포함', STOCK_OUT_ITEM_LISTS.length === 8 && STOCK_OUT_ITEM_LIST_LABELS.POC === '데모(PoC)' && STOCK_OUT_ITEM_LIST_LABELS.CLINICAL === '임상연구용')
  check('목록 선택: 데모(PoC)만 전용 목록, 구축(일반·라이트)=구축, 임상연구용=임상연구용', stockOutItemListOf('BUILD', 'POC') === 'POC' && stockOutItemListOf('BUILD', 'GENERAL') === 'BUILD' && stockOutItemListOf('BUILD', null) === 'BUILD' && stockOutItemListOf('CLINICAL', 'CLINICAL_RESEARCH') === 'CLINICAL' && stockOutItemListOf('MAINTENANCE', 'MAINTENANCE') === 'MAINTENANCE')
  check('프로젝트 폼 칩 4종 · 저장값 → 칩', STOCK_OUT_PROJECT_TYPES.join(',') === 'GENERAL,LITE,POC,CLINICAL' && stockOutProjectTypeOf('CLINICAL', 'CLINICAL_RESEARCH') === 'CLINICAL' && stockOutProjectTypeOf('BUILD', 'POC') === 'POC' && stockOutProjectTypeOf('BUILD', null) === null)
  check('표시: 임상연구용 · 제목에 목적 중복 없음', stockOutKindLabel('CLINICAL', 'CLINICAL_RESEARCH') === '임상연구용' && stockOutTitle({ purpose: 'MAINTENANCE', subPurpose: 'MAINTENANCE', destType: 'OTHER', destText: 'A사' }) === '유지보수 A사' && stockOutTitle({ purpose: 'CLINICAL', subPurpose: 'CLINICAL_RESEARCH', destType: 'OTHER', destText: 'B대학' }) === '임상연구용 B대학' && stockOutTitle({ purpose: 'EVALUATION', subPurpose: 'DEMO', destType: 'OTHER', destText: 'C' }) === '평가용·데모 C')
  check('납품처 형태 판정 · 임상연구용은 기기 상품유형을 정하지 않음', isStockOutDestMode('CLINICAL', null) && !isStockOutDestMode('CLINICAL', 'PRJ-1') && isStockOutDestMode('MAINTENANCE', null) && !isStockOutDestMode('BUILD', 'PRJ-1') && stockOutProductTypeOf('CLINICAL', 'CLINICAL_RESEARCH') === null)

  const actor = await prisma.user.findFirstOrThrow({ where: { name: '이준호' }, select: { id: true, name: true } })
  const who = { userId: actor.id, name: actor.name }
  const project = await prisma.project.findFirstOrThrow({ orderBy: { id: 'desc' }, select: { projectCode: true, projectName: true, hospitalCode: true } })
  const hospital = await prisma.hospital.findFirstOrThrow({ orderBy: { id: 'asc' }, select: { hospitalCode: true, hospitalName: true } })
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  // 구축·데모 목록에 함께 있는 운영팀 재고 품목 2개 (하나는 테스트 중 데모 목록에서 잠깐 뺀다)
  const opsItems = await prisma.inventoryItem.findMany({
    where: { isActive: true, stockOutKind: { is: null }, inventory: { name: 'thynC운영팀재고' }, AND: [{ stockOutPurposes: { some: { purpose: 'BUILD' } } }, { stockOutPurposes: { some: { purpose: 'POC' } } }] },
    orderBy: { id: 'asc' }, take: 2, select: { id: true, name: true },
  })
  const dwItem = await prisma.inventoryItem.findFirstOrThrow({ where: { isActive: true, stockOutKind: { is: null }, inventory: { name: '대웅제약재고' }, stockOutPurposes: { some: { purpose: 'BUILD' } }, stockOutComponents: { none: {} } }, select: { id: true, name: true } })
  if (opsItems.length < 2) { console.log('구축·데모 목록에 함께 있는 운영팀 재고 품목이 2개 미만 — 중단'); process.exit(1) }
  const [itA, itB] = opsItems
  console.log(`프로젝트 ${project.projectCode} · 납품처 병원 ${hospital.hospitalName} · 품목 ${itA.name} / ${itB.name} · 대웅 ${dwItem.name}`)

  const pre = await prisma.stockOutItemPurpose.findMany({ where: { purpose: { in: ['CLINICAL', 'MAINTENANCE'] }, inventoryItemId: itA.id } })
  if (pre.length) { console.log('테스트 품목이 이미 임상연구용/유지보수 목록에 있습니다 — 중단(원복 시 지워질 수 있음)'); process.exit(1) }
  const notif0 = await prisma.notificationLog.count()
  const pocCount0 = await prisma.stockOutItemPurpose.count({ where: { purpose: 'POC' } })
  const requestIds: number[] = []
  const dest = { destType: 'HOSPITAL', destHospitalCode: hospital.hospitalCode, shipAddress: '서울시 테스트로 1', recipient: '홍길동 / 010-0000-0000' }
  const mk = async (body: Record<string, unknown>) => {
    const r = await createStockOutRequest({ requestDate: today, note: NOTE, items: [{ inventoryItemId: itA.id, quantity: 1 }], ...body }, who)
    requestIds.push(r.id)
    return prisma.stockOutRequest.findUniqueOrThrow({ where: { id: r.id }, select: { id: true, purpose: true, subPurpose: true, projectCode: true, destType: true, destHospitalCode: true, ticketId: true, ticket: { select: { title: true, hospitalCode: true } } } })
  }
  const rejects = async (name: string, body: Record<string, unknown>, re: RegExp) => {
    try { await mk(body); check(name, false, '생성됨') } catch (e) { check(name, e instanceof StockOutCreateError && re.test((e as Error).message), (e as Error).message) }
  }

  try {
    console.log('\n▶ ② 임상연구용')
    await rejects('목록에 품목이 없으면 거부(설정에서 체크해야 함)', { purpose: 'CLINICAL', ...dest }, /임상연구용.*노출되지 않은/)
    await prisma.stockOutItemPurpose.createMany({ data: [{ inventoryItemId: itA.id, purpose: 'CLINICAL' }, { inventoryItemId: itA.id, purpose: 'MAINTENANCE' }] })
    const c1 = await mk({ purpose: 'CLINICAL', ...dest })
    check('납품처로 요청 — 프로젝트 없음 · 목적 자동(임상연구) · 납품처 병원', c1.purpose === 'CLINICAL' && c1.subPurpose === 'CLINICAL_RESEARCH' && c1.projectCode === null && c1.destType === 'HOSPITAL' && c1.destHospitalCode === hospital.hospitalCode, JSON.stringify(c1))
    check('연결 티켓 생성 — 제목 "임상연구용 <병원>" · 병원 = 납품처', !!c1.ticketId && c1.ticket?.title?.includes(`임상연구용 ${hospital.hospitalName}`) === true && c1.ticket?.hospitalCode === hospital.hospitalCode, JSON.stringify(c1.ticket))
    const c2 = await mk({ purpose: 'CLINICAL', projectCode: project.projectCode })
    check('프로젝트 연결 — 납품처 없음 · 목적 자동 · 같은 목록 사용', c2.purpose === 'CLINICAL' && c2.subPurpose === 'CLINICAL_RESEARCH' && c2.projectCode === project.projectCode && c2.destType === null, JSON.stringify(c2))
    check('프로젝트 연결 티켓 — 병원 = 프로젝트 병원', !!c2.ticketId && c2.ticket?.hospitalCode === project.hospitalCode, JSON.stringify(c2.ticket))
    await rejects('납품처도 프로젝트도 없으면 거부', { purpose: 'CLINICAL' }, /납품처/)
    await rejects('임상연구용 목록에 없는 품목 거부', { purpose: 'CLINICAL', ...dest, items: [{ inventoryItemId: itB.id, quantity: 1 }] }, /임상연구용.*노출되지 않은/)

    console.log('\n▶ ③ 유지보수')
    const m1 = await mk({ purpose: 'MAINTENANCE', destType: 'OTHER', destText: '테스트 납품처', shipAddress: '주소', recipient: '수취인' })
    check('납품처(기타)로 요청 — 프로젝트 없음 · 목적 자동(유지보수) · 제목 "유지보수 테스트 납품처"', m1.purpose === 'MAINTENANCE' && m1.subPurpose === 'MAINTENANCE' && m1.projectCode === null && m1.destType === 'OTHER' && m1.ticket?.title?.includes('유지보수 테스트 납품처') === true, JSON.stringify(m1))
    await rejects('프로젝트만 주면 거부 — 유지보수는 납품처 필수', { purpose: 'MAINTENANCE', projectCode: project.projectCode }, /납품처/)
    await rejects('수령지 없으면 거부', { purpose: 'MAINTENANCE', destType: 'OTHER', destText: 'X', recipient: 'Y' }, /수령지/)
    await rejects('유지보수 목록에 없는 품목 거부', { purpose: 'MAINTENANCE', ...dest, items: [{ inventoryItemId: itB.id, quantity: 1 }] }, /유지보수.*노출되지 않은/)

    console.log('\n▶ ④ 데모(PoC) 품목 목록')
    const dwInPoc = await prisma.stockOutItemPurpose.count({ where: { purpose: 'POC', item: { inventory: { name: '대웅제약재고' } } } })
    const buildOps = await prisma.stockOutItemPurpose.count({ where: { purpose: 'BUILD', item: { inventory: { name: { not: '대웅제약재고' } } } } })
    check(`초기 목록 = 구축 목록 중 대웅제약재고 제외(${buildOps}종) · 대웅제약재고 0`, pocCount0 === buildOps && dwInPoc === 0, `POC ${pocCount0} / 구축(대웅 외) ${buildOps} / 대웅 ${dwInPoc}`)
    const p1 = await mk({ purpose: 'BUILD', subPurpose: 'POC', projectCode: project.projectCode, items: [{ inventoryItemId: itB.id, quantity: 1 }] })
    check('데모(PoC) 목록 품목으로 생성 — purpose BUILD + 유형 POC', p1.purpose === 'BUILD' && p1.subPurpose === 'POC')
    await rejects('대웅제약재고 품목 거부', { purpose: 'BUILD', subPurpose: 'POC', projectCode: project.projectCode, items: [{ inventoryItemId: dwItem.id, quantity: 1 }] }, /데모\(PoC\)|대웅제약재고/)
    await prisma.stockOutItemPurpose.delete({ where: { inventoryItemId_purpose: { inventoryItemId: itB.id, purpose: 'POC' } } })
    await rejects('데모(PoC) 목록에서 뺀 품목은 구축 목록에 있어도 데모로는 거부', { purpose: 'BUILD', subPurpose: 'POC', projectCode: project.projectCode, items: [{ inventoryItemId: itB.id, quantity: 1 }] }, /데모\(PoC\).*노출되지 않은/)
    const g1 = await mk({ purpose: 'BUILD', subPurpose: 'GENERAL', projectCode: project.projectCode, items: [{ inventoryItemId: itB.id, quantity: 1 }] })
    check('같은 품목이 구축(일반)으로는 그대로 생성(구축 목록은 영향 없음)', g1.subPurpose === 'GENERAL')
    await prisma.stockOutItemPurpose.create({ data: { inventoryItemId: itB.id, purpose: 'POC' } })

    console.log('\n▶ ⑤ DB 제약')
    const raw = async (name: string, sql: string) => {
      try { await prisma.$executeRawUnsafe(sql); check(name, false, '통과됨') } catch (e) { check(name, /stock_out_requests_kind_check|stock_out_item_purposes_purpose_check|stock_out_requests_purpose_check/.test(String(e)), String(e).slice(0, 120)) }
    }
    await raw('유지보수 요청에 프로젝트를 붙이면 거부', `UPDATE stock_out_requests SET project_code = '${project.projectCode}' WHERE id = ${m1.id}`)
    await raw('임상연구용 — 프로젝트와 납품처 둘 다 있으면 거부', `UPDATE stock_out_requests SET project_code = '${project.projectCode}' WHERE id = ${c1.id}`)
    await raw('임상연구용 — 프로젝트도 납품처도 없으면 거부', `UPDATE stock_out_requests SET project_code = NULL WHERE id = ${c2.id}`)
    await raw('정의되지 않은 품목 목록 거부', `INSERT INTO stock_out_item_purposes (inventory_item_id, purpose) VALUES (${itA.id}, 'UNKNOWN')`)
    check('알림 로그 증가 없음(스모크는 lib 직접 호출)', (await prisma.notificationLog.count()) === notif0)
  } finally {
    const reqs = await prisma.stockOutRequest.findMany({ where: { id: { in: requestIds } }, select: { ticketId: true } })
    await prisma.stockOutRequest.deleteMany({ where: { id: { in: requestIds } } })
    await prisma.ticket.deleteMany({ where: { id: { in: reqs.map((r) => r.ticketId).filter((v): v is number => !!v) } } })
    await prisma.stockOutItemPurpose.deleteMany({ where: { inventoryItemId: itA.id, purpose: { in: ['CLINICAL', 'MAINTENANCE'] } } })
    await prisma.stockOutItemPurpose.createMany({ data: [{ inventoryItemId: itB.id, purpose: 'POC' }], skipDuplicates: true })
    const left = await prisma.stockOutRequest.count({ where: { note: NOTE } })
    const pocCount1 = await prisma.stockOutItemPurpose.count({ where: { purpose: 'POC' } })
    const extra = await prisma.stockOutItemPurpose.count({ where: { purpose: { in: ['CLINICAL', 'MAINTENANCE'] } } })
    console.log(`\n원복: 요청 ${requestIds.length}건 삭제(잔여 ${left}), 데모(PoC) 목록 ${pocCount0} → ${pocCount1}, 임상연구용·유지보수 목록 ${extra}건`)
    if (left || pocCount0 !== pocCount1 || extra) fail++
  }
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
