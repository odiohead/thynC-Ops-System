/**
 * SLA 시계 엔진 스모크 (1.1 P1 게이트 — projects/notification_v1.1_design.md §9)
 *
 * 실데이터를 건드리지 않기 위해 **전용 큐 + 전용 정책 + 임시 티켓**을 만들어 검증하고 전부 삭제한다.
 * 시간 경과는 sleep이 아니라 시계 타임스탬프를 과거로 조작해 시뮬레이션한다.
 *
 *   npx tsx scripts/sla-smoke.mts
 */

import { PrismaClient } from '@prisma/client'
import { syncTicketClocks } from '../lib/sla'

const prisma = new PrismaClient()
const TAG = '___sla_smoke'
const MIN = 60_000

let pass = 0
let fail = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

async function clocksOf(ticketId: number) {
  const rows = await prisma.ticketSlaClock.findMany({ where: { ticketId } })
  return new Map(rows.map((c) => [`${c.metric}|${c.statusScope ?? ''}`, c]))
}

async function main() {
  // ── 준비: 전용 큐·정책·티켓 ─────────────────────────────────
  // 시드된 폴백 정책 — 전용 정책을 끄면 이 정책이 인수한다(7번 검증)
  const fallback = await prisma.slaPolicy.findFirst({ where: { name: '기본(전체)' }, select: { id: true } })
  const policyFallbackId = fallback?.id ?? null

  const queue = await prisma.ticketQueue.create({ data: { name: TAG, description: 'SLA 스모크 전용(자동 삭제)', isActive: false } })
  const cti = await prisma.ticketCti.findFirst({ where: { level: 3 }, select: { id: true } })

  const policy = await prisma.slaPolicy.create({
    data: {
      name: TAG, description: 'SLA 스모크 전용(자동 삭제)', priority: 1,
      queueIds: [queue.id], isActive: true,
      targets: {
        create: [
          { metric: 'ASSIGN', thresholdMin: 60, warnRatio: 50 },
          { metric: 'RESOLVE', thresholdMin: 180, warnRatio: 80 },
          { metric: 'UPDATE_STALE', thresholdMin: 60, warnRatio: 0 },
          { metric: 'DWELL', statusScope: 'OPEN', thresholdMin: 30, warnRatio: 0 },
        ],
      },
    },
    include: { targets: true },
  })

  const created = new Date(Date.now() - 10 * MIN) // 10분 전 생성
  const ticket = await prisma.ticket.create({
    data: {
      ticketCode: `TK-SLASMOKE-${Date.now()}`, title: `${TAG} 임시 티켓`,
      queueId: queue.id, ctiId: cti?.id ?? null, severity: 'SEV3', status: 'OPEN',
      createdAt: created, statusChangedAt: created,
    },
  })
  console.log(`[sla-smoke] 준비 완료 — queue #${queue.id}, policy #${policy.id}, ticket ${ticket.ticketCode}\n`)

  try {
    // ── 1. 시계 생성 ────────────────────────────────────────
    console.log('1. 시계 생성 (정책 매칭)')
    let r = await syncTicketClocks(ticket.id)
    let c = await clocksOf(ticket.id)
    check('타깃 4종 → 시계 4개 생성', r.created === 4, `created=${r.created}`)
    check('ASSIGN 기한 = 생성 + 60분', Math.abs((c.get('ASSIGN|')!.dueAt.getTime() - created.getTime()) - 60 * MIN) < 1000)
    check('DWELL(OPEN) 앵커 = 상태 진입 시각', Math.abs(c.get('DWELL|OPEN')!.startedAt.getTime() - created.getTime()) < 1000)
    check('전부 RUNNING', Array.from(c.values()).every((x) => x.state === 'RUNNING'))
    check('중복 실행해도 시계가 늘지 않음', (await syncTicketClocks(ticket.id)).created === 0)

    // ── 2. 달성 (ASSIGN) ───────────────────────────────────
    console.log('\n2. 담당자 배정 → ASSIGN 달성')
    await prisma.ticket.update({ where: { id: ticket.id }, data: { ownerId: (await prisma.user.findFirst({ select: { id: true } }))!.id, status: 'ASSIGNED', statusChangedAt: new Date() } })
    await syncTicketClocks(ticket.id)
    c = await clocksOf(ticket.id)
    check('ASSIGN → MET', c.get('ASSIGN|')!.state === 'MET', c.get('ASSIGN|')!.state)
    check('ASSIGN satisfiedAt 기록', !!c.get('ASSIGN|')!.satisfiedAt)
    check('DWELL(OPEN) → 상태 이탈로 종료', ['MET', 'BREACHED'].includes(c.get('DWELL|OPEN')!.state), c.get('DWELL|OPEN')!.state)

    // ── 3. 정지·재개 (PENDING) ─────────────────────────────
    // 앵커가 고정된 RESOLVE로 검증한다. UPDATE_STALE은 상태 변경 자체가 "활동"이라
    // 재개가 아니라 리셋 경로를 타는 것이 정상(§4.2) — 5번에서 별도 검증.
    console.log('\n3. PENDING 진입 → 시계 정지, 이탈 → 정지시간 보상 (RESOLVE 기준)')
    await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'PENDING', statusChangedAt: new Date() } })
    await syncTicketClocks(ticket.id)
    c = await clocksOf(ticket.id)
    const paused = c.get('RESOLVE|')!
    check('RESOLVE → PAUSED', paused.state === 'PAUSED', paused.state)
    check('pausedAt 기록', !!paused.pausedAt)
    check('UPDATE_STALE도 PAUSED', c.get('UPDATE_STALE|')!.state === 'PAUSED', c.get('UPDATE_STALE|')!.state)

    const dueBefore = paused.dueAt.getTime()
    // 10분간 정지했던 것으로 조작
    await prisma.ticketSlaClock.update({ where: { id: paused.id }, data: { pausedAt: new Date(Date.now() - 10 * MIN) } })
    await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'IN_PROGRESS', statusChangedAt: new Date() } })
    await syncTicketClocks(ticket.id)
    c = await clocksOf(ticket.id)
    const resumed = c.get('RESOLVE|')!
    check('재개 → RUNNING', resumed.state === 'RUNNING', resumed.state)
    check('정지시간 누적(pausedMs ≈ 10분)', Math.abs(Number(resumed.pausedMs) - 10 * MIN) < 5000, `${Number(resumed.pausedMs) / MIN}분`)
    check('기한이 정지시간만큼 밀림', Math.abs((resumed.dueAt.getTime() - dueBefore) - 10 * MIN) < 5000)
    check('상태 변경은 UPDATE_STALE에 활동으로 작동(리셋·정지 누적 0)', Number(c.get('UPDATE_STALE|')!.pausedMs) === 0)

    // ── 4. 초과 감지 ───────────────────────────────────────
    console.log('\n4. 기한 경과 → 초과 감지 (알림 미발송 상태로 남아야 함)')
    await prisma.ticketSlaClock.update({
      where: { id: resumed.id },
      data: { dueAt: new Date(Date.now() - 5 * MIN) },
    })
    await syncTicketClocks(ticket.id)
    c = await clocksOf(ticket.id)
    check('RESOLVE → BREACHED', c.get('RESOLVE|')!.state === 'BREACHED', c.get('RESOLVE|')!.state)
    check('breachedAt 기록', !!c.get('RESOLVE|')!.breachedAt)
    check('notifiedBreachAt NULL (P4 알림 대상으로 남음)', c.get('RESOLVE|')!.notifiedBreachAt === null)
    const quietTicket = await syncTicketClocks(ticket.id, { quiet: true })
    check('재실행해도 BREACHED 중복 카운트 없음', quietTicket.breached === 0, `breached=${quietTicket.breached}`)

    // ── 5. UPDATE_STALE 리셋 ───────────────────────────────
    console.log('\n5. 코멘트 작성 → UPDATE_STALE 리셋 (달성이 아니라 재시작)')
    const staleBefore = c.get('UPDATE_STALE|')!
    await prisma.ticketSlaClock.update({
      where: { id: staleBefore.id },
      data: { dueAt: new Date(Date.now() - 1 * MIN), state: 'BREACHED', breachedAt: new Date(), notifiedBreachAt: new Date() },
    })
    await prisma.ticketLog.create({ data: { ticketId: ticket.id, logType: 'comment', contentHtml: '<p>스모크</p>' } })
    await syncTicketClocks(ticket.id)
    c = await clocksOf(ticket.id)
    const reset = c.get('UPDATE_STALE|')!
    check('초과 상태에서 활동 발생 → RUNNING 복귀', reset.state === 'RUNNING', reset.state)
    check('앵커가 최근 활동으로 이동', reset.startedAt.getTime() > staleBefore.startedAt.getTime())
    check('초과 마킹 초기화(재초과 시 다시 알림)', reset.breachedAt === null && reset.notifiedBreachAt === null)
    check('정지 누적 초기화', Number(reset.pausedMs) === 0)

    // ── 6. 종결 ────────────────────────────────────────────
    console.log('\n6. RESOLVED 진입 → 진행 중 시계 확정')
    await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'RESOLVED', resolvedAt: new Date(), statusChangedAt: new Date() } })
    await syncTicketClocks(ticket.id)
    c = await clocksOf(ticket.id)
    check('RESOLVE 시계 확정(MET/BREACHED)', ['MET', 'BREACHED'].includes(c.get('RESOLVE|')!.state), c.get('RESOLVE|')!.state)
    check('진행 중(RUNNING) 시계 없음', Array.from(c.values()).every((x) => x.state !== 'RUNNING'), Array.from(c.values()).map((x) => `${x.metric}:${x.state}`).join(','))

    // ── 7. 정책 비활성 → 폴백 정책 인수 / 없는 타깃은 취소 ──
    // 시드된 '기본(전체)' 폴백 정책이 모든 티켓에 매칭되므로, 전용 정책을 끄면
    // ① 폴백에도 있는 타깃(RESOLVE)은 폴백 기준으로 **재적용**되고
    // ② 폴백에 없는 타깃(ASSIGN·UPDATE_STALE·DWELL)은 **취소**된다.
    console.log('\n7. 정책 비활성화 → 폴백 정책 인수 / 없는 타깃 취소')
    await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'IN_PROGRESS', resolvedAt: null, statusChangedAt: new Date() } })
    await syncTicketClocks(ticket.id)
    await prisma.slaPolicy.update({ where: { id: policy.id }, data: { isActive: false } })
    const r7 = await syncTicketClocks(ticket.id)
    c = await clocksOf(ticket.id)
    check('폴백에 없는 타깃 → CANCELED', r7.canceled > 0, `canceled=${r7.canceled}`)
    check('ASSIGN·UPDATE_STALE·DWELL 전부 정리', ['ASSIGN|', 'UPDATE_STALE|', 'DWELL|OPEN'].every((k) => {
      const x = c.get(k)
      return !x || x.state === 'CANCELED' || x.state === 'MET'
    }), Array.from(c.values()).map((x) => `${x.metric}:${x.state}`).join(','))
    // 폴백 기준(1440~10080분)은 이 티켓의 경과보다 길므로 초과가 해소되어야 한다.
    // 기준이 바뀌었는데 초과를 남겨두면 위험 목록에 유령 항목이 된다.
    const resolve7 = c.get('RESOLVE|')!
    check('RESOLVE는 폴백 정책으로 재적용', resolve7.policyId === policyFallbackId, `policyId=${resolve7.policyId}`)
    check('목표가 늘어나 기한이 미래 → 초과 해소', resolve7.state !== 'BREACHED' && resolve7.breachedAt === null, resolve7.state)
    check('취소된 시계도 이력(초과·달성 시각) 보존',
      Array.from(c.values()).filter((x) => x.state === 'CANCELED')
        .every((x) => x.metric === 'UPDATE_STALE' || x.breachedAt !== null || x.satisfiedAt !== null))
  } finally {
    // ── 정리 ───────────────────────────────────────────────
    console.log('\n[sla-smoke] 정리')
    await prisma.ticket.delete({ where: { id: ticket.id } }) // 시계·로그 cascade
    await prisma.slaPolicy.delete({ where: { id: policy.id } }) // 타깃 cascade
    await prisma.ticketQueue.delete({ where: { id: queue.id } })
    const residueClock = await prisma.ticketSlaClock.count({ where: { ticketId: ticket.id } })
    const residuePolicy = await prisma.slaPolicy.count({ where: { name: TAG } })
    const residueQueue = await prisma.ticketQueue.count({ where: { name: TAG } })
    check('테스트 데이터 잔여 0', residueClock === 0 && residuePolicy === 0 && residueQueue === 0,
      `clock=${residueClock} policy=${residuePolicy} queue=${residueQueue}`)
  }

  console.log(`\n[sla-smoke] 결과: ${pass} 통과 / ${fail} 실패`)
  if (fail > 0) process.exitCode = 1
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
