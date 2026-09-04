/**
 * AS업무(AS접수) 스모크 (as_work_design.md §10)
 *
 * 검증:
 *  마스터 — AS_STATUS 8종 매핑(접수 OPEN·수거중/입고/처리중/발송 IN_PROGRESS·보류 PENDING·완료/취소 CLOSED)·규칙·LOST 사유
 *  레지스트리 — 어댑터 8종·detailInclude에 asReceipt·REGISTRY_REF_TYPES 'AS'·refLink
 *  생성 — AS 코드 형식·매칭(ACTIVE_HERE/NONE)·레코드+라인+티켓(refType AS·제목·병원)·AS 표시(asRefCode)·중복 표시 경고
 *  도메인→티켓 — 수거중 IN_PROGRESS / 보류 PENDING / 접수 OPEN
 *  라인 처리 — 수리반환(AS_CLEAR·발송 기록) / 교체(replaceDevice — 구 RECOVERED·신 ACTIVE·newDeviceId) /
 *             분실(recoverDevice LOST) / 미등록 경고 / 전 라인 종결 → 완료 자동·티켓 CLOSED / 종결 후 처리 409
 *  티켓→도메인 — OPEN→'접수'·완료일 해제 / CLOSED→'완료'
 *  라인 편집 — applyItemChanges (라인 제거 시 이 접수의 플래그만 해제 + 신규 라인 추가)
 *  배너·헬퍼 — linkedWork·canEditAsReceipt·summarizeAsItems / 삭제 CASCADE
 * 테스트 데이터(기기·이벤트·병동·접수·티켓)는 전부 삭제한다.
 *
 *   npx tsx scripts/as-receipt-smoke.mts
 */
import { PrismaClient } from '@prisma/client'
import { TICKET_DOMAIN_ADAPTERS, domainDetailIncludes, buildTicketLinkedWork } from '../lib/ticket-domains/registry'
import { createTicketForAsReceipt, syncAsReceiptToTicket, syncTicketToAsReceipt } from '../lib/ticket-domains/asReceipt'
import { nextAsCode, canEditAsReceipt } from '../lib/asReceipt'
import { summarizeAsItems } from '../lib/asReceiptShared'
import { matchSerials, matchWarning, openAsFlags, resolveAsLines, applyItemChanges, AsServiceError } from '../lib/asReceiptService'
import { registerDevices } from '../lib/deviceRegistry/write'
import { REGISTRY_REF_TYPES, refLink, todayKst } from '../lib/deviceRegistryShared'

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
const ALL_SERIALS = [S1, S2, S3, S4, S5, SX, SX2]
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
    check('매핑 접수→OPEN·수거중/입고/처리중/발송→IN_PROGRESS',
      mapOf('접수') === 'OPEN' && mapOf('수거중') === 'IN_PROGRESS' && mapOf('입고') === 'IN_PROGRESS' && mapOf('처리중') === 'IN_PROGRESS' && mapOf('발송') === 'IN_PROGRESS')
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
    check('전 라인 종결 → 헤더 완료 자동', res.autoCompleted)
    const doneReceipt = await prisma.asReceipt.findUnique({ where: { id: receipt.id }, include: { status: true } })
    ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
    check("헤더 '완료'·완료일 + 티켓 CLOSED", doneReceipt?.status?.name === '완료' && doneReceipt?.resolvedAt != null && ticket?.status === 'CLOSED')

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
    check('수정 권한 — USER 타인 등록 차단', !canEditAsReceipt({ userId: anyUser.id, role: 'USER' }, other))
    check('수정 권한 — VIEWER 차단', !canEditAsReceipt({ userId: anyUser.id, role: 'VIEWER' }, own))

    await prisma.asReceipt.delete({ where: { id: receipt2.id } })
    const lineLeft = await prisma.asReceiptItem.count({ where: { receiptId: receipt2.id } })
    check('접수 삭제 시 라인 CASCADE', lineLeft === 0)

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
