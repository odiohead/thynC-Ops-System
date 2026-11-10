/**
 * 분실기기 되찾음 스모크 (projects/as_lost_found_design.md §5)
 *  준비 — 첫 병원에 기기 2대 등록(A970001 분실 대상, A970002 고장 대조용) → 분실 접수(라인 A970001) · 고장 접수(라인 A970002)
 *  → 분실 라인 교체 확정(신 시리얼 A970101 → 원장 교체: 구기기 RECOVER(LOST)·신기기 REGISTER) → 한도 분자 n(병원 블록 = 접수 상세)
 *  → 거부 5종(고장 접수 400 · 미종결 라인 400 · 미래 날짜 400 · 없는 라인 404 · 교체기기 타 병원 배치 409는 생략)
 *  → 되찾음 → 라인 FOUND·found_at·회수 송장 / 되찾은 기기 IN_USE·ACTIVE·지정 병동 / 교체기기 RECOVERED·RECOVER(RETURN, related) / 한도 n−1(두 화면 동일) / 비고
 *  → 재되찾음 409 · 회수기기 처리 대상 제외
 *  테스트 데이터는 전부 삭제한다.   npx tsx scripts/as-found-smoke.mts
 */
import { PrismaClient } from '@prisma/client'
import { createAsReceipt, resolveAsLines, markAsLineFound, AsServiceError } from '../lib/asReceiptService'
import { computeAsLostQuota } from '../lib/asLostQuota'
import { getHospitalAsSummary } from '../lib/asHospitalSummary'
import { canMarkAsLineFound, canMarkAsLineRepaired } from '../lib/asReceiptShared'
import { registerDevices } from '../lib/deviceRegistry/write'
import { todayKst } from '../lib/deviceRegistryShared'

const prisma = new PrismaClient()
let pass = 0, fail = 0
const check = (name: string, ok: boolean, note?: string) => { if (ok) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${note ? ` — ${note}` : ''}`) } }
async function expectErr(name: string, fn: () => Promise<unknown>, status: number, includes?: string) {
  try { await fn(); check(name, false, '에러 없음') } catch (e) {
    const ok = e instanceof AsServiceError && e.status === status && (!includes || e.message.includes(includes))
    check(name, ok, e instanceof Error ? `${(e as AsServiceError).status ?? ''} ${e.message}` : String(e))
  }
}
const LOST_S = 'A970001', FAULT_S = 'A970002', NEW_S = 'A970101'
const ALL = [LOST_S, FAULT_S, NEW_S]
const WARD = 'SMOKE되찾음병동', WARD2 = 'SMOKE되찾음복귀병동'

async function cleanupRegistry(hospitalCode: string) {
  const units = await prisma.deviceUnit.findMany({ where: { serialNo: { in: ALL } }, select: { id: true } })
  const ids = units.map((u) => u.id)
  if (ids.length) {
    await prisma.hospitalDeviceEvent.deleteMany({ where: { OR: [{ deviceId: { in: ids } }, { relatedDeviceId: { in: ids } }] } })
    await prisma.hospitalDevice.deleteMany({ where: { deviceId: { in: ids } } })
    await prisma.deviceUnit.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.hospitalWard.deleteMany({ where: { hospitalCode, name: { in: [WARD, WARD2] } } }).catch(() => {})
}
const unitOf = (serial: string) => prisma.deviceUnit.findUnique({ where: { serialNo: serial }, select: { id: true, condition: true, placement: { select: { status: true, hospitalCode: true, ward: { select: { name: true } } } } } })
const lostN = (q: Awaited<ReturnType<typeof computeAsLostQuota>>) => q.groups.find((g) => g.group === '심전계')!

async function main() {
  const receiptIds: number[] = []
  let hospitalCode = ''
  try {
    const hospital = await prisma.hospital.findFirst({ select: { hospitalCode: true, hospitalName: true }, orderBy: { id: 'asc' } })
    const model = await prisma.deviceInfo.findFirst({ where: { serialTracked: true, deviceClass: 'WEARABLE', deviceName: { contains: '심전' } }, select: { id: true } })
    const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true, name: true } })
    if (!hospital || !model || !user) throw new Error('병원/모델/사용자 없음')
    hospitalCode = hospital.hospitalCode
    const actor = { userId: user.id, name: user.name }
    await cleanupRegistry(hospitalCode)
    const reg = await registerDevices({ hospitalCode, actor, occurredOn: todayKst(), source: 'MANUAL', memo: '[SMOKE] 되찾음' }, [LOST_S, FAULT_S].map((s) => ({ serialInput: s, deviceInfoId: model.id, wardName: WARD, productType: '일반' })))
    check('테스트 기기 2대 등록', reg.created.length + reg.reregistered.length === 2, JSON.stringify(reg.skipped))

    const base = { hospitalCode, receiptDate: new Date(todayKst()), destType: 'HOSPITAL', destInfo: '[SMOKE] 되찾음', note: '[SMOKE] 되찾음' } as const
    const lost = await createAsReceipt({ ...base, category: 'LOST', pickupMethod: 'NONE', lines: [{ serial: LOST_S, symptom: '분실' }] }, actor)
    const fault = await createAsReceipt({ ...base, category: 'FAULT', pickupMethod: 'PARCEL', lines: [{ serial: FAULT_S, symptom: '전원 불량' }] }, actor)
    receiptIds.push(lost.id, fault.id)
    const lostItem = await prisma.asReceiptItem.findFirstOrThrow({ where: { receiptId: lost.id } })
    const faultItem = await prisma.asReceiptItem.findFirstOrThrow({ where: { receiptId: fault.id } })

    const q0 = lostN(await computeAsLostQuota({ id: lost.id, hospitalCode }))
    check('확정 전 — 미종결 1대는 thisReceipt(처리 시)로만, 분실 수량 불변', q0.thisReceipt === 1 && q0.after === q0.before + 1)
    const baseline = q0.before // 병원의 기존 분실 수량

    console.log('▶ 되찾음 거부 — 미종결 라인')
    await expectErr('미종결 라인 400', () => markAsLineFound(lost.id, actor, { itemId: lostItem.id }), 400, '교체 확정 라인만')

    console.log('▶ 분실 라인 교체 확정 (신 시리얼 등록)')
    const r1 = await resolveAsLines(lost.id, actor, { lines: [{ itemId: lostItem.id, outcome: 'REPLACE', newSerial: NEW_S }], shipMethod: 'PARCEL', shipTrackingNo: 'SMOKEFOUND1' })
    const li = await prisma.asReceiptItem.findUniqueOrThrow({ where: { id: lostItem.id } })
    const uLost = await unitOf(LOST_S), uNew = await unitOf(NEW_S)
    check('교체 확정 — 라인 REPLACE·newDeviceId, 구기기 LOST·회수, 신기기 ACTIVE', li.outcome === 'REPLACE' && !!li.newDeviceId && uLost?.condition === 'LOST' && uLost.placement?.status === 'RECOVERED' && uNew?.placement?.status === 'ACTIVE', JSON.stringify({ li: li.outcome, lost: uLost, new: uNew, w: r1.warnings }))
    check('되찾음 가능 판정(canMarkAsLineFound)', canMarkAsLineFound('LOST', li))
    const q1 = lostN(await computeAsLostQuota({ id: lost.id, hospitalCode }))
    const h1 = (await getHospitalAsSummary(hospitalCode)).lostQuota.groups.find((g) => g.group === '심전계')!
    check('확정 후 — 분실 수량 +1, 접수 상세 = 병원 블록', q1.before === baseline + 1 && q1.thisReceipt === 0 && h1.before === q1.before, `detail=${q1.before} block=${h1.before} base=${baseline}`)

    console.log('▶ 되찾음 거부들')
    await expectErr('고장 접수 400', () => markAsLineFound(fault.id, actor, { itemId: faultItem.id }), 400, '분실 접수')
    await expectErr('미래 날짜 400', () => markAsLineFound(lost.id, actor, { itemId: lostItem.id, foundAt: '2099-01-01' }), 400, '미래')
    await expectErr('없는 라인 404', () => markAsLineFound(lost.id, actor, { itemId: 999999999 }), 404)

    console.log('▶ 되찾음')
    const f = await markAsLineFound(lost.id, actor, { itemId: lostItem.id, wardName: WARD2, recallTrackingNo: 'RECALL-001', memo: '병동 창고에서 발견' })
    const li2 = await prisma.asReceiptItem.findUniqueOrThrow({ where: { id: lostItem.id } })
    check('라인 FOUND·found_at·회수 송장·교체 이력 보존', li2.outcome === 'FOUND' && !!li2.foundAt && li2.foundById === user.id && li2.recallTrackingNo === 'RECALL-001' && li2.newSerialNo === NEW_S && li2.newDeviceId === li.newDeviceId, JSON.stringify({ o: li2.outcome, f: li2.foundAt, t: li2.recallTrackingNo }))
    const uLost2 = await unitOf(LOST_S), uNew2 = await unitOf(NEW_S)
    check('되찾은 기기 IN_USE·ACTIVE·복귀 병동', uLost2?.condition === 'IN_USE' && uLost2.placement?.status === 'ACTIVE' && uLost2.placement.hospitalCode === hospitalCode && uLost2.placement.ward?.name === WARD2, JSON.stringify(uLost2))
    check('교체기기 회수(RECOVERED)', uNew2?.placement?.status === 'RECOVERED', JSON.stringify(uNew2))
    const recEv = await prisma.hospitalDeviceEvent.findFirst({ where: { deviceId: uNew2!.id, eventType: 'RECOVER' }, orderBy: { id: 'desc' }, select: { refCode: true, relatedDeviceId: true, reasonCode: { select: { value: true } } } })
    check('교체기기 RECOVER 이벤트 — ref 접수·사유 RETURN·related = 되찾은 기기', recEv?.refCode === lost.asCode && recEv?.relatedDeviceId === uLost2!.id && recEv?.reasonCode?.value === 'RETURN', JSON.stringify(recEv))
    const regEv = await prisma.hospitalDeviceEvent.findFirst({ where: { deviceId: uLost2!.id, eventType: 'REGISTER' }, orderBy: { id: 'desc' }, select: { refCode: true, memo: true } })
    check('되찾은 기기 REGISTER(재배치) 이벤트 — ref 접수', regEv?.refCode === lost.asCode, JSON.stringify(regEv))
    const q2 = lostN(await computeAsLostQuota({ id: lost.id, hospitalCode }))
    const h2 = (await getHospitalAsSummary(hospitalCode)).lostQuota.groups.find((g) => g.group === '심전계')!
    check('되찾음 후 — 분실 수량 −1(기준선 복귀), 두 화면 동일', q2.before === baseline && h2.before === baseline, `detail=${q2.before} block=${h2.before} base=${baseline}`)
    const note = (await prisma.asReceipt.findUniqueOrThrow({ where: { id: lost.id }, select: { note: true } })).note ?? ''
    check('비고 이력 기록', note.includes('[되찾음') && note.includes(NEW_S) && note.includes('RECALL-001') && note.includes(WARD2), note.slice(-160))
    check('되찾음 라인은 회수기기 처리 대상 아님', !canMarkAsLineRepaired({ intakeState: 'RECEIVED', outcome: 'FOUND' }))
    check('결과 반환 형상', f.serialNo === LOST_S && f.newSerialNo === NEW_S && f.wardName === WARD2)

    console.log('▶ 재되찾음 409')
    await expectErr('이미 되찾음 409', () => markAsLineFound(lost.id, actor, { itemId: lostItem.id }), 409, '이미 되찾음')
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
