/**
 * 출고업무(출고요청) 스모크 (stock_out_request_design.md §10)
 *
 * 검증:
 *  마스터 — STOCK_OUT_STATUS 5종 매핑(요청 OPEN·처리중 IN_PROGRESS·보류 PENDING·완료 CLOSED·취소 CLOSED)·품목 12종
 *  레지스트리 — 어댑터 7종·detailInclude에 stockOutRequest
 *  생성 — SOR 코드 형식·레코드+라인+티켓(refType STOCK_OUT·OPEN·병원 스냅샷·규칙 CTI/그룹)
 *  도메인→티켓 — 처리중→IN_PROGRESS / 보류→PENDING(사유) / 완료→CLOSED(resolvedAt·closedAt) / 취소→CLOSED / 요청 복귀→OPEN
 *  티켓→도메인 — CLOSED→'완료'(order 최소)·완료일 백필 / 도메인이 '취소'면 keep-if-consistent / OPEN→'요청'·완료일 해제
 *  배너 — linkedWork 조립 (code·href·프로젝트·품목 요약)
 *  헬퍼 — summarizeStockOutItems·canEditStockOutRequest 판정 표
 * 테스트 데이터는 전부 삭제한다.
 *
 *   npx tsx scripts/stock-out-smoke.mts
 */
import { PrismaClient } from '@prisma/client'
import { TICKET_DOMAIN_ADAPTERS, domainDetailIncludes, buildTicketLinkedWork } from '../lib/ticket-domains/registry'
import { createTicketForStockOut, syncStockOutToTicket, syncTicketToStockOut } from '../lib/ticket-domains/stockOut'
import { nextSorCode, summarizeStockOutItems, canEditStockOutRequest } from '../lib/stockOut'

const prisma = new PrismaClient()

let pass = 0
let fail = 0
function check(name: string, ok: boolean, note?: string) {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${note ? ` — ${note}` : ''}`) }
}

async function statusIdOf(name: string): Promise<number> {
  const row = await prisma.statusCode.findFirst({ where: { category: 'STOCK_OUT_STATUS', name }, select: { id: true } })
  if (!row) throw new Error(`STOCK_OUT_STATUS '${name}' 없음 — seed-stock-out-masters.sql 적용 필요`)
  return row.id
}

async function main() {
  const cleanup: (() => Promise<unknown>)[] = []
  try {
    // ── 마스터 ────────────────────────────────────────────────
    console.log('▶ 마스터 시드')
    const statuses = await prisma.statusCode.findMany({ where: { category: 'STOCK_OUT_STATUS' }, orderBy: { order: 'asc' } })
    check('STOCK_OUT_STATUS 5종', statuses.length === 5, `실제 ${statuses.length}`)
    const mapOf = (n: string) => statuses.find((s) => s.name === n)?.ticketStatus
    check('매핑 요청→OPEN·처리중→IN_PROGRESS·보류→PENDING', mapOf('요청') === 'OPEN' && mapOf('처리중') === 'IN_PROGRESS' && mapOf('보류') === 'PENDING')
    check("매핑 완료→CLOSED·취소→CLOSED (2026-09-03 결정 — RESOLVED 미경유)", mapOf('완료') === 'CLOSED' && mapOf('취소') === 'CLOSED')
    const itemCount = await prisma.stockOutItem.count({ where: { isActive: true } })
    check('출고 품목 12종 시드', itemCount >= 12, `실제 ${itemCount}`)
    const rule = await prisma.ticketDomainCtiRule.findFirst({ where: { refType: 'STOCK_OUT', matchStatusCodeId: null } })
    check('자동생성 규칙 기본 행 존재', !!rule)

    // ── 레지스트리 ────────────────────────────────────────────
    console.log('▶ 어댑터 레지스트리')
    check('어댑터 등록 (STOCK_OUT 포함, 7종 이상)', Object.keys(TICKET_DOMAIN_ADAPTERS).length >= 7 && 'STOCK_OUT' in TICKET_DOMAIN_ADAPTERS) // 2026-09-04 AS 추가로 8종 — 이후 도메인 추가에 안전하게 >= 로
    check('detailInclude에 stockOutRequest', 'stockOutRequest' in domainDetailIncludes())

    // ── 생성 ─────────────────────────────────────────────────
    console.log('▶ 생성 — 레코드+라인+티켓')
    const project = await prisma.project.findFirst({
      select: { projectCode: true, projectName: true, hospitalCode: true },
      orderBy: { id: 'asc' },
    })
    if (!project) throw new Error('프로젝트가 없어 스모크를 진행할 수 없습니다.')
    const anyUser = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } })
    if (!anyUser) throw new Error('사용자가 없습니다.')
    const items = await prisma.stockOutItem.findMany({ where: { isActive: true }, orderBy: { id: 'asc' }, take: 3 })

    const sorCode = await nextSorCode()
    check('SOR 코드 형식 SOR-YYYYMM-NNNN', /^SOR-\d{6}-\d{4}$/.test(sorCode))

    const reqStatusId = await statusIdOf('요청')
    const sor = await prisma.stockOutRequest.create({
      data: {
        sorCode,
        projectCode: project.projectCode,
        statusId: reqStatusId,
        requestDate: new Date(),
        note: '[SMOKE] 구축 자재 출고요청',
        createdById: anyUser.id,
      },
    })
    cleanup.push(() => prisma.stockOutRequest.deleteMany({ where: { id: sor.id } }))
    await prisma.stockOutRequestItem.createMany({
      data: items.map((it, i) => ({ requestId: sor.id, itemId: it.id, quantity: i + 1 })),
    })

    const ticketId = await prisma.$transaction((tx) =>
      createTicketForStockOut(tx, {
        id: sor.id, sorCode: sor.sorCode, projectName: project.projectName,
        hospitalCode: project.hospitalCode, statusName: '요청', statusId: sor.statusId,
        note: sor.note, requestDate: sor.requestDate, resolvedAt: null, createdAt: sor.createdAt,
      }, anyUser.id, 'domain')
    )
    cleanup.push(() => prisma.ticket.deleteMany({ where: { id: ticketId } }))

    let ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
    check('티켓 생성 refType STOCK_OUT·OPEN', ticket?.refType === 'STOCK_OUT' && ticket?.status === 'OPEN')
    check('티켓 제목 [출고요청] 프리픽스', !!ticket?.title.startsWith('[출고요청]'))
    check('티켓 병원 = 프로젝트 병원 스냅샷', ticket?.hospitalCode === project.hospitalCode)
    check('티켓 CTI = 규칙 CTI·그룹 배정', ticket?.ctiId === rule?.ctiId && ticket?.queueId != null)
    const linked = await prisma.stockOutRequest.findUnique({ where: { id: sor.id }, select: { ticketId: true } })
    check('도메인 ticketId 1:1 연결', linked?.ticketId === ticketId)

    // ── 도메인→티켓 ──────────────────────────────────────────
    console.log('▶ 도메인→티켓 동기화')
    const set = async (name: string) => {
      await prisma.stockOutRequest.update({ where: { id: sor.id }, data: { statusId: await statusIdOf(name) } })
      await prisma.$transaction((tx) => syncStockOutToTicket(tx, sor.id, anyUser.id))
      return prisma.ticket.findUnique({ where: { id: ticketId } })
    }
    ticket = await set('처리중')
    check('처리중 → IN_PROGRESS', ticket?.status === 'IN_PROGRESS')
    ticket = await set('보류')
    check('보류 → PENDING + 사유', ticket?.status === 'PENDING' && ticket?.pendingReasonId != null)
    ticket = await set('완료')
    check('완료 → CLOSED (RESOLVED 미경유)', ticket?.status === 'CLOSED' && !!ticket?.resolvedAt && !!ticket?.closedAt)
    ticket = await set('요청')
    check('요청 복귀 → OPEN·종결시각 해제', ticket?.status === 'OPEN' && ticket?.resolvedAt === null && ticket?.closedAt === null && ticket?.pendingReasonId === null)
    ticket = await set('취소')
    check('취소 → CLOSED', ticket?.status === 'CLOSED')

    // ── 티켓→도메인 ──────────────────────────────────────────
    console.log('▶ 티켓→도메인 역동기화')
    // 도메인이 '취소'인 채 티켓 CLOSED — keep-if-consistent (같은 버킷이라 변경 없음)
    await prisma.$transaction((tx) => syncTicketToStockOut(tx, ticketId))
    let after = await prisma.stockOutRequest.findUnique({ where: { id: sor.id }, include: { status: true } })
    check("티켓 CLOSED + 도메인 '취소' → keep-if-consistent", after?.status?.name === '취소')
    check('완료일 백필 (CLOSED 버킷)', after?.resolvedAt != null)

    // 티켓 OPEN → 도메인 '요청' + 완료일 해제
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: 'OPEN', resolvedAt: null, closedAt: null } })
    await prisma.$transaction((tx) => syncTicketToStockOut(tx, ticketId))
    after = await prisma.stockOutRequest.findUnique({ where: { id: sor.id }, include: { status: true } })
    check("티켓 OPEN → 도메인 '요청'·완료일 해제", after?.status?.name === '요청' && after?.resolvedAt === null)

    // 티켓 CLOSED → 도메인 '완료' (버킷 order 최소 — 취소보다 완료 우선)
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: 'CLOSED', resolvedAt: new Date(), closedAt: new Date() } })
    await prisma.$transaction((tx) => syncTicketToStockOut(tx, ticketId))
    after = await prisma.stockOutRequest.findUnique({ where: { id: sor.id }, include: { status: true } })
    check("티켓 CLOSED → 도메인 '완료' (order 최소)", after?.status?.name === '완료' && after?.resolvedAt != null)

    // ── 배너 ─────────────────────────────────────────────────
    console.log('▶ 연결 업무 배너')
    const full = await prisma.ticket.findUnique({ where: { id: ticketId }, include: domainDetailIncludes() })
    const lw = buildTicketLinkedWork(full as unknown as { refType: string | null })
    check('linkedWork 조립 (code·href)', lw?.refType === 'STOCK_OUT' && lw?.code === sorCode && lw?.href === `/stock-out-requests/${sor.id}`)
    check('linkedWork meta에 프로젝트·품목 요약', !!lw?.meta.includes(project.projectName) && !!lw?.meta.includes('총'))

    // ── 헬퍼 ─────────────────────────────────────────────────
    console.log('▶ 헬퍼')
    check('summarizeStockOutItems 요약',
      summarizeStockOutItems([{ quantity: 2, item: { name: 'A' } }, { quantity: 3, item: { name: 'B' } }]) === 'A 2 외 1종 · 총 5개' &&
      summarizeStockOutItems([]) === '품목 없음')
    const own = { createdById: anyUser.id, status: { ticketStatus: 'OPEN' as const } }
    const ownDone = { createdById: anyUser.id, status: { ticketStatus: 'CLOSED' as const } }
    const other = { createdById: 'someone-else', status: { ticketStatus: 'OPEN' as const } }
    check('수정 권한 — ADMIN 항상', canEditStockOutRequest({ userId: 'x', role: 'ADMIN' }, ownDone))
    check('수정 권한 — USER 본인·종결 전 허용', canEditStockOutRequest({ userId: anyUser.id, role: 'USER' }, own))
    check('수정 권한 — USER 본인·종결 후 차단', !canEditStockOutRequest({ userId: anyUser.id, role: 'USER' }, ownDone))
    check('수정 권한 — USER 타인 요청 차단', !canEditStockOutRequest({ userId: anyUser.id, role: 'USER' }, other))
    check('수정 권한 — VIEWER 차단', !canEditStockOutRequest({ userId: anyUser.id, role: 'VIEWER' }, own))

    // ── 삭제 — 라인 CASCADE ──────────────────────────────────
    console.log('▶ 정리·CASCADE')
    await prisma.stockOutRequest.delete({ where: { id: sor.id } })
    const lineLeft = await prisma.stockOutRequestItem.count({ where: { requestId: sor.id } })
    check('요청 삭제 시 라인 CASCADE', lineLeft === 0)
    cleanup.length = 0
    await prisma.ticket.deleteMany({ where: { id: ticketId } })
  } finally {
    for (const fn of cleanup.reverse()) await fn().catch(() => {})
    await prisma.$disconnect()
  }

  console.log(`\n결과: ${pass} pass / ${fail} fail`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
