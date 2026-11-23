/**
 * 교체기 정정 · 교체 발송기기 입력 차단 스모크 (projects/as_replacement_correct_design.md)
 *  준비 — 첫 병원에 기기 5대 등록
 *  1) 입력 차단: 같은 접수의 다른 라인 시리얼·자기 시리얼·한 접수의 두 라인이 같은 교체기 → 초안 저장·확정 모두 400
 *  2) PROD AS-202611-0256 재현: 교체기 칸에 같은 접수의 수리반환 기기를 넣은 상태(차단 이전의 데이터)를 만들고 → 정정
 *     → 라인·구기기 회수 연결·맞는 교체기 배치가 바로잡히고, 잘못 적혔던 기기는 그대로
 *  3) 잘못 적은 시리얼로 새 기기가 등록된 경우 → 정정하면 그 배치가 사라지고 맞는 교체기가 배치됨. 다시 정정도 가능
 *  4) 잘못 적은 교체기에 그 뒤 다른 기록이 쌓인 경우 → 409, 아무것도 바뀌지 않음
 *  5) 미등록 라인 → 라인의 시리얼만 고침
 *  6) 거부: 교체 확정이 아닌 라인 · 같은 시리얼 · 다른 라인의 시리얼
 *  테스트 데이터는 전부 삭제한다.   npx tsx scripts/as-replacement-correct-smoke.mts
 */
import { PrismaClient } from '@prisma/client'
import { createAsReceipt, resolveAsLines, draftAsLines, correctAsLineReplacement, AsServiceError } from '../lib/asReceiptService'
import { registerDevices, replaceDevice } from '../lib/deviceRegistry/write'
import { todayKst } from '../lib/deviceRegistryShared'

const prisma = new PrismaClient()
let pass = 0, fail = 0
const check = (name: string, ok: boolean, note?: unknown) => { if (ok) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${note !== undefined ? ` — ${typeof note === 'string' ? note : JSON.stringify(note)}` : ''}`) } }
async function expectErr(name: string, fn: () => Promise<unknown>, status: number, includes?: string) {
  try { await fn(); check(name, false, '에러 없음') } catch (e) {
    const ok = e instanceof AsServiceError && e.status === status && (!includes || e.message.includes(includes))
    check(name, ok, e instanceof Error ? `${(e as AsServiceError).status ?? ''} ${e.message}` : String(e))
  }
}
// 병원에 등록해 두는 기기 / 교체기로 쓰는 시리얼 / 미등록 라인용
const A = 'A980001', B = 'A980002', C = 'A980003', D = 'A980004', E = 'A980005'
const RIGHT1 = 'A980101', WRONG2 = 'A980102', RIGHT2 = 'A980103', RIGHT2B = 'A980104', WRONG3 = 'A980105', RIGHT3 = 'A980106'
const UNREG = 'A980201', UNREG_NEW1 = 'A980202', UNREG_NEW2 = 'A980203'
const ALL = [A, B, C, D, E, RIGHT1, WRONG2, RIGHT2, RIGHT2B, WRONG3, RIGHT3, UNREG, UNREG_NEW1, UNREG_NEW2]
const WARD = 'SMOKE교체기정정병동'

async function cleanupRegistry(hospitalCode: string) {
  const units = await prisma.deviceUnit.findMany({ where: { serialNo: { in: ALL } }, select: { id: true } })
  const ids = units.map((u) => u.id)
  if (ids.length) {
    await prisma.hospitalDeviceEvent.deleteMany({ where: { OR: [{ deviceId: { in: ids } }, { relatedDeviceId: { in: ids } }] } })
    await prisma.hospitalDevice.deleteMany({ where: { deviceId: { in: ids } } })
    await prisma.deviceUnit.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.hospitalWard.deleteMany({ where: { hospitalCode, name: WARD } }).catch(() => {})
}
const unitOf = (serial: string) =>
  prisma.deviceUnit.findUnique({ where: { serialNo: serial }, select: { id: true, condition: true, locationHospitalCode: true, placement: { select: { status: true, hospitalCode: true, replacedById: true, dealCode: true, productType: true } } } })
const itemOf = (id: number) => prisma.asReceiptItem.findUniqueOrThrow({ where: { id } })
const eventsOf = async (serial: string, asCode: string) =>
  (await prisma.hospitalDeviceEvent.findMany({ where: { device: { serialNo: serial }, refType: 'AS', refCode: asCode }, select: { eventType: true, relatedDevice: { select: { serialNo: true } } }, orderBy: { id: 'asc' } })).map((e) => `${e.eventType}${e.relatedDevice ? `→${e.relatedDevice.serialNo}` : ''}`)

async function main() {
  const receiptIds: number[] = []
  let hospitalCode = ''
  try {
    const hospital = await prisma.hospital.findFirst({ select: { hospitalCode: true }, orderBy: { id: 'asc' } })
    const model = await prisma.deviceInfo.findFirst({ where: { serialTracked: true, deviceClass: 'WEARABLE', deviceName: { contains: '심전' } }, select: { id: true } })
    const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true, name: true } })
    if (!hospital || !model || !user) throw new Error('병원/모델/사용자 없음')
    hospitalCode = hospital.hospitalCode
    const actor = { userId: user.id, name: user.name }
    await cleanupRegistry(hospitalCode)
    const reg = await registerDevices({ hospitalCode, actor, occurredOn: todayKst(), source: 'MANUAL', memo: '[SMOKE] 교체기 정정' }, [A, B, C, D, E].map((s) => ({ serialInput: s, deviceInfoId: model.id, wardName: WARD, productType: '일반' })))
    check('테스트 기기 5대 등록', reg.created.length + reg.reregistered.length === 5, reg.skipped)
    const activeBase = await prisma.hospitalDevice.count({ where: { hospitalCode, status: 'ACTIVE' } })
    const base = { hospitalCode, receiptDate: new Date(todayKst()), destType: 'HOSPITAL', destInfo: '[SMOKE] 교체기 정정', note: '[SMOKE] 교체기 정정', category: 'FAULT', pickupMethod: 'PARCEL' } as const

    console.log('▶ 1) 교체 발송기기 입력 차단')
    const r1 = await createAsReceipt({ ...base, lines: [{ serial: A, symptom: '전원 불량' }, { serial: B, symptom: '충전 불량' }] }, actor)
    receiptIds.push(r1.id)
    const [iA, iB] = await prisma.asReceiptItem.findMany({ where: { receiptId: r1.id }, orderBy: { id: 'asc' } })
    await expectErr('초안: 같은 접수의 다른 라인 시리얼 → 400', () => draftAsLines(r1.id, { lines: [{ itemId: iA.id, outcome: 'REPLACE', newSerial: B }] }), 400, '다른 라인으로 접수된 기기')
    await expectErr('확정: 같은 접수의 다른 라인 시리얼 → 400', () => resolveAsLines(r1.id, actor, { lines: [{ itemId: iA.id, outcome: 'REPLACE', newSerial: B }] }), 400, '다른 라인으로 접수된 기기')
    await expectErr('확정: 접수된 기기와 같은 시리얼 → 400', () => resolveAsLines(r1.id, actor, { lines: [{ itemId: iA.id, outcome: 'REPLACE', newSerial: A }] }), 400)
    await expectErr('확정: 두 라인이 같은 교체기 → 400', () => resolveAsLines(r1.id, actor, { lines: [{ itemId: iA.id, outcome: 'REPLACE', newSerial: RIGHT1 }, { itemId: iB.id, outcome: 'REPLACE', newSerial: RIGHT1 }] }), 400, '이미 교체 발송기기로')
    await draftAsLines(r1.id, { lines: [{ itemId: iB.id, outcome: 'REPLACE', newSerial: RIGHT1 }] })
    await expectErr('초안: 다른 라인의 초안과 같은 교체기 → 400', () => draftAsLines(r1.id, { lines: [{ itemId: iA.id, outcome: 'REPLACE', newSerial: RIGHT1 }] }), 400, '이미 교체 발송기기로')
    await draftAsLines(r1.id, { lines: [{ itemId: iB.id, outcome: null }] })
    check('차단된 시도는 아무것도 남기지 않았다', (await itemOf(iA.id)).outcome === null && (await itemOf(iA.id)).draftOutcome === null && (await unitOf(A))?.placement?.status === 'ACTIVE')

    console.log('▶ 2) PROD AS-202611-0256 재현 — 교체기 칸에 같은 접수의 수리반환 기기')
    await resolveAsLines(r1.id, actor, { lines: [{ itemId: iB.id, outcome: 'REPAIR_RETURN' }], shipMethod: 'PARCEL' })
    // 차단이 생기기 전의 데이터 모양을 그대로 만든다: 구기기 A 를 교체기 B(이미 이 병원에서 사용 중)로 교체 기록
    const wrong = await replaceDevice({ hospitalCode, actor, occurredOn: todayKst(), source: 'MANUAL', ref: { type: 'AS', code: r1.asCode } }, { oldDeviceId: iA.deviceId!, newSerial: B, reasonCodeId: null })
    await prisma.asReceiptItem.update({ where: { id: iA.id }, data: { outcome: 'REPLACE', newSerialNo: B, newDeviceId: wrong.newDevice.id, shippedAt: new Date(todayKst()), shipMethod: 'PARCEL' } })
    const bBefore = await unitOf(B)
    check('재현 상태 — 구기기 회수·교체기 = 수리반환 기기', (await unitOf(A))?.placement?.replacedById === bBefore?.id && (await unitOf(A))?.placement?.status === 'RECOVERED')
    const c2 = await correctAsLineReplacement(r1.id, actor, { itemId: iA.id, newSerial: ` ${RIGHT1.toLowerCase()} `, reason: '교체기 시리얼 오입력' })
    const uA = await unitOf(A), uB = await unitOf(B), uR = await unitOf(RIGHT1)
    check('결과 반환 — 이전·새 시리얼, 기기현황 반영', c2.previousNewSerialNo === B && c2.newSerialNo === RIGHT1 && c2.registryChanged && c2.serialNo === A, c2)
    check('라인 — 교체기 시리얼·연결 기기 정정, 확정 상태·발송일 유지', (await itemOf(iA.id)).newSerialNo === RIGHT1 && (await itemOf(iA.id)).newDeviceId === uR?.id && (await itemOf(iA.id)).outcome === 'REPLACE' && !!(await itemOf(iA.id)).shippedAt)
    check('구기기 — 회수 상태, 연결된 교체기 = 맞는 기기', uA?.placement?.status === 'RECOVERED' && uA.placement.replacedById === uR?.id, uA)
    check('맞는 교체기 — 병원에 배치·사용 중, 상품유형 상속', uR?.placement?.status === 'ACTIVE' && uR.placement.hospitalCode === hospitalCode && uR.condition === 'IN_USE' && uR.placement.productType === '일반', uR)
    check('잘못 적혔던 기기 — 그대로 사용 중(변화 없음)', JSON.stringify(uB) === JSON.stringify(bBefore), { uB, bBefore })
    check('기기현황 기록 — 구기기 RECOVER→맞는 기기 1건뿐', JSON.stringify((await eventsOf(A, r1.asCode)).filter((e) => e.startsWith('RECOVER'))) === JSON.stringify([`RECOVER→${RIGHT1}`]), await eventsOf(A, r1.asCode))
    check('병원 사용 중 기기 수 — 그대로(구기기 −1, 교체기 +1)', (await prisma.hospitalDevice.count({ where: { hospitalCode, status: 'ACTIVE' } })) === activeBase)
    const note1 = (await prisma.asReceipt.findUniqueOrThrow({ where: { id: r1.id }, select: { note: true } })).note ?? ''
    check('비고 이력 — 정정 내용과 사유', note1.includes('[교체기 정정') && note1.includes(`${A}: ${B} → ${RIGHT1}`) && note1.includes('교체기 시리얼 오입력'), note1.slice(-120))

    console.log('▶ 3) 잘못 적은 시리얼로 새 기기가 등록된 경우 + 다시 정정')
    const r2 = await createAsReceipt({ ...base, lines: [{ serial: C, symptom: '센서 불량' }] }, actor)
    receiptIds.push(r2.id)
    const iC = await prisma.asReceiptItem.findFirstOrThrow({ where: { receiptId: r2.id } })
    await resolveAsLines(r2.id, actor, { lines: [{ itemId: iC.id, outcome: 'REPLACE', newSerial: WRONG2 }], shipMethod: 'PARCEL' })
    check('오입력 확정 — 잘못 적은 시리얼이 병원에 배치됨', (await unitOf(WRONG2))?.placement?.status === 'ACTIVE')
    await correctAsLineReplacement(r2.id, actor, { itemId: iC.id, newSerial: RIGHT2 })
    const uW2 = await unitOf(WRONG2), uR2 = await unitOf(RIGHT2), uC = await unitOf(C)
    check('정정 — 잘못 적은 기기의 배치가 사라짐', !uW2?.placement || uW2.placement.status !== 'ACTIVE', uW2)
    check('정정 — 맞는 교체기 배치, 구기기 연결', uR2?.placement?.status === 'ACTIVE' && uC?.placement?.replacedById === uR2.id && (await itemOf(iC.id)).newSerialNo === RIGHT2)
    await correctAsLineReplacement(r2.id, actor, { itemId: iC.id, newSerial: RIGHT2B, reason: '재정정' })
    check('다시 정정 — 직전 교체기 배치 해제, 새 교체기 배치', (await unitOf(RIGHT2))?.placement?.status !== 'ACTIVE' && (await unitOf(RIGHT2B))?.placement?.status === 'ACTIVE' && (await unitOf(C))?.placement?.replacedById === (await unitOf(RIGHT2B))?.id)
    check('병원 사용 중 기기 수 — 그대로', (await prisma.hospitalDevice.count({ where: { hospitalCode, status: 'ACTIVE' } })) === activeBase)

    console.log('▶ 4) 잘못 적은 교체기에 그 뒤 다른 기록이 쌓인 경우 → 막힘')
    const r3 = await createAsReceipt({ ...base, lines: [{ serial: D, symptom: '파손' }] }, actor)
    receiptIds.push(r3.id)
    const iD = await prisma.asReceiptItem.findFirstOrThrow({ where: { receiptId: r3.id } })
    await resolveAsLines(r3.id, actor, { lines: [{ itemId: iD.id, outcome: 'REPLACE', newSerial: WRONG3 }], shipMethod: 'PARCEL' })
    const r3b = await createAsReceipt({ ...base, lines: [{ serial: WRONG3, symptom: '교체기에 다른 접수' }] }, actor) // 잘못 적은 교체기에 새 AS 접수(이후 기록)
    receiptIds.push(r3b.id)
    const dBefore = JSON.stringify([await unitOf(D), await unitOf(WRONG3), await itemOf(iD.id)])
    await expectErr('이후 기록이 있으면 409', () => correctAsLineReplacement(r3.id, actor, { itemId: iD.id, newSerial: RIGHT3 }), 409, '교체기 정정 실패')
    check('막힌 정정은 아무것도 바꾸지 않았다', JSON.stringify([await unitOf(D), await unitOf(WRONG3), await itemOf(iD.id)]) === dBefore && !(await unitOf(RIGHT3)))

    console.log('▶ 5) 미등록 라인 — 라인의 시리얼만')
    const r4 = await createAsReceipt({ ...base, lines: [{ serial: UNREG, symptom: '미등록 기기' }, { serial: E, symptom: '대조용' }] }, actor)
    receiptIds.push(r4.id)
    const iU = await prisma.asReceiptItem.findFirstOrThrow({ where: { receiptId: r4.id, serialNo: UNREG } })
    const iE = await prisma.asReceiptItem.findFirstOrThrow({ where: { receiptId: r4.id, serialNo: E } })
    check('미등록 라인 준비', iU.deviceId === null)
    await resolveAsLines(r4.id, actor, { lines: [{ itemId: iU.id, outcome: 'REPLACE', newSerial: UNREG_NEW1 }], shipMethod: 'PARCEL' })
    const c5 = await correctAsLineReplacement(r4.id, actor, { itemId: iU.id, newSerial: UNREG_NEW2 })
    check('미등록 라인 — 시리얼만 고치고 기기현황은 건드리지 않음', !c5.registryChanged && (await itemOf(iU.id)).newSerialNo === UNREG_NEW2 && !(await unitOf(UNREG_NEW2)) && c5.warnings.some((w) => w.includes('미등록 라인')), c5)

    console.log('▶ 6) 거부')
    await expectErr('교체 확정이 아닌 라인 → 409', () => correctAsLineReplacement(r4.id, actor, { itemId: iE.id, newSerial: RIGHT3 }), 409, '교체로 확정된 라인만')
    await expectErr('지금과 같은 시리얼 → 400', () => correctAsLineReplacement(r2.id, actor, { itemId: iC.id, newSerial: RIGHT2B }), 400, '같습니다')
    await expectErr('같은 접수의 다른 라인 시리얼 → 400', () => correctAsLineReplacement(r1.id, actor, { itemId: iA.id, newSerial: B }), 400, '다른 라인으로 접수된 기기')
    await expectErr('빈 시리얼 → 400', () => correctAsLineReplacement(r1.id, actor, { itemId: iA.id, newSerial: '  ' }), 400)
    await expectErr('다른 접수의 라인 → 400', () => correctAsLineReplacement(r1.id, actor, { itemId: iC.id, newSerial: RIGHT3 }), 400, '이 접수의 라인이 아닙니다')
    await expectErr('없는 접수 → 404', () => correctAsLineReplacement(999999999, actor, { itemId: iA.id, newSerial: RIGHT3 }), 404)
  } finally {
    const rows = await prisma.asReceipt.findMany({ where: { id: { in: receiptIds } }, select: { id: true, ticketId: true, asCode: true } })
    await prisma.asReceipt.deleteMany({ where: { id: { in: receiptIds } } })
    await prisma.ticket.deleteMany({ where: { id: { in: rows.map((r) => r.ticketId).filter((v): v is number => !!v) } } })
    await prisma.auditLog.deleteMany({ where: { resource: 'as_receipt', OR: rows.map((r) => ({ resourceLabel: { startsWith: r.asCode } })) } }).catch(() => {})
    if (hospitalCode) await cleanupRegistry(hospitalCode)
    await prisma.$disconnect()
  }
  console.log(`\n결과: ${pass} pass / ${fail} fail`)
  process.exit(fail ? 1 : 0)
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(2) })
