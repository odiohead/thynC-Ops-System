/**
 * CS 티켓 워크플로 스모크 (cs_ticket_workflow_design.md — 2026-08-15 개정판)
 *
 * 검증:
 *  P0 — 레지스트리: 어댑터 6종 등록·미등록 refType 폴백(no-op/null)·detailInclude 병합·
 *       기존 도메인(유지보수) 왕복 동기화 동작 불변 (create → 도메인→티켓 → 티켓→도메인)
 *  VOC — 생성→티켓 자동생성(refType VOC·CS 그룹·CTI 일반·접수→OPEN·생성자 기록) →
 *       도메인→티켓(처리중→IN_PROGRESS) → 티켓→도메인(RESOLVED→회신완료·resolvedAt) →
 *       티켓 CLOSED 시 완료일 백필(상태 변경과 독립) → 배너 데이터
 *  P3 — 하위 연결: 유지보수 티켓 parentId → VOC 마스터, 2레벨 검증
 * ※ 콜기록지·VOC 담당자 N:M은 2026-08-15 사용자 결정으로 제거 — 관련 검증 삭제
 * 테스트 데이터는 전부 삭제한다.
 *
 *   npx tsx scripts/cs-workflow-smoke.mts
 */
import { PrismaClient } from '@prisma/client'
import { TICKET_DOMAIN_ADAPTERS, getDomainAdapter, domainDetailIncludes, buildTicketLinkedWork, syncTicketToDomain } from '../lib/ticket-domains/registry'
import { createTicketForVoc, syncVocToTicket, syncTicketToVoc } from '../lib/ticket-domains/voc'
import { createTicketForMaintenance, syncMaintenanceToTicket, syncTicketToMaintenance } from '../lib/ticket-domains/maintenance'
import { nextVocCode } from '../lib/csCodes'

const prisma = new PrismaClient()

let pass = 0
let fail = 0
function check(name: string, ok: boolean, note?: string) {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${note ? ` — ${note}` : ''}`) }
}

async function main() {
  const cleanup: (() => Promise<unknown>)[] = []
  try {
    // ── P0: 레지스트리 형상 ──────────────────────────────────
    console.log('▶ P0 — 어댑터 레지스트리')
    check('어댑터 등록 (6종 이상)', Object.keys(TICKET_DOMAIN_ADAPTERS).length >= 6) // 2026-09-03 STOCK_OUT·2026-09-04 AS 추가 — 이후 도메인 추가에 안전하게 >= 로
    check('미등록 refType → null 어댑터', getDomainAdapter('NOPE') === null && getDomainAdapter(null) === null)
    const inc = domainDetailIncludes()
    check(
      'detailInclude 병합 (maintenance·etcTask·siteVisit·installPlan·project·voc)',
      ['maintenance', 'etcTask', 'siteVisit', 'installPlan', 'project', 'voc'].every((k) => k in inc)
    )
    check('미연결 티켓 linkedWork null', buildTicketLinkedWork({ refType: 'MAINTENANCE' }) === null)
    await prisma.$transaction(async (tx) => { await syncTicketToDomain(tx, -1, 'RETIRED_TYPE') })
    check('미등록 refType syncTicketToDomain no-op', true)

    const hospital = await prisma.hospital.findFirst({ select: { hospitalCode: true, hospitalName: true } })
    if (!hospital) throw new Error('병원 데이터가 없어 스모크를 진행할 수 없습니다.')
    const anyUser = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } })
    if (!anyUser) throw new Error('사용자가 없습니다.')

    // ── P0: 기존 도메인(유지보수) 왕복 — 동작 불변 ──────────
    console.log('▶ P0 — 유지보수 왕복 (기존 5종 대표)')
    const acceptM = await prisma.statusCode.findFirst({ where: { category: 'MAINTENANCE_STATUS', name: '접수' } })
    const doneM = await prisma.statusCode.findFirst({ where: { category: 'MAINTENANCE_STATUS', name: '완료' } })
    const m = await prisma.maintenance.create({
      data: {
        maintenanceCode: `MNT-SMOKE-${Date.now() % 100000}`,
        hospitalCode: hospital.hospitalCode,
        title: '[SMOKE] CS 워크플로 회귀',
        statusId: acceptM?.id ?? null,
        priority: '보통',
      },
    })
    cleanup.push(() => prisma.maintenance.deleteMany({ where: { id: m.id } }))
    const mTicketId = await prisma.$transaction((tx) =>
      createTicketForMaintenance(tx, {
        id: m.id, maintenanceCode: m.maintenanceCode, title: m.title, hospitalCode: m.hospitalCode,
        priority: m.priority, statusName: '접수', statusId: m.statusId, typeName: null, typeId: null,
        symptoms: null, assigneeUserIds: [], reportedAt: null, resolvedAt: null, createdAt: m.createdAt,
      }, null, 'domain')
    )
    cleanup.push(() => prisma.ticket.deleteMany({ where: { id: mTicketId } }))
    let mTicket = await prisma.ticket.findUnique({ where: { id: mTicketId } })
    check('유지보수 티켓 생성 (refType MAINTENANCE·OPEN)', mTicket?.refType === 'MAINTENANCE' && mTicket?.status === 'OPEN')

    await prisma.maintenance.update({ where: { id: m.id }, data: { statusId: doneM?.id ?? null, resolvedAt: new Date() } })
    await prisma.$transaction((tx) => syncMaintenanceToTicket(tx, m.id, null))
    mTicket = await prisma.ticket.findUnique({ where: { id: mTicketId } })
    check('유지보수 완료 → 티켓 CLOSED (도메인→티켓)', mTicket?.status === 'CLOSED')

    await prisma.ticket.update({ where: { id: mTicketId }, data: { status: 'OPEN', resolvedAt: null, closedAt: null } })
    await prisma.$transaction((tx) => syncTicketToMaintenance(tx, mTicketId))
    const mAfter = await prisma.maintenance.findUnique({ where: { id: m.id }, select: { status: { select: { name: true } }, resolvedAt: true } })
    check('티켓 OPEN → 유지보수 접수 (티켓→도메인)', mAfter?.status?.name === '접수' && mAfter?.resolvedAt === null)

    const mFull = await prisma.ticket.findUnique({ where: { id: mTicketId }, include: domainDetailIncludes() })
    const lw = buildTicketLinkedWork(mFull as unknown as { refType: string | null })
    check('유지보수 linkedWork 조립 (code·href)', lw?.refType === 'MAINTENANCE' && lw?.href === `/maintenances/${m.id}` && !!lw?.code)

    // ── VOC 도메인 왕복 (생성자 기록·담당은 티켓 소유) ───────
    console.log('▶ VOC접수 도메인')
    const vocAccept = await prisma.statusCode.findFirst({ where: { category: 'VOC_STATUS', name: '접수' } })
    const vocInProg = await prisma.statusCode.findFirst({ where: { category: 'VOC_STATUS', name: '처리중' } })
    check('VOC_STATUS 시드·매핑 (접수→OPEN)', vocAccept != null && (await prisma.statusCode.findUnique({ where: { id: vocAccept!.id } }))?.ticketStatus === 'OPEN')

    const voc = await prisma.vocReceipt.create({
      data: {
        vocCode: await nextVocCode(),
        title: '[SMOKE] 응대 불만',
        hospitalCode: hospital.hospitalCode,
        statusId: vocAccept?.id ?? null,
        content: '고객 불만 내용',
        createdById: anyUser.id,
      },
    })
    cleanup.push(() => prisma.vocReceipt.deleteMany({ where: { id: voc.id } }))
    check('VOC 코드 형식 VOC-YYYYMM-NNNN', /^VOC-\d{6}-\d{4}$/.test(voc.vocCode))
    check('생성자 기록 (createdById)', voc.createdById === anyUser.id)

    const vocTicketId = await prisma.$transaction((tx) =>
      createTicketForVoc(tx, {
        id: voc.id, vocCode: voc.vocCode, title: voc.title, hospitalCode: voc.hospitalCode, hospitalName: null,
        statusName: '접수', statusId: voc.statusId, vocTypeId: null, content: voc.content,
        receivedAt: voc.receivedAt, resolvedAt: null, createdAt: voc.createdAt,
      }, anyUser.id, 'domain')
    )
    cleanup.push(() => prisma.ticket.deleteMany({ where: { id: vocTicketId } }))

    let vocTicket = await prisma.ticket.findUnique({ where: { id: vocTicketId }, include: { queue: true, cti: true } })
    check('VOC 티켓 생성 (refType VOC·OPEN·미배정)', vocTicket?.refType === 'VOC' && vocTicket?.status === 'OPEN' && vocTicket?.ownerId === null)
    check("Assignment Group 'CS' 배정 (규칙)", vocTicket?.queue?.name === 'CS')
    check("CTI '일반' (고객지원>VOC>일반)", vocTicket?.cti?.name === '일반')
    check('제목 [VOC] prefix', vocTicket?.title === `[VOC] ${voc.title}`)
    check('설명 자동입력 (내용→HTML)', !!vocTicket?.descriptionHtml && vocTicket!.descriptionHtml!.includes('자동 입력'))

    // 도메인→티켓: 처리중 (티켓 owner는 건드리지 않음)
    await prisma.vocReceipt.update({ where: { id: voc.id }, data: { statusId: vocInProg?.id ?? null } })
    await prisma.$transaction((tx) => syncVocToTicket(tx, voc.id, null))
    vocTicket = await prisma.ticket.findUnique({ where: { id: vocTicketId }, include: { queue: true, cti: true } })
    check('VOC 처리중 → 티켓 IN_PROGRESS (도메인→티켓)', vocTicket?.status === 'IN_PROGRESS')

    // 티켓→도메인: RESOLVED → 회신완료 + resolvedAt
    await prisma.ticket.update({ where: { id: vocTicketId }, data: { status: 'RESOLVED', resolvedAt: new Date() } })
    await prisma.$transaction((tx) => syncTicketToVoc(tx, vocTicketId))
    let vocAfter = await prisma.vocReceipt.findUnique({ where: { id: voc.id }, select: { status: { select: { name: true } }, resolvedAt: true } })
    check('티켓 RESOLVED → VOC 회신완료·완료일 기록 (티켓→도메인)', vocAfter?.status?.name === '회신완료' && vocAfter?.resolvedAt != null)

    // 완료일 백필이 상태 변경과 독립인지 — 회신완료 유지 상태에서 완료일만 비우고 티켓 CLOSED
    await prisma.vocReceipt.update({ where: { id: voc.id }, data: { resolvedAt: null } })
    await prisma.ticket.update({ where: { id: vocTicketId }, data: { status: 'CLOSED', closedAt: new Date() } })
    await prisma.$transaction((tx) => syncTicketToVoc(tx, vocTicketId))
    vocAfter = await prisma.vocReceipt.findUnique({ where: { id: voc.id }, select: { status: { select: { name: true } }, resolvedAt: true } })
    check('티켓 CLOSED (keep-if-consistent) → 완료일 백필 (상태 변경 없이)', vocAfter?.resolvedAt != null)

    const vocFull = await prisma.ticket.findUnique({ where: { id: vocTicketId }, include: domainDetailIncludes() })
    const vlw = buildTicketLinkedWork(vocFull as unknown as { refType: string | null })
    check('VOC linkedWork 조립', vlw?.refType === 'VOC' && vlw?.href === `/voc/${voc.id}` && vlw?.code === voc.vocCode)

    // ── P3: 하위 연결 ────────────────────────────────────────
    console.log('▶ P3 — 마스터-하위 연결')
    await prisma.ticket.update({ where: { id: vocTicketId }, data: { status: 'OPEN', closedAt: null, resolvedAt: null } })
    await prisma.ticket.update({ where: { id: mTicketId }, data: { parentId: vocTicketId } })
    const children = await prisma.ticket.count({ where: { parentId: vocTicketId } })
    check('유지보수 티켓 → VOC 마스터의 하위 (parentId)', children === 1)
    const grand = await prisma.ticket.findUnique({ where: { id: mTicketId }, select: { parentId: true } })
    check('하위 티켓은 parent 보유 (2레벨 형상)', grand?.parentId === vocTicketId)
  } finally {
    for (const fn of cleanup.reverse()) {
      try { await fn() } catch (e) { console.error('  (cleanup 실패)', e) }
    }
    await prisma.$disconnect()
  }

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
