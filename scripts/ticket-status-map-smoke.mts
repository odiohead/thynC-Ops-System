/**
 * 도메인↔티켓 상태 매핑 스모크 (ticket_status_map_design.md §9)
 *
 * 검증:
 *  - 순방향: 매핑 컬럼 우선 (접수/처리중/보류/완료 + owner→ASSIGNED 자동 판정)
 *  - 순방향: 커스텀 상태(예: 부품대기)도 매핑대로 — 기존 "이름 모르면 조용히 접수 처리" 결함 해소
 *  - 순방향: 매핑 NULL이면 기존 하드코딩 폴백 (동기화 실패 없음)
 *  - 역방향: keep-if-consistent (작성완료(PENDING) 티켓 PENDING 재조작 시 보류로 강등 안 됨)
 *  - 역방향: PENDING 사유 우선 선택 (외부 회신 대기→작성완료 / 기타→보류)
 *  - 역방향: RESOLVED·CLOSED 같은 버킷 (→ 완료)
 *  - 프로젝트: build_statuses.ticket_status 순·역방향 (라벨 문자열 의존 제거)
 *  - 시드 대조: 현행 하드코딩과 동일 (배포 직후 동작 동일 보장)
 * 테스트 데이터는 전부 삭제한다.
 *
 *   npx tsx scripts/ticket-status-map-smoke.mts
 */

import { PrismaClient, Prisma } from '@prisma/client'
import {
  createTicketForMaintenance,
  syncMaintenanceToTicket,
  syncTicketToMaintenance,
  syncTicketToSiteVisit,
  createTicketForProject,
  syncTicketToProject,
  createTicketForInstallPlan,
  syncTicketToInstallPlan,
} from '../lib/ticketDomain'
import { generateTicketCode } from '../lib/ticket'

const prisma = new PrismaClient()
const TAG = '___status_map_smoke'

let pass = 0
let fail = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

async function cleanup() {
  // 프로젝트·설치계획 티켓은 '[프로젝트] [TAG]…' 형태라 startsWith가 아닌 contains로 걸러야 한다
  const tickets = await prisma.ticket.findMany({ where: { title: { contains: `[${TAG}]` } }, select: { id: true } })
  const ids = tickets.map((t) => t.id)
  await prisma.maintenance.deleteMany({ where: { title: { startsWith: `[${TAG}]` } } })
  await prisma.siteVisit.deleteMany({ where: { notes: TAG } })
  await prisma.installPlan.deleteMany({ where: { note: TAG } })
  await prisma.project.deleteMany({ where: { projectCode: { startsWith: TAG } } })
  if (ids.length) {
    await prisma.ticketLog.deleteMany({ where: { ticketId: { in: ids } } })
    await prisma.ticketParticipant.deleteMany({ where: { ticketId: { in: ids } } })
    await prisma.ticketSlaClock.deleteMany({ where: { ticketId: { in: ids } } })
    await prisma.ticket.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.statusCode.deleteMany({ where: { name: { startsWith: TAG } } })
}

async function main() {
  await cleanup()

  const hospital = await prisma.hospital.findFirst({ select: { hospitalCode: true } })
  const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } })
  if (!hospital || !user) throw new Error('테스트용 병원/사용자 없음')

  const sc = async (category: string, name: string) => {
    const row = await prisma.statusCode.findFirst({ where: { category, name } })
    if (!row) throw new Error(`status_code 없음: ${category}/${name}`)
    return row
  }
  const reason = async (name: string) => {
    const row = await prisma.ticketPendingReason.findUnique({ where: { name } })
    if (!row) throw new Error(`pending_reason 없음: ${name}`)
    return row
  }

  const mAccept = await sc('MAINTENANCE_STATUS', '접수')
  const mWork = await sc('MAINTENANCE_STATUS', '처리중')
  const mHold = await sc('MAINTENANCE_STATUS', '보류')
  const mDone = await sc('MAINTENANCE_STATUS', '완료')
  const svAccept = await sc('SITE_VISIT', '접수')
  const svWritten = await sc('SITE_VISIT', '작성완료')
  const svHold = await sc('SITE_VISIT', '보류')
  const svDone = await sc('SITE_VISIT', '회신완료')
  const rWait = await reason('외부 회신 대기')
  const rEtc = await reason('기타')

  const buildHold = await prisma.buildStatus.findFirst({ where: { label: { contains: '보류' } } })
  const buildDone = await prisma.buildStatus.findFirst({ where: { label: { contains: '완료' } } })
  const buildReady = await prisma.buildStatus.findFirst({ where: { label: { contains: '준비' } } })
  if (!buildHold || !buildDone || !buildReady) throw new Error('build_statuses 기본 행 없음')

  // ── 준비: 커스텀 상태 2종 (매핑 있음 / 매핑 없음) ──
  const mCustomMapped = await prisma.statusCode.create({
    data: { name: `${TAG}_부품대기`, category: 'MAINTENANCE_STATUS', ticketStatus: 'PENDING', ticketPendingReasonId: rEtc.id, order: 90 },
  })
  const mCustomUnmapped = await prisma.statusCode.create({
    data: { name: `${TAG}_미매핑`, category: 'MAINTENANCE_STATUS', order: 91 },
  })

  const mkMaint = (statusId: number | null, ownerIds: string[] = []) =>
    prisma.maintenance.create({
      data: {
        title: `[${TAG}] 유지보수`,
        hospitalCode: hospital.hospitalCode,
        statusId,
        assignees: ownerIds.length ? { create: ownerIds.map((userId) => ({ userId })) } : undefined,
      },
      include: { status: true, type: true, assignees: true },
    })
  const callCreateMaint = (m: Awaited<ReturnType<typeof mkMaint>>) =>
    prisma.$transaction(async (tx) =>
      createTicketForMaintenance(tx, {
        id: m.id,
        maintenanceCode: null,
        title: m.title,
        hospitalCode: m.hospitalCode,
        priority: m.priority,
        statusName: m.status?.name ?? null,
        statusId: m.statusId,
        typeName: null,
        symptoms: null,
        assigneeUserIds: m.assignees.map((a) => a.userId),
        reportedAt: null,
        resolvedAt: m.resolvedAt,
        createdAt: m.createdAt,
      }, null, 'domain')
    )
  const ticketOf = (id: number) => prisma.ticket.findUniqueOrThrow({ where: { id } })

  console.log('\n■ 순방향 — 매핑 컬럼 우선')
  {
    const m = await mkMaint(mAccept.id)
    const t = await ticketOf(await callCreateMaint(m))
    check('접수(owner 없음) → OPEN', t.status === 'OPEN', t.status)
  }
  {
    const m = await mkMaint(mAccept.id, [user.id])
    const t = await ticketOf(await callCreateMaint(m))
    check('접수 + owner → ASSIGNED (owner 자동 판정)', t.status === 'ASSIGNED', t.status)
  }
  {
    const m = await mkMaint(mWork.id)
    const t = await ticketOf(await callCreateMaint(m))
    check('처리중 → IN_PROGRESS', t.status === 'IN_PROGRESS', t.status)
  }
  {
    const m = await mkMaint(mHold.id)
    const t = await ticketOf(await callCreateMaint(m))
    check('보류 → PENDING', t.status === 'PENDING', t.status)
    check("보류 사유 = '기타' (매핑 행 지정)", t.pendingReasonId === rEtc.id, String(t.pendingReasonId))
  }
  {
    const m = await mkMaint(mDone.id)
    const t = await ticketOf(await callCreateMaint(m))
    check('완료 → CLOSED (결정①A)', t.status === 'CLOSED', t.status)
    check('완료 시 closedAt 기록', !!t.closedAt)
  }
  {
    const m = await mkMaint(mCustomMapped.id)
    const t = await ticketOf(await callCreateMaint(m))
    check('커스텀 상태(부품대기, PENDING 매핑) → PENDING — 기존엔 조용히 OPEN', t.status === 'PENDING', t.status)
  }
  {
    const m = await mkMaint(mCustomUnmapped.id)
    const t = await ticketOf(await callCreateMaint(m))
    check('매핑 NULL 커스텀 상태 → 하드코딩 폴백 OPEN (실패 없음)', t.status === 'OPEN', t.status)
  }

  console.log('\n■ 순방향 sync — 도메인 상태 변경 → 티켓')
  {
    const m = await mkMaint(mAccept.id)
    const tid = await callCreateMaint(m)
    await prisma.maintenance.update({ where: { id: m.id }, data: { statusId: mWork.id } })
    await prisma.$transaction(async (tx) => syncMaintenanceToTicket(tx, m.id, null))
    const t = await ticketOf(tid)
    check('접수→처리중 저장 → 티켓 IN_PROGRESS', t.status === 'IN_PROGRESS', t.status)
    await prisma.maintenance.update({ where: { id: m.id }, data: { statusId: mCustomMapped.id } })
    await prisma.$transaction(async (tx) => syncMaintenanceToTicket(tx, m.id, null))
    const t2 = await ticketOf(tid)
    check('처리중→부품대기 저장 → 티켓 PENDING + 사유 기타', t2.status === 'PENDING' && t2.pendingReasonId === rEtc.id, `${t2.status}/${t2.pendingReasonId}`)
  }

  console.log('\n■ 역방향 — keep-if-consistent · 사유 우선 · 버킷')
  const anyQueue = await prisma.ticketQueue.findFirst({ where: { isActive: true }, select: { id: true } })
  if (!anyQueue) throw new Error('활성 Assignment Group 없음')
  const mkSvTicket = async (svStatusId: number, ticketStatus: Prisma.TicketUncheckedCreateInput['status'], pendingReasonId: number | null) => {
    const t = await prisma.$transaction(async (tx) =>
      tx.ticket.create({
        data: {
          ticketCode: await generateTicketCode(tx),
          title: `[${TAG}] 답사`,
          status: ticketStatus,
          queueId: anyQueue.id,
          refType: 'SITE_VISIT',
          pendingReasonId,
        },
      })
    )
    const sv = await prisma.siteVisit.create({
      data: { hospitalCode: hospital.hospitalCode, statusId: svStatusId, notes: TAG, ticketId: t.id },
    })
    return { t, sv }
  }
  {
    // 작성완료(PENDING·회신대기) 상태에서 티켓 PENDING 재조작 → 보류로 강등되지 않아야 함
    const { t, sv } = await mkSvTicket(svWritten.id, 'PENDING', rWait.id)
    await prisma.$transaction(async (tx) => syncTicketToSiteVisit(tx, t.id))
    const after = await prisma.siteVisit.findUniqueOrThrow({ where: { id: sv.id } })
    check('작성완료 + 티켓 PENDING → 작성완료 유지 (keep-if-consistent)', after.statusId === svWritten.id, String(after.statusId))
  }
  {
    const { t, sv } = await mkSvTicket(svAccept.id, 'PENDING', rWait.id)
    await prisma.$transaction(async (tx) => syncTicketToSiteVisit(tx, t.id))
    const after = await prisma.siteVisit.findUniqueOrThrow({ where: { id: sv.id } })
    check("접수 + PENDING(외부 회신 대기) → '작성완료' (사유 우선)", after.statusId === svWritten.id, String(after.statusId))
  }
  {
    const { t, sv } = await mkSvTicket(svAccept.id, 'PENDING', rEtc.id)
    await prisma.$transaction(async (tx) => syncTicketToSiteVisit(tx, t.id))
    const after = await prisma.siteVisit.findUniqueOrThrow({ where: { id: sv.id } })
    check("접수 + PENDING(기타) → '보류' (사유 우선)", after.statusId === svHold.id, String(after.statusId))
  }
  {
    const { t, sv } = await mkSvTicket(svAccept.id, 'RESOLVED', null)
    await prisma.$transaction(async (tx) => syncTicketToSiteVisit(tx, t.id))
    const after = await prisma.siteVisit.findUniqueOrThrow({ where: { id: sv.id } })
    check("RESOLVED → '회신완료' (RESOLVED·CLOSED 같은 버킷) + replyDate", after.statusId === svDone.id && !!after.replyDate, String(after.statusId))
  }
  {
    const { t, sv } = await mkSvTicket(svDone.id, 'CLOSED', null)
    await prisma.$transaction(async (tx) => syncTicketToSiteVisit(tx, t.id))
    const after = await prisma.siteVisit.findUniqueOrThrow({ where: { id: sv.id } })
    check('회신완료 + 티켓 CLOSED(자동종결 등) → 회신완료 유지', after.statusId === svDone.id, String(after.statusId))
  }
  {
    // 유지보수 역방향: IN_PROGRESS → 처리중
    const t = await prisma.$transaction(async (tx) =>
      tx.ticket.create({
        data: { ticketCode: await generateTicketCode(tx), title: `[${TAG}] 유지보수역`, status: 'IN_PROGRESS', queueId: anyQueue.id, refType: 'MAINTENANCE' },
      })
    )
    const m = await prisma.maintenance.create({
      data: { title: `[${TAG}] 유지보수역`, hospitalCode: hospital.hospitalCode, statusId: mAccept.id, ticketId: t.id },
    })
    await prisma.$transaction(async (tx) => syncTicketToMaintenance(tx, t.id))
    const after = await prisma.maintenance.findUniqueOrThrow({ where: { id: m.id } })
    check("티켓 IN_PROGRESS → 유지보수 '처리중'", after.statusId === mWork.id, String(after.statusId))
  }

  console.log('\n■ 프로젝트 — build_statuses.ticket_status')
  {
    const p = await prisma.project.create({
      data: { projectCode: `${TAG}_P1`, projectName: `[${TAG}] 프로젝트`, hospitalCode: hospital.hospitalCode, orderNumber: 999901, buildStatusId: buildHold.id },
    })
    const tid = await prisma.$transaction(async (tx) =>
      createTicketForProject(tx, {
        id: p.id, projectCode: p.projectCode, projectName: p.projectName, hospitalCode: p.hospitalCode,
        buildStatusLabel: buildHold.label, buildStatusId: buildHold.id,
        assigneeUserIds: [], endDateExpected: null, remark: null, createdAt: p.createdAt,
      }, null, 'domain')
    )
    const t = await ticketOf(tid)
    check('보류 BuildStatus → PENDING (컬럼 매핑)', t.status === 'PENDING', t.status)

    await prisma.ticket.update({ where: { id: tid }, data: { status: 'CLOSED' } })
    await prisma.$transaction(async (tx) => syncTicketToProject(tx, tid))
    const after = await prisma.project.findUniqueOrThrow({ where: { id: p.id } })
    check('티켓 CLOSED → 구축완료 (역방향 컬럼 매핑)', after.buildStatusId === buildDone.id, String(after.buildStatusId))

    await prisma.ticket.update({ where: { id: tid }, data: { status: 'RESOLVED' } })
    await prisma.$transaction(async (tx) => syncTicketToProject(tx, tid))
    const after2 = await prisma.project.findUniqueOrThrow({ where: { id: p.id } })
    check('구축완료 + 티켓 RESOLVED → 구축완료 유지 (버킷 일치)', after2.buildStatusId === buildDone.id, String(after2.buildStatusId))
  }

  console.log('\n■ 설치계획 — 단일 상태 축 (결정②B)')
  {
    const ipAccept = await sc('INSTALL_PLAN_STATUS', '접수')
    const ipWritten = await sc('INSTALL_PLAN_STATUS', '작성완료')
    const ipDone = await sc('INSTALL_PLAN_STATUS', '회신완료')

    const mkIp = async (statusId: number, ownerIds: string[] = []) => {
      const ip = await prisma.installPlan.create({
        data: { statusId, note: TAG, assignees: ownerIds.length ? { create: ownerIds.map((userId) => ({ userId })) } : undefined },
        include: { status: true },
      })
      const tid = await prisma.$transaction(async (tx) =>
        createTicketForInstallPlan(tx, {
          id: ip.id, planCode: null, hospitalCode: null, hospitalName: `[${TAG}] 설치계획`,
          statusId: ip.statusId, statusName: ip.status?.name ?? null,
          assigneeUserIds: ownerIds, note: null, createdAt: ip.createdAt, replyDate: null,
        }, null, 'domain')
      )
      return { ip, tid }
    }

    {
      const { tid } = await mkIp(ipAccept.id)
      const t = await ticketOf(tid)
      check('접수 → OPEN', t.status === 'OPEN', t.status)
    }
    {
      const { tid } = await mkIp(ipAccept.id, [user.id])
      const t = await ticketOf(tid)
      check('접수 + owner → ASSIGNED (구 IN_PROGRESS 비일관 해소)', t.status === 'ASSIGNED', t.status)
    }
    {
      const { tid } = await mkIp(ipWritten.id)
      const t = await ticketOf(tid)
      check("작성완료 → PENDING + 사유 '외부 회신 대기'", t.status === 'PENDING' && t.pendingReasonId === rWait.id, `${t.status}/${t.pendingReasonId}`)
    }
    {
      const { ip, tid } = await mkIp(ipDone.id)
      const t = await ticketOf(tid)
      check('회신완료 → CLOSED', t.status === 'CLOSED', t.status)
      // 역방향: 재오픈 → 접수 버킷
      await prisma.ticket.update({ where: { id: tid }, data: { status: 'IN_PROGRESS' } })
      await prisma.$transaction(async (tx) => syncTicketToInstallPlan(tx, tid))
      const after = await prisma.installPlan.findUniqueOrThrow({ where: { id: ip.id } })
      check('역방향 IN_PROGRESS → 매핑 행 없음 → 상태 유지(no-op)', after.statusId === ipDone.id, String(after.statusId))
    }
    {
      const { ip, tid } = await mkIp(ipAccept.id)
      await prisma.ticket.update({ where: { id: tid }, data: { status: 'RESOLVED' } })
      await prisma.$transaction(async (tx) => syncTicketToInstallPlan(tx, tid))
      const after = await prisma.installPlan.findUniqueOrThrow({ where: { id: ip.id } })
      check("역방향 RESOLVED → '회신완료' + replyDate 기록", after.statusId === ipDone.id && !!after.replyDate, String(after.statusId))
    }
    {
      const { ip, tid } = await mkIp(ipWritten.id)
      await prisma.ticket.update({ where: { id: tid }, data: { status: 'PENDING', pendingReasonId: rEtc.id } })
      await prisma.$transaction(async (tx) => syncTicketToInstallPlan(tx, tid))
      const after = await prisma.installPlan.findUniqueOrThrow({ where: { id: ip.id } })
      check('역방향 작성완료 + PENDING 재조작 → 작성완료 유지 (keep-if-consistent)', after.statusId === ipWritten.id, String(after.statusId))
    }
  }

  console.log('\n■ 시드 대조 — 현행 하드코딩과 동일')
  {
    const rows = await prisma.statusCode.findMany({
      where: { category: { in: ['MAINTENANCE_STATUS', 'ETC_TASK_STATUS', 'SITE_VISIT', 'INSTALL_PLAN_STATUS'] }, name: { not: { startsWith: TAG } } },
      select: { category: true, name: true, ticketStatus: true, ticketPendingReasonId: true },
    })
    const expect: Record<string, string> = {
      'MAINTENANCE_STATUS/접수': 'OPEN', 'MAINTENANCE_STATUS/처리중': 'IN_PROGRESS', 'MAINTENANCE_STATUS/보류': 'PENDING', 'MAINTENANCE_STATUS/완료': 'CLOSED',
      'ETC_TASK_STATUS/접수': 'OPEN', 'ETC_TASK_STATUS/처리중': 'IN_PROGRESS', 'ETC_TASK_STATUS/보류': 'PENDING', 'ETC_TASK_STATUS/완료': 'CLOSED',
      'SITE_VISIT/접수': 'OPEN', 'SITE_VISIT/답사예정': 'IN_PROGRESS', 'SITE_VISIT/작성완료': 'PENDING', 'SITE_VISIT/보류': 'PENDING', 'SITE_VISIT/회신완료': 'CLOSED',
      'INSTALL_PLAN_STATUS/접수': 'OPEN', 'INSTALL_PLAN_STATUS/작성완료': 'PENDING', 'INSTALL_PLAN_STATUS/회신완료': 'CLOSED', 'INSTALL_PLAN_STATUS/보류': 'PENDING',
    }
    let ok = true
    for (const [key, want] of Object.entries(expect)) {
      const [category, name] = key.split('/')
      const row = rows.find((r) => r.category === category && r.name === name)
      if (!row || row.ticketStatus !== want) { ok = false; console.log(`    불일치: ${key} → ${row?.ticketStatus ?? '(없음)'} (기대 ${want})`) }
    }
    check('워크플로 상태코드 17행 매핑 = 하드코딩 이관값', ok)
    check("작성완료 사유 = 외부 회신 대기", rows.find((r) => r.category === 'SITE_VISIT' && r.name === '작성완료')?.ticketPendingReasonId === rWait.id)
    const builds = await prisma.buildStatus.findMany({ select: { label: true, ticketStatus: true } })
    check('build_statuses 전 행 매핑 보유', builds.every((b) => !!b.ticketStatus), JSON.stringify(builds))
  }

  await cleanup()
  const remain = await prisma.ticket.count({ where: { title: { contains: `[${TAG}]` } } })
  check('\n테스트 데이터 정리 (잔여 0)', remain === 0, String(remain))

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
  if (fail > 0) process.exit(1)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
