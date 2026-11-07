/**
 * AS접수 분할 스모크 (projects/as_receipt_split_design.md §12 P1)
 *  준비 — 테스트 병원(첫 병원)·기기 7대(병동 3곳) + 미등록 라인 1 → createAsReceipt(8라인) → 1라인 입고(INTAKE ref AS)·1라인 초안 → 원본 티켓 담당자 지정
 *  검증 400/403/409 8종 → 병동별 분할(2그룹) → 자식 코드·라인 이동·발송지·상태·담당자/티켓 이력·as_ref_code 정정·INTAKE ref 정정·비고·splitFromId
 *  → 자식에서 수리반환 확정(게이트 통과 → IN_USE·플래그 해제, 경고 0) → 구분별 분할(초안 해제 경고·분실 기본값) → 채널톡 diff 가족 합집합 → 종결 접수 409
 *  테스트 데이터는 전부 삭제한다.   npx tsx scripts/as-split-smoke.mts
 */
import { PrismaClient } from '@prisma/client'
import { createAsReceipt, splitAsReceipt, intakeAsLines, draftAsLines, resolveAsLines, AsServiceError } from '../lib/asReceiptService'
import { diffExtractAgainstReceipt } from '../lib/channeltalk/asIntake'
import type { AsExtract } from '../lib/channeltalk/asIntakeShared'
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

// A98xxxx 대역 — as-receipt-smoke(A99)와 분리
const W1 = ['A980001', 'A980002', 'A980003'], W2 = ['A980011', 'A980012'], W3 = ['A980021', 'A980022'], SX = 'A980901'
const ALL = [...W1, ...W2, ...W3]
const WARDS = ['SMOKE분할1병동', 'SMOKE분할2병동', 'SMOKE분할3병동']

async function cleanupRegistry(hospitalCode: string) {
  const units = await prisma.deviceUnit.findMany({ where: { serialNo: { in: ALL } }, select: { id: true } })
  const ids = units.map((u) => u.id)
  if (ids.length) {
    await prisma.hospitalDeviceEvent.deleteMany({ where: { OR: [{ deviceId: { in: ids } }, { relatedDeviceId: { in: ids } }] } })
    await prisma.hospitalDevice.deleteMany({ where: { deviceId: { in: ids } } })
    await prisma.deviceUnit.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.hospitalWard.deleteMany({ where: { hospitalCode, name: { in: WARDS } } }).catch(() => {})
}
const placement = (serial: string) => prisma.deviceUnit.findUnique({ where: { serialNo: serial }, select: { id: true, condition: true, placement: { select: { asStartedOn: true, asRefCode: true } } } })

async function main() {
  const receiptIds: number[] = []
  let hospitalCode = ''
  try {
    const hospital = await prisma.hospital.findFirst({ select: { hospitalCode: true, hospitalName: true }, orderBy: { id: 'asc' } })
    const model = await prisma.deviceInfo.findFirst({ where: { serialTracked: true, deviceClass: 'WEARABLE' }, select: { id: true } })
    const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true, name: true } })
    if (!hospital || !model || !user) throw new Error('병원/모델/사용자 없음')
    hospitalCode = hospital.hospitalCode
    const actor = { userId: user.id, name: user.name }
    await cleanupRegistry(hospitalCode)
    const items = [
      ...W1.map((s) => ({ serialInput: s, deviceInfoId: model.id, wardName: WARDS[0], productType: '일반' })),
      ...W2.map((s) => ({ serialInput: s, deviceInfoId: model.id, wardName: WARDS[1], productType: '일반' })),
      ...W3.map((s) => ({ serialInput: s, deviceInfoId: model.id, wardName: WARDS[2], productType: '일반' })),
    ]
    const reg = await registerDevices({ hospitalCode, actor, occurredOn: todayKst(), source: 'MANUAL', memo: '[SMOKE] 분할' }, items)
    check('테스트 기기 7대 등록', reg.created.length + reg.reregistered.length === 7)

    console.log('▶ 원본 접수 생성')
    const src = await createAsReceipt({
      hospitalCode, category: 'FAULT', receiptDate: new Date(todayKst()), pickupMethod: 'PARCEL', pickupTrackingNo: 'SMOKESPLIT001', destType: 'HOSPITAL', destInfo: '본관 1병동 간호사실 / 홍길동', priorityRepair: true,
      note: '[SMOKE] 분할 원본', lines: [...ALL.map((s) => ({ serial: s, symptom: '전원 불량' })), { serial: SX, wardName: WARDS[2], deviceKind: '심전도' }],
    }, { userId: user.id, name: user.name ?? '' })
    receiptIds.push(src.id)
    const srcRow = await prisma.asReceipt.findUniqueOrThrow({ where: { id: src.id }, include: { items: { orderBy: { id: 'asc' } }, ticket: true } })
    check('원본 8라인·티켓 생성', srcRow.items.length === 8 && !!srcRow.ticketId)
    await prisma.ticket.update({ where: { id: srcRow.ticketId! }, data: { ownerId: user.id } })
    const byS = new Map(srcRow.items.map((i) => [i.serialNo, i]))
    const id = (s: string) => byS.get(s)!.id
    // 등록 7대 입고(INTAKE 이벤트 ref AS 원본, 미등록 SX는 미입고) / 1라인 초안(W3[0]) 수리반환
    await intakeAsLines(src.id, actor, { serials: ALL })
    await draftAsLines(src.id, { lines: [{ itemId: id(W3[0]), outcome: 'REPAIR_RETURN' }] })
    const ev0 = await prisma.hospitalDeviceEvent.findMany({ where: { refType: 'AS', refCode: src.asCode }, select: { eventType: true } })
    check('원본 ref 이벤트 — AS_OPEN 7 + INTAKE 7', ev0.filter((e) => e.eventType === 'AS_OPEN').length === 7 && ev0.filter((e) => e.eventType === 'INTAKE').length === 7, JSON.stringify(ev0.map((e) => e.eventType)))

    console.log('▶ 검증 거부')
    await expectErr('V2 mode 잘못됨 400', () => splitAsReceipt(src.id, actor, { mode: 'X' as 'WARD', groups: [] }), 400)
    await expectErr('V2 그룹 없음 400', () => splitAsReceipt(src.id, actor, { mode: 'WARD', groups: [] }), 400)
    await expectErr('V5 구분별 그룹 2개 400', () => splitAsReceipt(src.id, actor, { mode: 'CATEGORY', groups: [{ key: 'a', itemIds: [id(W1[0])], category: 'LOST' }, { key: 'b', itemIds: [id(W1[1])], category: 'LOST' }] }), 400)
    await expectErr('V3 타 접수 라인 400', () => splitAsReceipt(src.id, actor, { mode: 'WARD', groups: [{ key: 'x', itemIds: [999999999] }] }), 400, '이 접수의 라인이')
    await expectErr('V2 중복 라인 400', () => splitAsReceipt(src.id, actor, { mode: 'WARD', groups: [{ key: 'a', itemIds: [id(W1[0])] }, { key: 'b', itemIds: [id(W1[0])] }] }), 400, '두 그룹')
    await expectErr('V4 전부 이동 400', () => splitAsReceipt(src.id, actor, { mode: 'WARD', groups: [{ key: 'all', itemIds: srcRow.items.map((i) => i.id) }] }), 400, '1개 이상 남아야')
    await expectErr('V5 같은 구분 400', () => splitAsReceipt(src.id, actor, { mode: 'CATEGORY', groups: [{ key: 'a', itemIds: [id(W1[0])], category: 'FAULT' }] }), 400)
    await expectErr('V1 없는 접수 404', () => splitAsReceipt(999999999, actor, { mode: 'WARD', groups: [{ key: 'a', itemIds: [1] }] }), 404)

    console.log('▶ 병동별 분할 — 2병동·3병동 분리, 1병동+미등록 잔류')
    const r1 = await splitAsReceipt(src.id, actor, { mode: 'WARD', groups: [
      { key: WARDS[1], itemIds: W2.map(id), destInfo: '별관 2병동 간호사실 / 김철수' },
      { key: WARDS[2], itemIds: [...W3.map(id), id(SX)] },
    ] })
    receiptIds.push(...r1.children.map((c) => c.id))
    check('자식 2건 생성·코드 형식', r1.children.length === 2 && r1.children.every((c) => /^AS-\d{6}-\d{4}$/.test(c.asCode)), JSON.stringify(r1.children))
    const [c1, c2] = r1.children
    const c1Row = await prisma.asReceipt.findUniqueOrThrow({ where: { id: c1.id }, include: { items: true, ticket: { include: { logs: true } } } })
    const c2Row = await prisma.asReceipt.findUniqueOrThrow({ where: { id: c2.id }, include: { items: true, ticket: true } })
    const srcAfter = await prisma.asReceipt.findUniqueOrThrow({ where: { id: src.id }, include: { items: true, ticket: { include: { logs: true } } } })
    check('라인 이동 — 자식1 2 · 자식2 3 · 원본 3', c1Row.items.length === 2 && c2Row.items.length === 3 && srcAfter.items.length === 3)
    check('라인 id 보존 (이동, 재생성 아님)', c1Row.items.every((i) => W2.map(id).includes(i.id)))
    check('입고 라인 상태 보존 (RECEIVED·미등록 MISMATCH)', c1Row.items.find((i) => i.serialNo === W2[0])?.intakeState === 'RECEIVED' && c2Row.items.find((i) => i.serialNo === SX)?.intakeState === 'MISMATCH')
    check('초안 보존 (병동 축은 초안 유지)', c2Row.items.find((i) => i.serialNo === W3[0])?.draftOutcome === 'REPAIR_RETURN')
    check('자식 발송지 — 그룹 값 / 미지정은 원본 값', c1Row.destInfo === '별관 2병동 간호사실 / 김철수' && c2Row.destInfo === srcRow.destInfo)
    check('자식 헤더 승계 — 상태(분할 시점 원본=입고)·수거·송장·태그·구분·splitFromId', c1Row.statusId === srcAfter.statusId && srcAfter.statusId !== srcRow.statusId && c1Row.pickupTrackingNo === 'SMOKESPLIT001' && c1Row.priorityRepair && c1Row.category === 'FAULT' && c1Row.splitFromId === src.id && c1Row.createdById === user.id)
    check('자식 티켓 — refType AS·담당자 승계·제목', c1Row.ticket?.refType === 'AS' && c1Row.ticket?.ownerId === user.id && !!c1Row.ticket?.title.startsWith('[AS접수·고장]'))
    check('자식 티켓 이력 split_from', c1Row.ticket?.logs.some((l) => l.logType === 'link' && (l.payload as { event?: string })?.event === 'split_from') === true)
    check('원본 티켓 이력 split_to (자식 2)', srcAfter.ticket?.logs.some((l) => l.logType === 'link' && ((l.payload as { children?: unknown[] })?.children?.length ?? 0) === 2) === true)
    check('비고 — 자식 분할 줄 · 원본 분할 줄', c1Row.note!.includes(`${src.asCode}에서 분리`) && srcAfter.note!.includes('병동별 분할') && srcAfter.note!.includes(c2.asCode))
    const pW2 = await placement(W2[1]), pW3 = await placement(W3[1]), pW1 = await placement(W1[0])
    check('as_ref_code 정정 — 이동 기기 → 자식 코드', pW2?.placement?.asRefCode === c1.asCode && pW3?.placement?.asRefCode === c2.asCode, `${pW2?.placement?.asRefCode} / ${pW3?.placement?.asRefCode}`)
    check('as_ref_code 유지 — 잔류 기기 = 원본 코드', pW1?.placement?.asRefCode === src.asCode)
    const intakeEv = await prisma.hospitalDeviceEvent.findFirst({ where: { eventType: 'INTAKE', deviceId: (await placement(W2[0]))!.id }, select: { refCode: true, editedAt: true } })
    check('INTAKE 이벤트 ref 정정 + edited_at 기록', intakeEv?.refCode === c1.asCode && !!intakeEv?.editedAt)
    check('원본 ref 이벤트 잔존 6 (W1 AS_OPEN·INTAKE)', (await prisma.hospitalDeviceEvent.count({ where: { refType: 'AS', refCode: src.asCode } })) === 6)

    console.log('▶ 자식에서 수리반환 확정 — 되돌림 게이트 통과')
    const res = await resolveAsLines(c1.id, actor, { lines: [{ itemId: c1Row.items.find((i) => i.serialNo === W2[1])!.id, outcome: 'REPAIR_RETURN' }], shipMethod: 'PARCEL', shipTrackingNo: 'SHIP1' })
    const pAfter = await placement(W2[1])
    check('게이트 통과 — 플래그 해제·IN_USE·경고 0', !pAfter?.placement?.asStartedOn && pAfter?.condition === 'IN_USE' && !res.warnings.some((w) => w.includes('다른 접수')), JSON.stringify(res.warnings))

    console.log('▶ 구분별 분할 — 원본 W1[0](초안 수리반환) → 분실')
    await draftAsLines(src.id, { lines: [{ itemId: id(W1[0]), outcome: 'REPAIR_RETURN' }] })
    const r2 = await splitAsReceipt(src.id, actor, { mode: 'CATEGORY', groups: [{ key: '분실', itemIds: [id(W1[0])], category: 'LOST' }] })
    receiptIds.push(...r2.children.map((c) => c.id))
    const c3Row = await prisma.asReceipt.findUniqueOrThrow({ where: { id: r2.children[0].id }, include: { items: true, ticket: true } })
    check('분실 자식 — 구분 LOST·수거없음·송장 NULL·티켓 제목 분실', c3Row.category === 'LOST' && c3Row.pickupMethod === 'NONE' && c3Row.pickupTrackingNo === null && !!c3Row.ticket?.title.startsWith('[AS접수·분실]'))
    check('허용되지 않는 초안(수리반환) 해제 + 경고', c3Row.items[0].draftOutcome === null && r2.warnings.some((w) => w.includes('초안 해제')), JSON.stringify(r2.warnings))

    console.log('▶ 채널톡 변경 감지 — 분할 가족 합집합')
    const extract = { category: 'FAULT', mixedCategory: false, destInfo: srcRow.destInfo, pickupDestInfo: null, pickupDestDiffers: false, preReplace: false, lines: [...ALL, SX].map((s) => ({ serial: s, symptom: '전원 불량', ward: null })) } as unknown as AsExtract
    const diff = await diffExtractAgainstReceipt(src.id, extract)
    check('원본 기준 diff에 시리얼 변경 없음 (자식 라인 포함)', !diff.some((d) => d.field === 'serials'), JSON.stringify(diff.map((d) => d.field)))

    console.log('▶ 종결 접수 409')
    const done = await prisma.statusCode.findFirst({ where: { category: 'AS_STATUS', name: '완료' }, select: { id: true } })
    await prisma.asReceipt.update({ where: { id: c2.id }, data: { statusId: done!.id } })
    await expectErr('종결(완료) 접수 분할 409', () => splitAsReceipt(c2.id, actor, { mode: 'WARD', groups: [{ key: 'x', itemIds: [c2Row.items[0].id] }] }), 409)
  } finally {
    console.log('▶ 정리')
    const rows = await prisma.asReceipt.findMany({ where: { id: { in: receiptIds } }, select: { id: true, ticketId: true } })
    await prisma.asReceipt.deleteMany({ where: { id: { in: receiptIds } } })
    await prisma.ticket.deleteMany({ where: { id: { in: rows.map((r) => r.ticketId).filter((v): v is number => !!v) } } })
    await prisma.auditLog.deleteMany({ where: { resource: 'as_receipt', resourceLabel: { contains: '[SMOKE]' } } }).catch(() => {})
    if (hospitalCode) await cleanupRegistry(hospitalCode)
    await prisma.$disconnect()
    console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
    if (fail) process.exit(1)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
