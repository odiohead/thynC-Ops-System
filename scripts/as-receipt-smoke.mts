/**
 * AS업무(AS접수) 스모크 (as_work_design.md §10)
 *
 * 검증:
 *  마스터 — AS_STATUS 8종 매핑(접수 OPEN·수거중/입고/발송/발송완료 IN_PROGRESS·보류 PENDING·완료/취소 CLOSED)·규칙·LOST 사유
 *  레지스트리 — 어댑터 8종·detailInclude에 asReceipt·REGISTRY_REF_TYPES 'AS'·refLink
 *  생성 — AS 코드 형식·매칭(ACTIVE_HERE/NONE)·레코드+라인+티켓(refType AS·제목·병원)·AS 표시(asRefCode)·중복 표시 경고
 *  도메인→티켓 — 수거중 IN_PROGRESS / 보류 PENDING / 접수 OPEN
 *  라인 처리 — 수리반환(AS_CLEAR·발송 기록) / 교체(replaceDevice — 구 RECOVERED·신 ACTIVE·newDeviceId) /
 *             분실(recoverDevice LOST) / 미등록 경고 / 전 라인 종결 → 완료 자동·티켓 CLOSED / 종결 후 처리 409
 *  티켓→도메인 — OPEN→'접수'·완료일 해제 / CLOSED→'완료'
 *  라인 편집 — applyItemChanges (라인 제거 시 이 접수의 플래그만 해제 + 신규 라인 추가)
 *  배너·헬퍼 — linkedWork·canEditAsReceipt·summarizeAsItems / 삭제 CASCADE
 *  수리완료 · 기기 상태·위치 축 (2026-09-17 — device_condition_location_design.md 부록 C '▶ 수리완료'):
 *    입고 전 400 → 입고(INTAKE ref AS) → 체크(REPAIR_DONE·비고) → 멱등 → 수리반환 확정 IN_USE·병원(AS_CLEAR) / 플래그 없는 기기 → CORRECT 폴백 /
 *    옛 플래그 접수 B vs 최근 접수 A(게이트 — 상태 불변·경고 1건) / 선교체(RECOVER A-4 → 완료 → 종결 사후 입고(불일치 400) → 체크 → 가용 → 교체기 재사용) /
 *    재접수 입고 AS_WAITING → 해제 CORRECT / 취소 라인 400·위치 센터 유지·[병원 반환] / 미등록 라인 → 원장 확정 재적용 / 분실 확정 해제 / 폐기(ACTIVE 409·LOST 400·memo 400·RECOVERED ok) /
 *    병원 변경 재생성 보존·재적용 / 시리얼 보정 구·신 / 접수 삭제 훅 / 입고 확인(미회수·정상입고 확정) / appendAsNote 공용 규칙
 *    (드로어 [수리완료]/[해제]/[폐기] 라인 동기화·AS 라우트 2종은 scripts/smoke-device-registry.mts [13]에서 라우트 핸들러 직접 호출로 검증)
 * 테스트 데이터(기기·이벤트·병동·접수·티켓)는 전부 삭제한다.
 *
 *   npx tsx scripts/as-receipt-smoke.mts
 */
import { PrismaClient } from '@prisma/client'
import { TICKET_DOMAIN_ADAPTERS, domainDetailIncludes, buildTicketLinkedWork } from '../lib/ticket-domains/registry'
import { createTicketForAsReceipt, syncAsReceiptToTicket, syncTicketToAsReceipt } from '../lib/ticket-domains/asReceipt'
import { nextAsCode, canEditAsReceipt } from '../lib/asReceipt'
import { appendAsNote, summarizeAsItems } from '../lib/asReceiptShared'
import {
  matchSerials, matchWarning, openAsFlags, resolveAsLines, applyItemChanges, AsServiceError, completeAsReceipt,
  intakeAsLines, confirmAsIntake, confirmAsRegistry, correctAsLineSerial, setAsLineRepaired, scrapAsLineDevice, setUnitInUse,
} from '../lib/asReceiptService'
import { registerDevices } from '../lib/deviceRegistry/write'
import { moveDeviceLocation } from '../lib/deviceRegistry/condition'
import { RegistryError } from '../lib/deviceRegistry/core'
import { REGISTRY_REF_TYPES, refLink, todayKst, unitStateChangesOf } from '../lib/deviceRegistryShared'

const prisma = new PrismaClient()

let pass = 0
let fail = 0
function check(name: string, ok: boolean, note?: string) {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${note ? ` — ${note}` : ''}`) }
}

const S1 = 'ASMK0001' // 수리반환
const S2 = 'ASMK0002' // 교체(구)
const S3 = 'ASMK0003' // 분실
const S4 = 'ASMK0004' // 교체기(신)
const S5 = 'ASMK0005' // 라인 편집용
const SX = 'ASMKXX01' // 미등록 라인
const SX2 = 'ASMKXX02' // 편집 추가 미등록 라인
// 수리완료·기기 상태 축 (2026-09-17)
const D1 = 'ASMK1001' // 기본 흐름(입고→체크→수리반환)
const D2 = 'ASMK1002' // 플래그 없는 기기 — CORRECT 폴백
const D3 = 'ASMK1003' // 옛 플래그 접수 B vs 최근 접수 A
const D5 = 'ASMK1005' // 선교체 구기기
const N5 = 'ASMK1015' // 선교체 신기기(미등록 → 생성)
const D6 = 'ASMK1006' // 수리품 재사용 접수의 구기기
const D7 = 'ASMK1007' // 재접수·해제·폐기
const N7 = 'ASMK1017' // D7 교체기
const D8 = 'ASMK1008' // 취소 라인·병원 반환
const SX9 = 'ASMK1009' // 미등록 라인 → 원장 확정 재적용
const D10 = 'ASMK1010' // 분실 확정
const D11 = 'ASMK1011' // 타병원 배치 → 병원 변경 재생성
const D12A = 'ASMK1012' // 시리얼 보정 구
const D12B = 'ASMK1022' // 시리얼 보정 신
const D13 = 'ASMK1013' // 접수 삭제 훅
const D14A = 'ASMK1014' // 입고 확인 — 정상입고
const D14B = 'ASMK1024' // 입고 확인 — 미회수
const D14C = 'ASMK1034' // 입고 확인 — 정상입고 수동 확정
const D15A = 'ASMK1016' // 입고 확인 — 시리얼 치환(REMAP) 치환 전(미입고)
const D15B = 'ASMK1026' // 입고 확인 — 시리얼 치환(REMAP) 치환 후(미식별입고)
const D16 = 'ASMK1036' // 소급 수리반환(처리일 < AS 표시 시작일) — 업무일자 클램프
const ALL_SERIALS = [S1, S2, S3, S4, S5, SX, SX2, D1, D2, D3, D5, N5, D6, D7, N7, D8, SX9, D10, D11, D12A, D12B, D13, D14A, D14B, D14C, D15A, D15B, D16]
const WARD = 'AS스모크병동'

async function statusIdOf(name: string): Promise<number> {
  const row = await prisma.statusCode.findFirst({ where: { category: 'AS_STATUS', name }, select: { id: true } })
  if (!row) throw new Error(`AS_STATUS '${name}' 없음 — seed-as-masters.sql 적용 필요`)
  return row.id
}

async function placementOf(serial: string) {
  const unit = await prisma.deviceUnit.findUnique({ where: { serialNo: serial }, select: { id: true, placement: true } })
  return unit?.placement ?? null
}

async function cleanupRegistry(hospitalCode: string) {
  const units = await prisma.deviceUnit.findMany({ where: { serialNo: { in: ALL_SERIALS } }, select: { id: true } })
  const ids = units.map((u) => u.id)
  if (ids.length) {
    await prisma.hospitalDeviceEvent.deleteMany({ where: { OR: [{ deviceId: { in: ids } }, { relatedDeviceId: { in: ids } }] } })
    await prisma.hospitalDevice.deleteMany({ where: { deviceId: { in: ids } } })
    await prisma.deviceUnit.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.hospitalWard.deleteMany({ where: { hospitalCode, name: WARD } }).catch(() => {})
}

async function main() {
  const cleanup: (() => Promise<unknown>)[] = []
  let hospitalCode = ''
  try {
    // ── 마스터 ────────────────────────────────────────────────
    console.log('▶ 마스터 시드')
    const statuses = await prisma.statusCode.findMany({ where: { category: 'AS_STATUS' }, orderBy: { order: 'asc' } })
    check('AS_STATUS 8종', statuses.length === 8, `실제 ${statuses.length}`)
    const mapOf = (n: string) => statuses.find((s) => s.name === n)?.ticketStatus
    check('매핑 접수→OPEN·수거중/입고/발송→IN_PROGRESS',
      mapOf('접수') === 'OPEN' && mapOf('수거중') === 'IN_PROGRESS' && mapOf('입고') === 'IN_PROGRESS' && mapOf('발송') === 'IN_PROGRESS')
    check('매핑 보류→PENDING·완료→CLOSED·취소→CLOSED (RESOLVED 미경유)',
      mapOf('보류') === 'PENDING' && mapOf('완료') === 'CLOSED' && mapOf('취소') === 'CLOSED')
    const rule = await prisma.ticketDomainCtiRule.findFirst({ where: { refType: 'AS', matchStatusCodeId: null } })
    check('자동생성 규칙 기본 행 존재', !!rule)
    const lostReason = await prisma.statusCode.findFirst({ where: { category: 'DEVICE_RECOVERY_REASON', value: 'LOST' } })
    check("기기 회수 사유 '분실(LOST)' 존재", !!lostReason)

    // ── 레지스트리 ────────────────────────────────────────────
    console.log('▶ 어댑터 레지스트리')
    check('어댑터 8종 등록 (AS 포함)', Object.keys(TICKET_DOMAIN_ADAPTERS).length === 8 && 'AS' in TICKET_DOMAIN_ADAPTERS)
    check('detailInclude에 asReceipt', 'asReceipt' in domainDetailIncludes())
    check("REGISTRY_REF_TYPES에 'AS' + refLink", (REGISTRY_REF_TYPES as readonly string[]).includes('AS') && refLink('AS', 'AS-202609-0001') === '/as-receipts?q=AS-202609-0001')

    // ── 준비 — 테스트 기기 등록 ───────────────────────────────
    console.log('▶ 준비 — 테스트 기기 등록')
    const hospital = await prisma.hospital.findFirst({ select: { hospitalCode: true, hospitalName: true }, orderBy: { id: 'asc' } })
    if (!hospital) throw new Error('병원이 없어 스모크를 진행할 수 없습니다.')
    hospitalCode = hospital.hospitalCode
    const model = await prisma.deviceInfo.findFirst({ where: { serialTracked: true, deviceClass: 'WEARABLE' }, select: { id: true } })
    if (!model) throw new Error('serialTracked 웨어러블 모델이 없습니다.')
    const anyUser = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true, name: true } })
    if (!anyUser) throw new Error('사용자가 없습니다.')
    const actor = { userId: anyUser.id, name: anyUser.name }

    await cleanupRegistry(hospitalCode) // 이전 실패 잔재 제거
    const reg = await registerDevices(
      { hospitalCode, actor, occurredOn: todayKst(), source: 'MANUAL', memo: '[SMOKE] AS접수' },
      [S1, S2, S3, S5].map((s) => ({ serialInput: s, deviceInfoId: model.id, wardName: WARD, productType: '일반' }))
    )
    cleanup.push(() => cleanupRegistry(hospitalCode))
    check('테스트 기기 4대 등록', reg.created.length + reg.reregistered.length === 4)

    // ── 매칭 ─────────────────────────────────────────────────
    console.log('▶ 시리얼 매칭')
    const matches = await matchSerials(prisma, hospitalCode, [S1, SX])
    check('매칭 — 등록 기기 ACTIVE_HERE·미등록 NONE',
      matches[0]?.state === 'ACTIVE_HERE' && matches[0]?.deviceId != null && matches[1]?.state === 'NONE')
    check('매칭 경고 — 미등록 문구', !!matchWarning(matches[1]!)?.includes('등록되지 않은'))

    // ── 생성 — 레코드+라인+티켓+AS 표시 ───────────────────────
    console.log('▶ 생성 — 레코드+라인+티켓+AS 표시')
    const asCode = await nextAsCode()
    check('AS 코드 형식 AS-YYYYMM-NNNN', /^AS-\d{6}-\d{4}$/.test(asCode))

    const openStatusId = await statusIdOf('접수')
    const lineMatches = await matchSerials(prisma, hospitalCode, [S1, S2, S3, SX])
    const { receipt, ticketId } = await prisma.$transaction(async (tx) => {
      const r = await tx.asReceipt.create({
        data: {
          asCode,
          hospitalCode,
          category: 'FAULT',
          receiptDate: new Date(todayKst()),
          statusId: openStatusId,
          note: '[SMOKE] AS접수 스모크',
          createdById: anyUser.id,
        },
      })
      for (const m of lineMatches) {
        await tx.asReceiptItem.create({ data: { receiptId: r.id, serialNo: m.serialNo, deviceId: m.deviceId, symptom: '전원 불량' } })
      }
      const tid = await createTicketForAsReceipt(tx, {
        id: r.id, asCode: r.asCode, hospitalCode, hospitalName: hospital.hospitalName,
        category: 'FAULT', statusName: '접수', statusId: r.statusId,
        description: r.note, resolvedAt: null, createdAt: r.createdAt,
      }, anyUser.id, 'domain')
      const w = await openAsFlags(tx, { asCode: r.asCode, hospitalCode }, lineMatches.filter((m) => m.state === 'ACTIVE_HERE').map((m) => ({ serialNo: m.serialNo, deviceId: m.deviceId! })), actor, todayKst())
      return { receipt: r, ticketId: tid, w }
    }, { timeout: 60000 })
    cleanup.push(() => prisma.asReceipt.deleteMany({ where: { id: receipt.id } }))
    cleanup.push(() => prisma.ticket.deleteMany({ where: { id: ticketId } }))

    let ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
    check('티켓 생성 refType AS·OPEN', ticket?.refType === 'AS' && ticket?.status === 'OPEN')
    check('티켓 제목 [AS접수·고장] + 병원 스냅샷', !!ticket?.title.startsWith('[AS접수·고장]') && ticket?.hospitalCode === hospitalCode)
    check('티켓 CTI = 규칙 CTI·그룹 배정', ticket?.ctiId === rule?.ctiId && ticket?.queueId != null)
    const p1 = await placementOf(S1)
    check('AS 표시 — asStartedOn + asRefCode=접수 코드', !!p1?.asStartedOn && p1?.asRefCode === asCode)

    // 중복 표시 → 경고
    const dupWarnings = await prisma.$transaction((tx) =>
      openAsFlags(tx, { asCode, hospitalCode }, [{ serialNo: S1, deviceId: p1!.deviceId }], actor, todayKst())
    )
    check('이미 AS진행중 재표시 → 경고 수집', dupWarnings.length === 1 && dupWarnings[0].includes('AS 표시 실패'))

    // ── 도메인→티켓 ──────────────────────────────────────────
    console.log('▶ 도메인→티켓 동기화')
    const set = async (name: string) => {
      await prisma.asReceipt.update({ where: { id: receipt.id }, data: { statusId: await statusIdOf(name) } })
      await prisma.$transaction((tx) => syncAsReceiptToTicket(tx, receipt.id, anyUser.id))
      return prisma.ticket.findUnique({ where: { id: ticketId } })
    }
    ticket = await set('수거중')
    check('수거중 → IN_PROGRESS', ticket?.status === 'IN_PROGRESS')
    ticket = await set('보류')
    check('보류 → PENDING + 사유', ticket?.status === 'PENDING' && ticket?.pendingReasonId != null)
    ticket = await set('접수')
    check('접수 복귀 → OPEN·사유 해제', ticket?.status === 'OPEN' && ticket?.pendingReasonId === null)

    // ── 라인 처리 ────────────────────────────────────────────
    console.log('▶ 라인 처리 — 수리반환·교체·분실·미등록')
    const items = await prisma.asReceiptItem.findMany({ where: { receiptId: receipt.id }, orderBy: { id: 'asc' } })
    const itemBySerial = new Map(items.map((i) => [i.serialNo, i]))

    // 수리반환 (S1)
    let res = await resolveAsLines(receipt.id, actor, {
      lines: [{ itemId: itemBySerial.get(S1)!.id, outcome: 'REPAIR_RETURN' }],
      shipMethod: 'PARCEL', shipTrackingNo: '6897100000000',
    })
    const s1After = await placementOf(S1)
    const s1Item = await prisma.asReceiptItem.findUnique({ where: { id: itemBySerial.get(S1)!.id } })
    check('수리반환 — AS 해제 + 발송 기록', s1After?.asStartedOn === null && s1Item?.outcome === 'REPAIR_RETURN' && !!s1Item?.shippedAt && s1Item?.shipMethod === 'PARCEL')
    check('수리반환 — 부분 처리(미완료 유지)', !res.autoCompleted)

    // 교체 (S2 → S4)
    res = await resolveAsLines(receipt.id, actor, {
      lines: [{ itemId: itemBySerial.get(S2)!.id, outcome: 'REPLACE', newSerial: S4 }],
      shipMethod: 'VISIT',
    })
    const s2After = await placementOf(S2)
    const s4After = await placementOf(S4)
    const s2Item = await prisma.asReceiptItem.findUnique({ where: { id: itemBySerial.get(S2)!.id } })
    check('교체 — 구기기 RECOVERED·AS 자동 해제', s2After?.status === 'RECOVERED' && s2After?.asStartedOn === null)
    check('교체 — 신기기 ACTIVE + 라인 newDeviceId·newSerialNo', s4After?.status === 'ACTIVE' && s4After?.hospitalCode === hospitalCode && s2Item?.newSerialNo === S4 && s2Item?.newDeviceId != null)

    // 분실 (S3) + 미등록 (SX) — 전 라인 종결 → 자동 완료
    res = await resolveAsLines(receipt.id, actor, {
      lines: [
        { itemId: itemBySerial.get(S3)!.id, outcome: 'LOST' },
        { itemId: itemBySerial.get(SX)!.id, outcome: 'CANCELED' },
      ],
    })
    const s3After = await placementOf(S3)
    check('분실종결 — RECOVERED + 사유 LOST', s3After?.status === 'RECOVERED' && s3After?.recoverReasonId === lostReason?.id)
    check('미등록 라인 — 이벤트 스킵 경고', res.warnings.some((w) => w.includes('미등록 라인')))
    check('전 라인 종결 → 헤더 발송완료 자동 (2026-09-11)', res.autoCompleted)
    const shippedReceipt = await prisma.asReceipt.findUnique({ where: { id: receipt.id }, include: { status: true } })
    ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
    check("헤더 '발송완료'·완료일 없음 + 티켓 IN_PROGRESS", shippedReceipt?.status?.name === '발송완료' && shippedReceipt?.resolvedAt == null && ticket?.status === 'IN_PROGRESS')
    await completeAsReceipt(receipt.id, actor)
    const doneReceipt = await prisma.asReceipt.findUnique({ where: { id: receipt.id }, include: { status: true } })
    ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
    check("기기등록 [완료] → 헤더 '완료'·완료일 + 티켓 CLOSED", doneReceipt?.status?.name === '완료' && doneReceipt?.resolvedAt != null && ticket?.status === 'CLOSED')

    // 종결 후 처리 시도 → 409
    let blocked = false
    try {
      await resolveAsLines(receipt.id, actor, { lines: [{ itemId: itemBySerial.get(S1)!.id, outcome: 'CANCELED' }] })
    } catch (e) {
      blocked = e instanceof AsServiceError && e.status === 409
    }
    check('완료된 접수 처리 시도 → 409', blocked)

    // ── 티켓→도메인 ──────────────────────────────────────────
    console.log('▶ 티켓→도메인 역동기화')
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: 'OPEN', resolvedAt: null, closedAt: null } })
    await prisma.$transaction((tx) => syncTicketToAsReceipt(tx, ticketId))
    let after = await prisma.asReceipt.findUnique({ where: { id: receipt.id }, include: { status: true } })
    check("티켓 OPEN → 도메인 '접수'·완료일 해제", after?.status?.name === '접수' && after?.resolvedAt === null)
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: 'CLOSED', resolvedAt: new Date(), closedAt: new Date() } })
    await prisma.$transaction((tx) => syncTicketToAsReceipt(tx, ticketId))
    after = await prisma.asReceipt.findUnique({ where: { id: receipt.id }, include: { status: true } })
    check("티켓 CLOSED → 도메인 '완료'·완료일 백필", after?.status?.name === '완료' && after?.resolvedAt != null)

    // ── 배너 ─────────────────────────────────────────────────
    console.log('▶ 연결 업무 배너')
    const full = await prisma.ticket.findUnique({ where: { id: ticketId }, include: domainDetailIncludes() })
    const lw = buildTicketLinkedWork(full as unknown as { refType: string | null })
    check('linkedWork 조립 (code·href)', lw?.refType === 'AS' && lw?.code === asCode && lw?.href === `/as-receipts/${receipt.id}`)
    check('linkedWork meta — 구분·기기 수', !!lw?.meta.includes('고장') && !!lw?.meta.includes('기기 4대'))

    // ── 라인 편집 (applyItemChanges) ─────────────────────────
    console.log('▶ 라인 편집 — 제거 시 플래그 해제·추가')
    const asCode2 = await nextAsCode()
    const m5 = (await matchSerials(prisma, hospitalCode, [S5]))[0]!
    const receipt2 = await prisma.$transaction(async (tx) => {
      const r = await tx.asReceipt.create({
        data: { asCode: asCode2, hospitalCode, category: 'FAULT', receiptDate: new Date(todayKst()), statusId: openStatusId, createdById: anyUser.id },
      })
      await tx.asReceiptItem.create({ data: { receiptId: r.id, serialNo: S5, deviceId: m5.deviceId } })
      await openAsFlags(tx, { asCode: asCode2, hospitalCode }, [{ serialNo: S5, deviceId: m5.deviceId! }], actor, todayKst())
      return r
    }, { timeout: 60000 })
    cleanup.push(() => prisma.asReceipt.deleteMany({ where: { id: receipt2.id } }))
    const s5Flagged = await placementOf(S5)
    check('편집용 접수 — S5 AS 표시', !!s5Flagged?.asStartedOn && s5Flagged?.asRefCode === asCode2)

    const editWarnings = await prisma.$transaction(
      (tx) => applyItemChanges(tx, { id: receipt2.id, asCode: asCode2, hospitalCode, receiptDate: receipt2.receiptDate }, [{ serial: SX2, symptom: '추가 라인' }], actor),
      { timeout: 60000 }
    )
    const s5Cleared = await placementOf(S5)
    const items2 = await prisma.asReceiptItem.findMany({ where: { receiptId: receipt2.id } })
    check('라인 제거 → 이 접수의 플래그 해제', s5Cleared?.asStartedOn === null)
    check('라인 추가 — 미등록 경고 + 교체 반영', items2.length === 1 && items2[0].serialNo === SX2 && editWarnings.some((w) => w.includes('등록되지 않은')))

    // ── 헬퍼·CASCADE ─────────────────────────────────────────
    console.log('▶ 헬퍼·CASCADE')
    check('summarizeAsItems 요약', summarizeAsItems([{ outcome: null }, { outcome: 'REPLACE' }]) === '기기 2대 (종결 1)' && summarizeAsItems([]) === '기기 없음')
    const own = { createdById: anyUser.id, status: { ticketStatus: 'OPEN' as const } }
    const ownDone = { createdById: anyUser.id, status: { ticketStatus: 'CLOSED' as const } }
    const other = { createdById: 'someone-else', status: { ticketStatus: 'OPEN' as const } }
    check('수정 권한 — ADMIN 항상', canEditAsReceipt({ userId: 'x', role: 'ADMIN' }, ownDone))
    check('수정 권한 — USER 본인·종결 전 허용', canEditAsReceipt({ userId: anyUser.id, role: 'USER' }, own))
    check('수정 권한 — USER 본인·종결 후 차단', !canEditAsReceipt({ userId: anyUser.id, role: 'USER' }, ownDone))
    check('수정 권한 — USER 타인 등록·종결 전 허용 (2026-09-07 CX #4 개정)', canEditAsReceipt({ userId: anyUser.id, role: 'USER' }, other))
    check('수정 권한 — VIEWER 차단', !canEditAsReceipt({ userId: anyUser.id, role: 'VIEWER' }, own))

    await prisma.asReceipt.delete({ where: { id: receipt2.id } })
    const lineLeft = await prisma.asReceiptItem.count({ where: { receiptId: receipt2.id } })
    check('접수 삭제 시 라인 CASCADE', lineLeft === 0)

    // ── 수리완료 · 기기 상태·위치 축 (2026-09-17 — device_condition_location_design.md 부록 C) ─────
    console.log('▶ 수리완료 — 기기 상태·위치 축')
    const mine: { receiptId: number; ticketId: number }[] = []
    const siteRC = await prisma.statusCode.findFirst({ where: { category: 'DEVICE_SITE', value: 'REFRESH_CENTER' }, select: { id: true } })
    check('DEVICE_SITE 리프레시센터 마스터 존재', !!siteRC, 'seed-device-registry.sql 적용 필요')
    check('appendAsNote — 비고 이력 줄 추가·5,000자 절단(AS 서비스·기기현황 라우트 공용 단일 소스)',
      appendAsNote('기존', 'A') === '기존\nA' && appendAsNote(null, 'L') === 'L' && appendAsNote('x'.repeat(4990), 'y'.repeat(20)).length === 5000 && appendAsNote('x'.repeat(4990), 'y'.repeat(20)).endsWith('y'.repeat(20)))
    const modelRow = await prisma.deviceInfo.findUnique({ where: { id: model.id }, select: { deviceModel: true, deviceName: true } })
    const hospitalB = await prisma.hospital.findFirst({ where: { hospitalCode: { not: hospitalCode } }, select: { hospitalCode: true, hospitalName: true }, orderBy: { id: 'asc' } })
    const ymd = (d: Date | string | null | undefined) => (d ? (typeof d === 'string' ? d : d.toISOString()).slice(0, 10) : null)
    const yesterday = new Date(new Date(`${todayKst()}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10)
    const unitOf = (serial: string) => prisma.deviceUnit.findUnique({
      where: { serialNo: serial },
      select: { id: true, condition: true, locationHospitalCode: true, locationSiteId: true, placement: { select: { status: true, hospitalCode: true, asStartedOn: true, asRefCode: true } } },
    })
    type U = Awaited<ReturnType<typeof unitOf>>
    const atCenter = (u: U) => !!u && u.locationSiteId === siteRC?.id && u.locationHospitalCode == null
    const atHospital = (u: U, code: string) => !!u && u.locationHospitalCode === code && u.locationSiteId == null
    const lastEvent = (deviceId: number) => prisma.hospitalDeviceEvent.findFirst({ where: { deviceId }, orderBy: { id: 'desc' } })
    const eventCount = (deviceId: number) => prisma.hospitalDeviceEvent.count({ where: { deviceId } })
    const typesOf = async (deviceId: number, refCode?: string) => (await prisma.hospitalDeviceEvent.findMany({ where: { deviceId, ...(refCode ? { refCode } : {}) }, orderBy: { id: 'asc' }, select: { eventType: true } })).map((e) => e.eventType).join(',')
    const condBefore = (ev: { changes: unknown } | null) => unitStateChangesOf(ev?.changes)?.condition.before ?? null
    const condAfter = (ev: { changes: unknown } | null) => unitStateChangesOf(ev?.changes)?.condition.after ?? null
    const locAfter = (ev: { changes: unknown } | null) => { const l = unitStateChangesOf(ev?.changes)?.location.after; return l ? `${l.kind}/${l.code}` : null }
    const noteOf = async (id: number) => (await prisma.asReceipt.findUnique({ where: { id }, select: { note: true } }))?.note ?? ''
    // 오류 status — AsServiceError는 instanceof, RegistryError·RegistryTxAbort는 이름·status로 판정
    // (tsx가 서비스의 `@/lib/deviceRegistry`(별칭)와 스모크의 상대 경로 import를 별개 모듈 인스턴스로 적재해 instanceof가 false — 앱 번들에는 없는 현상)
    const errStatus = async (fn: () => Promise<unknown>): Promise<number | null> => {
      try { await fn(); return null } catch (e) {
        if (e instanceof AsServiceError || e instanceof RegistryError) return e.status
        const err = e as { name?: string; status?: number }
        return (err?.name === 'RegistryError' || err?.name === 'RegistryTxAbort') && typeof err.status === 'number' ? err.status : -1
      }
    }
    /** 접수+라인+티켓(+AS 표시) 생성 — 실패 경로 정리는 cleanup, 정상 경로는 섹션 끝에서 명시 삭제 */
    const mkReceipt = async (h: { hospitalCode: string; hospitalName: string }, serials: string[], opts?: { flags?: boolean }) => {
      const code = await nextAsCode()
      const ms = await matchSerials(prisma, h.hospitalCode, serials)
      const r = await prisma.$transaction(async (tx) => {
        const rec = await tx.asReceipt.create({ data: { asCode: code, hospitalCode: h.hospitalCode, category: 'FAULT', receiptDate: new Date(todayKst()), statusId: openStatusId, note: '[SMOKE] 수리완료', createdById: anyUser.id } })
        for (const m of ms) await tx.asReceiptItem.create({ data: { receiptId: rec.id, serialNo: m.serialNo, deviceId: m.deviceId, symptom: '스모크' } })
        const tid = await createTicketForAsReceipt(tx, {
          id: rec.id, asCode: rec.asCode, hospitalCode: h.hospitalCode, hospitalName: h.hospitalName,
          category: 'FAULT', statusName: '접수', statusId: rec.statusId, description: rec.note, resolvedAt: null, createdAt: rec.createdAt,
        }, anyUser.id, 'domain')
        const w = opts?.flags === false ? [] : await openAsFlags(tx, { asCode: code, hospitalCode: h.hospitalCode }, ms.filter((m) => m.state === 'ACTIVE_HERE' && !m.asOpen).map((m) => ({ serialNo: m.serialNo, deviceId: m.deviceId! })), actor, todayKst())
        return { id: rec.id, tid, w }
      }, { timeout: 60000 })
      mine.push({ receiptId: r.id, ticketId: r.tid })
      cleanup.push(() => prisma.asReceipt.deleteMany({ where: { id: r.id } }))
      cleanup.push(() => prisma.ticket.deleteMany({ where: { id: r.tid } }))
      const itemId = async (serial: string) => (await prisma.asReceiptItem.findFirst({ where: { receiptId: r.id, serialNo: serial }, select: { id: true } }))!.id
      return { id: r.id, asCode: code, ticketId: r.tid, warnings: r.w, itemId }
    }

    const regC = await registerDevices(
      { hospitalCode, actor, occurredOn: todayKst(), source: 'MANUAL', memo: '[SMOKE] 수리완료' },
      [D1, D2, D3, D5, D6, D7, D8, D10, D12A, D12B, D13, D14A, D14B, D14C, D15A, D15B, D16].map((s) => ({ serialInput: s, deviceInfoId: model.id, wardName: WARD, productType: '일반' }))
    )
    const u0 = await unitOf(D1)
    check('[C-0] 테스트 기기 17대 등록 → 사용중·위치 병원(REGISTER 암묵 전이)', regC.created.length + regC.reregistered.length === 17 && u0?.condition === 'IN_USE' && atHospital(u0, hospitalCode))

    // [C-1] 기본 흐름 — 입고 전 400 → 입고(INTAKE) → 체크(REPAIR_DONE) → 멱등 → 수리반환 확정 → IN_USE·병원(AS_CLEAR)
    const R1 = await mkReceipt(hospital, [D1])
    const i1 = await R1.itemId(D1)
    check('[C-1] 입고 전 수리완료 체크 → 400', (await errStatus(() => setAsLineRepaired(R1.id, actor, { itemId: i1, repaired: true }))) === 400)
    const in1 = await intakeAsLines(R1.id, actor, { serials: [D1] })
    let u1 = await unitOf(D1)
    let ev = await lastEvent(u1!.id)
    check('[C-1] 입고처리 → 라인 RECEIVED + 기기 AS접수·리프레시센터 + INTAKE(ref AS, 스냅샷 SITE/REFRESH_CENTER)',
      in1.received.length === 1 && in1.warnings.length === 0 && u1?.condition === 'AS_WAITING' && atCenter(u1) && ev?.eventType === 'INTAKE' && ev.refType === 'AS' && ev.refCode === R1.asCode && locAfter(ev) === 'SITE/REFRESH_CENTER',
      JSON.stringify({ w: in1.warnings, u: u1, ev: ev?.eventType }))
    const rd1 = await setAsLineRepaired(R1.id, actor, { itemId: i1, repaired: true })
    u1 = await unitOf(D1); ev = await lastEvent(u1!.id)
    const line1 = await prisma.asReceiptItem.findUnique({ where: { id: i1 } })
    check('[C-1] 수리완료 체크 → 라인 repaired_at(오늘)/by + 기기 수리완료·센터 + REPAIR_DONE(ref AS) + 비고 이력',
      rd1.repaired && rd1.warnings.length === 0 && ymd(line1?.repairedAt) === todayKst() && line1?.repairedById === anyUser.id && u1?.condition === 'REPAIRED' && atCenter(u1) && ev?.eventType === 'REPAIR_DONE' && ev.refCode === R1.asCode && (await noteOf(R1.id)).includes('[수리완료 '),
      JSON.stringify({ rd1, u: u1, ev: ev?.eventType }))
    const evCount1 = await eventCount(u1!.id)
    const noteLines1 = (await noteOf(R1.id)).split('\n').length
    const rd1b = await setAsLineRepaired(R1.id, actor, { itemId: i1, repaired: true })
    check("[C-1] 재체크 멱등 — 이벤트 추가 없음·일자 유지·비고 줄 수 불변 + 경고 '변경 사항 없음'",
      (await eventCount(u1!.id)) === evCount1 && rd1b.repairedAt === ymd(line1?.repairedAt) && (await noteOf(R1.id)).split('\n').length === noteLines1 && rd1b.warnings.length === 1 && rd1b.warnings[0].includes('변경 사항 없음'),
      JSON.stringify(rd1b))
    const res1 = await resolveAsLines(R1.id, actor, { lines: [{ itemId: i1, outcome: 'REPAIR_RETURN' }], shipMethod: 'PARCEL' })
    u1 = await unitOf(D1); ev = await lastEvent(u1!.id)
    check('[C-1] 수리반환 확정 → 사용중·위치 병원 + AS_CLEAR 행 스냅샷(REPAIRED→IN_USE) + 플래그 해제·경고 없음',
      u1?.condition === 'IN_USE' && atHospital(u1, hospitalCode) && u1?.placement?.asStartedOn === null && ev?.eventType === 'AS_CLEAR' && condBefore(ev) === 'REPAIRED' && condAfter(ev) === 'IN_USE' && res1.warnings.length === 0,
      JSON.stringify({ w: res1.warnings, u: u1, ev: ev?.eventType }))
    const rd1c = await setAsLineRepaired(R1.id, actor, { itemId: i1, repaired: false })
    u1 = await unitOf(D1)
    check('[C-1] 반환 확정 후 해제 → 라인만 해제 + 경고(기기 사용중 유지)', !rd1c.repaired && rd1c.repairedAt === null && u1?.condition === 'IN_USE' && rd1c.warnings.length === 1, JSON.stringify(rd1c))
    const rd1d = await setAsLineRepaired(R1.id, actor, { itemId: i1, repaired: true })
    u1 = await unitOf(D1)
    check("[C-1] 반환 확정 라인 재체크 → 라인 기록 + 경고 '이미 사용중'", rd1d.repaired && u1?.condition === 'IN_USE' && rd1d.warnings.some((w) => w.includes('이미 사용중')), JSON.stringify(rd1d))

    // [C-2] 플래그 없는 기기(타병원 매칭 후 이관·수동 해제 등) — CORRECT 폴백
    const R2 = await mkReceipt(hospital, [D2], { flags: false })
    const i2 = await R2.itemId(D2)
    await intakeAsLines(R2.id, actor, { serials: [D2] })
    const res2 = await resolveAsLines(R2.id, actor, { lines: [{ itemId: i2, outcome: 'REPAIR_RETURN' }] })
    const u2 = await unitOf(D2); ev = await lastEvent(u2!.id)
    check("[C-2] 플래그 없는 기기 수리반환 확정 → CORRECT 폴백(AS_WAITING→IN_USE·병원, ref AS, memo '수리반환 확정')",
      u2?.condition === 'IN_USE' && atHospital(u2, hospitalCode) && ev?.eventType === 'CORRECT' && ev.refCode === R2.asCode && (ev.memo ?? '').startsWith('수리반환 확정') && condBefore(ev) === 'AS_WAITING' && condAfter(ev) === 'IN_USE' && res2.warnings.length === 0,
      JSON.stringify({ w: res2.warnings, u: u2, ev }))

    // [C-3] 접수 B(옛 플래그) vs 접수 A(최근 입고·체크) — 되돌림 게이트
    const RB = await mkReceipt(hospital, [D3])
    const RA = await mkReceipt(hospital, [D3])
    const iB = await RB.itemId(D3), iA = await RA.itemId(D3)
    await intakeAsLines(RA.id, actor, { serials: [D3] })
    await setAsLineRepaired(RA.id, actor, { itemId: iA, repaired: true })
    let u3 = await unitOf(D3)
    check('[C-3] 접수 A 입고·체크 → 수리완료·센터, 플래그는 접수 B 유지', u3?.condition === 'REPAIRED' && atCenter(u3) && u3?.placement?.asRefCode === RB.asCode, JSON.stringify(u3))
    const resB = await resolveAsLines(RB.id, actor, { lines: [{ itemId: iB, outcome: 'CANCELED' }] })
    u3 = await unitOf(D3)
    const wB = resB.warnings.filter((w) => w.includes(D3))
    check('[C-3] 접수 B(옛 플래그) 라인 취소 → 기기 상태 불변 + 경고 1건(다른 접수가 최근 상태를 기록 · 이 접수의 AS 표시 잔존 안내)',
      u3?.condition === 'REPAIRED' && atCenter(u3) && wB.length === 1 && wB[0].includes('최근 상태를 기록') && wB[0].includes('AS 표시가 남아 있습니다') && u3?.placement?.asRefCode === RB.asCode,
      JSON.stringify({ w: resB.warnings, u: u3 }))
    const resA = await resolveAsLines(RA.id, actor, { lines: [{ itemId: iA, outcome: 'REPAIR_RETURN' }] })
    u3 = await unitOf(D3); ev = await lastEvent(u3!.id)
    check('[C-3] 접수 A 수리반환 확정 → CORRECT 폴백(타 접수 플래그 유지·경고) + 사용중·병원',
      u3?.condition === 'IN_USE' && atHospital(u3, hospitalCode) && ev?.eventType === 'CORRECT' && u3?.placement?.asRefCode === RB.asCode && resA.warnings.some((w) => w.includes('AS 표시가 남아')),
      JSON.stringify({ w: resA.warnings, u: u3, ev: ev?.eventType }))

    // [C-5] 선교체 — REPLACE 확정(구기기 RECOVER 스냅샷 A-4) → 완료 → 종결 사후 입고(불일치 400) → INTAKE·received_at → 체크 → 가용 → 교체기 재사용
    const R5 = await mkReceipt(hospital, [D5])
    const i5 = await R5.itemId(D5)
    const res5 = await resolveAsLines(R5.id, actor, { lines: [{ itemId: i5, outcome: 'REPLACE', newSerial: N5 }], shipMethod: 'PARCEL' })
    let u5 = await unitOf(D5)
    const rec5 = await prisma.hospitalDeviceEvent.findFirst({ where: { deviceId: u5!.id, eventType: 'RECOVER' }, orderBy: { id: 'desc' } })
    const uN5 = await unitOf(N5)
    check("[C-5] 선교체 REPLACE 확정 → 구기기 RECOVERED·AS접수·리프레시센터(A-4, note '입고 미확인') / 신기기 사용중·병원",
      u5?.placement?.status === 'RECOVERED' && u5?.condition === 'AS_WAITING' && atCenter(u5) && locAfter(rec5) === 'SITE/REFRESH_CENTER' && unitStateChangesOf(rec5?.changes)?.location.note === '입고 미확인' && uN5?.condition === 'IN_USE' && atHospital(uN5, hospitalCode) && res5.autoCompleted,
      JSON.stringify({ u5, rec5: rec5?.changes, uN5 }))
    await completeAsReceipt(R5.id, actor)
    check('[C-5] 종결 접수 사후 입고 — 불일치 시리얼 400(EXTRA 생성 금지)', (await errStatus(() => intakeAsLines(R5.id, actor, { serials: [D5, 'ASMKZZ99'] }))) === 400 && (await prisma.asReceiptItem.count({ where: { receiptId: R5.id } })) === 1)
    const in5 = await intakeAsLines(R5.id, actor, { serials: [D5] })
    const line5 = await prisma.asReceiptItem.findUnique({ where: { id: i5 } })
    const r5 = await prisma.asReceipt.findUnique({ where: { id: R5.id }, include: { status: true } })
    const intake5 = await prisma.hospitalDeviceEvent.findFirst({ where: { deviceId: u5!.id, eventType: 'INTAKE', refCode: R5.asCode } })
    check("[C-5] 종결 접수 사후 입고 허용 → RECEIVED·received_at + INTAKE 기록(변화 없어도 첫 ref — B-37) + 헤더 '완료' 유지·비고만",
      in5.received.length === 1 && line5?.intakeState === 'RECEIVED' && !!line5?.receivedAt && !!intake5 && r5?.status?.name === '완료' && !!r5?.resolvedAt && (r5?.note ?? '').includes('종결 접수 사후 입고'),
      JSON.stringify({ in5, line5: line5?.intakeState, status: r5?.status?.name, intake5: !!intake5 }))
    const rd5 = await setAsLineRepaired(R5.id, actor, { itemId: i5, repaired: true })
    u5 = await unitOf(D5)
    const openLines5 = await prisma.asReceiptItem.count({ where: { deviceId: u5!.id, outcome: null } })
    check('[C-5] 종결 접수 라인 체크(A-2) → 구기기 수리완료·센터·회수·미종결 라인 없음 = 교체품 가용(I-5)', rd5.repaired && u5?.condition === 'REPAIRED' && atCenter(u5) && u5?.placement?.status === 'RECOVERED' && openLines5 === 0, JSON.stringify({ rd5, u5 }))
    const R6 = await mkReceipt(hospital, [D6])
    const i6 = await R6.itemId(D6)
    const res6 = await resolveAsLines(R6.id, actor, { lines: [{ itemId: i6, outcome: 'REPLACE', newSerial: D5 }] })
    u5 = await unitOf(D5)
    check('[C-5] 수리품 재사용(다른 접수의 교체기) → 재등록 사용중·병원, 재사용 경고 없음', u5?.placement?.status === 'ACTIVE' && u5?.condition === 'IN_USE' && atHospital(u5, hospitalCode) && !res6.warnings.some((w) => w.includes('수리완료 체크 없이')), JSON.stringify({ w: res6.warnings, u5 }))

    // [C-7] 교체 구기기 사후 입고·체크 → 재접수 입고(새 ref → AS_WAITING·가용 제외) → 체크 → 해제(CORRECT)
    const R7a = await mkReceipt(hospital, [D7])
    const i7a = await R7a.itemId(D7)
    await resolveAsLines(R7a.id, actor, { lines: [{ itemId: i7a, outcome: 'REPLACE', newSerial: N7 }] })
    await intakeAsLines(R7a.id, actor, { serials: [D7] }) // 비종결 접수의 종결 라인 사후 입고(기존 규칙)
    await setAsLineRepaired(R7a.id, actor, { itemId: i7a, repaired: true })
    let u7 = await unitOf(D7)
    check('[C-7] 교체 구기기 사후 입고·체크 → 수리완료·센터(가용)', u7?.condition === 'REPAIRED' && atCenter(u7) && u7?.placement?.status === 'RECOVERED', JSON.stringify(u7))
    const R7b = await mkReceipt(hospital, [D7]) // 재접수 — 회수 상태라 플래그 없음
    const i7b = await R7b.itemId(D7)
    await intakeAsLines(R7b.id, actor, { serials: [D7] })
    u7 = await unitOf(D7); ev = await lastEvent(u7!.id)
    check('[C-7] 재접수 입고(새 ref) → AS접수·센터(가용 제외) + INTAKE 기록', u7?.condition === 'AS_WAITING' && atCenter(u7) && ev?.eventType === 'INTAKE' && ev.refCode === R7b.asCode, JSON.stringify({ u7, ev: ev?.eventType }))
    await setAsLineRepaired(R7b.id, actor, { itemId: i7b, repaired: true })
    const rd7 = await setAsLineRepaired(R7b.id, actor, { itemId: i7b, repaired: false })
    u7 = await unitOf(D7); ev = await lastEvent(u7!.id)
    const line7b = await prisma.asReceiptItem.findUnique({ where: { id: i7b } })
    check("[C-7] 수리완료 해제 → CORRECT(REPAIRED→AS_WAITING, memo '수리완료 해제', ref AS) + 라인 repaired_at NULL + 비고",
      !rd7.repaired && rd7.warnings.length === 0 && line7b?.repairedAt === null && u7?.condition === 'AS_WAITING' && ev?.eventType === 'CORRECT' && condBefore(ev) === 'REPAIRED' && condAfter(ev) === 'AS_WAITING' && ev.memo === '수리완료 해제' && ev.refCode === R7b.asCode && (await noteOf(R7b.id)).includes('[수리완료 해제 '),
      JSON.stringify({ rd7, u7, ev }))

    // [C-8] 체크된 라인 취소 → repaired_at NULL·비고 + 사용중·위치 센터 유지(I-4 예외) → 취소 라인 체크 400 → [병원 반환]
    const R8 = await mkReceipt(hospital, [D8])
    const i8 = await R8.itemId(D8)
    await intakeAsLines(R8.id, actor, { serials: [D8] })
    await setAsLineRepaired(R8.id, actor, { itemId: i8, repaired: true })
    const res8 = await resolveAsLines(R8.id, actor, { lines: [{ itemId: i8, outcome: 'CANCELED' }] })
    let u8 = await unitOf(D8); ev = await lastEvent(u8!.id)
    const line8 = await prisma.asReceiptItem.findUnique({ where: { id: i8 } })
    check('[C-8] 체크된 라인 취소 → repaired_at NULL·비고 + 사용중·위치 센터 유지(AS_CLEAR, 플래그 해제, 경고 없음)',
      line8?.outcome === 'CANCELED' && line8?.repairedAt === null && (await noteOf(R8.id)).includes('수리완료 해제') && u8?.condition === 'IN_USE' && atCenter(u8) && ev?.eventType === 'AS_CLEAR' && u8?.placement?.asStartedOn === null && res8.warnings.length === 0,
      JSON.stringify({ w: res8.warnings, u8, ev: ev?.eventType, line8: line8?.repairedAt }))
    check('[C-8] 취소 라인 수리완료 체크 → 400', (await errStatus(() => setAsLineRepaired(R8.id, actor, { itemId: i8, repaired: true }))) === 400)
    await moveDeviceLocation({ hospitalCode, actor, occurredOn: todayKst(), source: 'MANUAL' }, { deviceId: u8!.id, to: 'HOSPITAL' })
    u8 = await unitOf(D8); ev = await lastEvent(u8!.id)
    check('[C-8] [병원 반환] → 위치 병원(SITE_MOVE)·사용중 유지', atHospital(u8, hospitalCode) && ev?.eventType === 'SITE_MOVE' && u8?.condition === 'IN_USE', JSON.stringify({ u8, ev: ev?.eventType }))

    // [C-9] 미등록 라인 — 입고·체크는 라인만(경고) → 원장 확정 시 INTAKE(received_at)·REPAIR_DONE(repaired_at) 재적용
    const R9 = await mkReceipt(hospital, [SX9])
    const i9 = await R9.itemId(SX9)
    await intakeAsLines(R9.id, actor, { serials: [SX9], receivedAt: yesterday })
    const rd9 = await setAsLineRepaired(R9.id, actor, { itemId: i9, repaired: true })
    check('[C-9] 미등록 라인 체크 → 라인 기록 + 경고(원장 확정 시 재적용)', rd9.repaired && rd9.condition === null && rd9.warnings.some((w) => w.includes('미등록')), JSON.stringify(rd9))
    const cr9 = await confirmAsRegistry(R9.id, actor, { itemId: i9, modelInput: modelRow?.deviceModel ?? modelRow?.deviceName ?? null, wardName: WARD, productType: '일반' })
    const u9 = await unitOf(SX9)
    const evs9 = await prisma.hospitalDeviceEvent.findMany({ where: { deviceId: u9!.id }, orderBy: { id: 'asc' } })
    const intake9 = evs9.find((e) => e.eventType === 'INTAKE'), repair9 = evs9.find((e) => e.eventType === 'REPAIR_DONE')
    check('[C-9] 원장 확정 → REGISTER·AS_OPEN·INTAKE(occurredOn=received_at)·REPAIR_DONE(occurredOn=repaired_at) 재적용 → 수리완료·센터',
      cr9.kind === 'created' && evs9.map((e) => e.eventType).join(',') === 'REGISTER,AS_OPEN,INTAKE,REPAIR_DONE' && ymd(intake9?.occurredOn) === yesterday && ymd(repair9?.occurredOn) === todayKst() && u9?.condition === 'REPAIRED' && atCenter(u9),
      JSON.stringify({ cr9, types: evs9.map((e) => e.eventType), u9 }))

    // [C-10] 분실 확정 → 수리완료 해제·LOST / 폐기 게이트(분실 400·배치 중 409·memo 400) / 회수 기기 폐기 → SCRAPPED
    const R10 = await mkReceipt(hospital, [D10])
    const i10 = await R10.itemId(D10)
    await intakeAsLines(R10.id, actor, { serials: [D10] })
    await setAsLineRepaired(R10.id, actor, { itemId: i10, repaired: true })
    await resolveAsLines(R10.id, actor, { lines: [{ itemId: i10, outcome: 'LOST' }] })
    const u10 = await unitOf(D10); const line10 = await prisma.asReceiptItem.findUnique({ where: { id: i10 } })
    check('[C-10] 체크된 라인 분실종결 → repaired_at NULL + 기기 분실·위치 없음(RECOVER LOST)', line10?.repairedAt === null && u10?.condition === 'LOST' && u10?.locationHospitalCode == null && u10?.locationSiteId == null && u10?.placement?.status === 'RECOVERED', JSON.stringify({ u10, line10: line10?.repairedAt }))
    check('[C-10] 분실 라인 폐기 → 400', (await errStatus(() => scrapAsLineDevice(R10.id, actor, { itemId: i10, memo: '스모크' }))) === 400)
    check("[C-10] 배치 중 기기 폐기 → 409 '먼저 회수'", (await errStatus(() => scrapAsLineDevice(R2.id, actor, { itemId: i2, memo: '스모크' }))) === 409)
    check('[C-10] memo 없는 폐기 → 400', (await errStatus(() => scrapAsLineDevice(R7b.id, actor, { itemId: i7b, memo: '  ' }))) === 400)
    const sc7 = await scrapAsLineDevice(R7b.id, actor, { itemId: i7b, memo: '스모크 폐기' })
    u7 = await unitOf(D7); ev = await lastEvent(u7!.id)
    check('[C-10] 회수 기기 폐기 → SCRAPPED·위치 없음 + SCRAP(memo, ref AS) + 비고', sc7.condition === 'SCRAPPED' && u7?.condition === 'SCRAPPED' && u7?.locationSiteId == null && u7?.locationHospitalCode == null && ev?.eventType === 'SCRAP' && ev.memo === '스모크 폐기' && ev.refCode === R7b.asCode && (await noteOf(R7b.id)).includes('[폐기 '), JSON.stringify({ sc7, u7, ev }))
    check('[C-10] 폐기 후 재체크 → 라인 기록 + 경고(폐기 기기)', await (async () => { const r = await setAsLineRepaired(R7b.id, actor, { itemId: i7b, repaired: true }); return r.repaired && r.condition === 'SCRAPPED' && r.warnings.length === 1 })())

    // [C-11] 타병원 배치 기기 — 입고·체크 conflict 경고(라인만) → 병원 변경 재생성: 입고·수리완료 보존 + 새 병원 기기에 재적용
    if (hospitalB) {
      await registerDevices({ hospitalCode: hospitalB.hospitalCode, actor, occurredOn: todayKst(), source: 'MANUAL', memo: '[SMOKE] 수리완료' }, [{ serialInput: D11, deviceInfoId: model.id, productType: '일반' }])
      const R11 = await mkReceipt(hospital, [D11]) // 접수 병원 A ≠ 배치 병원 B → 플래그 없음
      const i11 = await R11.itemId(D11)
      const in11 = await intakeAsLines(R11.id, actor, { serials: [D11] })
      const rd11 = await setAsLineRepaired(R11.id, actor, { itemId: i11, repaired: true })
      let u11 = await unitOf(D11)
      check('[C-11] 타병원 배치 기기 입고·체크 → 원장 conflict 경고, 라인만 기록(기기 사용중 유지)', in11.warnings.some((w) => w.includes('다른 병원')) && rd11.repaired && rd11.warnings.length === 1 && u11?.condition === 'IN_USE' && atHospital(u11, hospitalB.hospitalCode), JSON.stringify({ in11: in11.warnings, rd11, u11 }))
      await prisma.asReceipt.update({ where: { id: R11.id }, data: { hospitalCode: hospitalB.hospitalCode } })
      const w11 = await prisma.$transaction(
        (tx) => applyItemChanges(tx, { id: R11.id, asCode: R11.asCode, hospitalCode: hospitalB.hospitalCode, receiptDate: new Date(todayKst()) }, [{ serial: D11 }], actor, { previousHospitalCode: hospitalCode }),
        { timeout: 60000 }
      )
      const line11 = await prisma.asReceiptItem.findFirst({ where: { receiptId: R11.id, serialNo: D11 } })
      u11 = await unitOf(D11)
      check('[C-11] 병원 변경 재생성 → 입고·수리완료 보존 + 새 병원 기기에 AS_OPEN·INTAKE·REPAIR_DONE 재적용 → 수리완료·센터·플래그',
        !!line11 && line11.id !== i11 && line11.intakeState === 'RECEIVED' && !!line11.receivedAt && !!line11.repairedAt && (await typesOf(u11!.id, R11.asCode)) === 'AS_OPEN,INTAKE,REPAIR_DONE' && u11?.condition === 'REPAIRED' && atCenter(u11) && u11?.placement?.asRefCode === R11.asCode,
        JSON.stringify({ w11, line11: { id: line11?.id, i11, st: line11?.intakeState, ra: line11?.repairedAt }, types: await typesOf(u11!.id, R11.asCode), u11 }))
    } else {
      console.log('  ⚠ 병원이 1곳뿐이라 [C-11] 병원 변경 시나리오 생략')
    }

    // [C-12] 시리얼 보정 — 구기기 IN_USE·병원(AS_CLEAR) / 신기기 AS_OPEN·INTAKE·REPAIR_DONE 재적용 + 라인 repaired_at 유지
    const R12 = await mkReceipt(hospital, [D12A])
    const i12 = await R12.itemId(D12A)
    await intakeAsLines(R12.id, actor, { serials: [D12A] })
    await setAsLineRepaired(R12.id, actor, { itemId: i12, repaired: true })
    const cs12 = await correctAsLineSerial(R12.id, actor, { itemId: i12, serial: D12B })
    const uA = await unitOf(D12A), uB = await unitOf(D12B)
    const evA = await lastEvent(uA!.id)
    const line12 = await prisma.asReceiptItem.findUnique({ where: { id: i12 } })
    check('[C-12] 시리얼 보정 → 구기기 사용중·병원(AS_CLEAR) / 신기기 AS_OPEN·INTAKE·REPAIR_DONE 재적용(수리완료·센터) + 라인 repaired_at 유지',
      cs12.serialNo === D12B && uA?.condition === 'IN_USE' && atHospital(uA, hospitalCode) && evA?.eventType === 'AS_CLEAR' && (await typesOf(uB!.id, R12.asCode)) === 'AS_OPEN,INTAKE,REPAIR_DONE' && uB?.condition === 'REPAIRED' && atCenter(uB) && !!line12?.repairedAt,
      JSON.stringify({ cs12, uA, evA: evA?.eventType, typesB: await typesOf(uB!.id, R12.asCode), uB, line12: line12?.repairedAt }))

    // [C-13] 접수 삭제 훅 — setUnitInUse(locationToHospital, memo '접수 삭제')
    const R13 = await mkReceipt(hospital, [D13])
    await intakeAsLines(R13.id, actor, { serials: [D13] })
    let u13 = await unitOf(D13)
    const w13 = await prisma.$transaction((tx) => setUnitInUse(tx, { hospitalCode, actor, occurredOn: todayKst(), source: 'MANUAL', ref: { type: 'AS', code: R13.asCode } }, u13!.id, { locationToHospital: true, memo: `접수 삭제 ${R13.asCode}` }))
    u13 = await unitOf(D13); ev = await lastEvent(u13!.id)
    check("[C-13] 접수 삭제 훅 → 사용중·병원(AS_CLEAR, memo '접수 삭제'), 경고 없음", w13.length === 0 && u13?.condition === 'IN_USE' && atHospital(u13, hospitalCode) && ev?.eventType === 'AS_CLEAR' && (ev.memo ?? '').startsWith('접수 삭제'), JSON.stringify({ w13, u13, ev }))

    // [C-14] 입고 확인 — 미회수(setUnitInUse) / 정상입고 수동 확정(INTAKE)
    const R14 = await mkReceipt(hospital, [D14A, D14B, D14C])
    await intakeAsLines(R14.id, actor, { serials: [D14A] }) // B·C 미입고
    const iB14 = await R14.itemId(D14B), iC14 = await R14.itemId(D14C)
    const cf14b = await confirmAsIntake(R14.id, actor, { type: 'NOT_RECEIVED', itemId: iB14, comment: '스모크 미회수' })
    const cf14c = await confirmAsIntake(R14.id, actor, { type: 'MARK_RECEIVED', itemId: iC14 })
    const uB14 = await unitOf(D14B), uC14 = await unitOf(D14C)
    const evB14 = await lastEvent(uB14!.id), evC14 = await lastEvent(uC14!.id)
    check("[C-14] 미회수 확정 → 사용중·병원(AS_CLEAR, memo '미회수 확정') / 정상입고 수동 확정 → AS접수·센터(INTAKE)",
      cf14b.warnings.length === 0 && uB14?.condition === 'IN_USE' && atHospital(uB14, hospitalCode) && evB14?.eventType === 'AS_CLEAR' && (evB14.memo ?? '').startsWith('미회수 확정') && cf14c.warnings.length === 0 && uC14?.condition === 'AS_WAITING' && atCenter(uC14) && evC14?.eventType === 'INTAKE' && evC14.refCode === R14.asCode,
      JSON.stringify({ cf14b, uB14, evB14: evB14?.eventType, cf14c, uC14, evC14: evC14?.eventType }))

    // [C-15] 입고 확인 — 시리얼 치환(REMAP): 치환 전 기기 IN_USE·병원(이 접수 플래그 → AS_CLEAR, memo '시리얼 치환') / 치환 후 기기 INTAKE·AS 표시(§7.3 memo 표)
    const R15 = await mkReceipt(hospital, [D15A])
    const iA15 = await R15.itemId(D15A)
    await intakeAsLines(R15.id, actor, { serials: [D15B] }) // D15A 미입고(MISMATCH) · D15B 미식별입고(EXTRA)
    const xB15 = (await prisma.asReceiptItem.findFirst({ where: { receiptId: R15.id, serialNo: D15B, intakeState: 'EXTRA' }, select: { id: true } }))!.id
    const cf15 = await confirmAsIntake(R15.id, actor, { type: 'REMAP', itemId: iA15, extraItemId: xB15 })
    const uA15 = await unitOf(D15A), uB15 = await unitOf(D15B)
    const evA15 = await lastEvent(uA15!.id), evB15 = await lastEvent(uB15!.id)
    const lineA15 = await prisma.asReceiptItem.findUnique({ where: { id: iA15 }, select: { serialNo: true, intakeState: true, receiptSerialNo: true } })
    check("[C-15] 시리얼 치환 → 라인 D15B·RECEIVED(원 시리얼 보존) / 치환 전 기기 사용중·병원(AS_CLEAR, memo '시리얼 치환')·플래그 해제 / 치환 후 기기 AS접수·센터(INTAKE ref)·플래그",
      cf15.warnings.length === 0 && lineA15?.serialNo === D15B && lineA15.intakeState === 'RECEIVED' && lineA15.receiptSerialNo === D15A
      && uA15?.condition === 'IN_USE' && atHospital(uA15, hospitalCode) && uA15?.placement?.asStartedOn === null && evA15?.eventType === 'AS_CLEAR' && (evA15.memo ?? '').startsWith('시리얼 치환')
      && uB15?.condition === 'AS_WAITING' && atCenter(uB15) && uB15?.placement?.asRefCode === R15.asCode && evB15?.eventType === 'INTAKE' && evB15.refCode === R15.asCode,
      JSON.stringify({ cf15, lineA15, uA15, evA15: evA15?.eventType, uB15, evB15: evB15?.eventType }))

    // [C-16] 소급 수리반환 — 처리일(어제) < AS 표시 시작일(오늘): AS_CLEAR 업무일자를 표시 시작일로 클램프 → 플래그 해제·사용중·병원 + 경고 1건(§7.3 — 소급 409 흡수·표시 잔존 없음)
    const R16 = await mkReceipt(hospital, [D16])
    const i16 = await R16.itemId(D16)
    await intakeAsLines(R16.id, actor, { serials: [D16] })
    const res16 = await resolveAsLines(R16.id, actor, { lines: [{ itemId: i16, outcome: 'REPAIR_RETURN', effectiveDate: yesterday }], shipMethod: 'PARCEL' })
    const u16 = await unitOf(D16)
    const ev16 = await lastEvent(u16!.id)
    check('[C-16] 처리일 < AS 표시 시작일 → AS_CLEAR(업무일자=표시 시작일)·플래그 해제·사용중·병원 + 클램프 경고 1건',
      u16?.condition === 'IN_USE' && atHospital(u16, hospitalCode) && u16?.placement?.asStartedOn === null && ev16?.eventType === 'AS_CLEAR' && ymd(ev16.occurredOn) === todayKst()
      && res16.warnings.length === 1 && res16.warnings[0].includes('앞서 AS 해제를'),
      JSON.stringify({ w: res16.warnings, u: u16, ev: ev16?.eventType, on: ymd(ev16?.occurredOn) }))

    // I-6 정합 — 이 섹션 기기 전부: 유닛 값 = id 최대 스냅샷 이벤트 after
    const unitsC = await prisma.deviceUnit.findMany({ where: { serialNo: { in: ALL_SERIALS } }, select: { id: true, serialNo: true, condition: true, locationHospitalCode: true, locationSite: { select: { value: true } } } })
    let i6Bad = 0
    for (const u of unitsC) {
      const evs = await prisma.hospitalDeviceEvent.findMany({ where: { deviceId: u.id }, orderBy: { id: 'desc' } })
      const snap = evs.map((e) => unitStateChangesOf(e.changes)).find((c) => !!c)
      if (!snap) continue
      const loc = u.locationHospitalCode ? `HOSPITAL/${u.locationHospitalCode}` : u.locationSite?.value ? `SITE/${u.locationSite.value}` : 'null/null'
      if (snap.condition.after !== u.condition || `${snap.location.after.kind}/${snap.location.after.code}` !== loc) { i6Bad++; console.log(`    I-6 불일치 ${u.serialNo}: unit ${u.condition}·${loc} vs snapshot ${snap.condition.after}·${snap.location.after.kind}/${snap.location.after.code}`) }
    }
    check('[C-I6] 섹션 기기 전부 I-6 정합(유닛 값 = id 최대 스냅샷 after)', i6Bad === 0)

    // 섹션 정리 — 접수·티켓 명시 삭제(기기는 아래 cleanupRegistry)
    for (const m of [...mine].reverse()) {
      await prisma.asReceipt.deleteMany({ where: { id: m.receiptId } })
      await prisma.ticket.deleteMany({ where: { id: m.ticketId } })
    }
    check('[C-정리] 수리완료 섹션 접수·티켓 삭제', (await prisma.asReceipt.count({ where: { id: { in: mine.map((m) => m.receiptId) } } })) === 0)

    // 정리 (명시)
    await prisma.asReceipt.delete({ where: { id: receipt.id } })
    await prisma.ticket.deleteMany({ where: { id: ticketId } })
    cleanup.length = 0
    await cleanupRegistry(hospitalCode)
  } finally {
    for (const fn of cleanup.reverse()) await fn().catch(() => {})
    if (hospitalCode) await cleanupRegistry(hospitalCode).catch(() => {})
    await prisma.$disconnect()
  }

  console.log(`\n결과: ${pass} pass / ${fail} fail`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
