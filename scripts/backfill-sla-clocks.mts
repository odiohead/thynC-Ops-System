/**
 * SLA 시계 백필 (1.1 P1 — projects/notification_v1.1_design.md §5.2 "quiet backfill")
 *
 * 기존 티켓 전량에 시계를 생성한다. **이미 기한이 지난 시계는 알림 없이 BREACHED로 마킹**해
 * P4에서 즉시 알림을 켜는 순간 과거분 수백 건이 쏟아지는 사고를 막는다(notified_breach_at 선점).
 *
 * 사용법:
 *   npx tsx scripts/backfill-sla-clocks.mts               # 열린 티켓만 (권장·기본)
 *   npx tsx scripts/backfill-sla-clocks.mts --all         # 종결 티켓까지 (지표용 과거 데이터 생성)
 *   npx tsx scripts/backfill-sla-clocks.mts --dry         # 계산만, 쓰지 않음
 *   npx tsx scripts/backfill-sla-clocks.mts --loud        # quiet 마킹 없이 (테스트 전용 — 운영 금지)
 *
 * 재실행 안전: 시계는 (ticket, metric, status_scope) UNIQUE라 기존 행은 갱신된다.
 */

import { PrismaClient } from '@prisma/client'
import { syncTicketClocks } from '../lib/sla'

const prisma = new PrismaClient()

const args = process.argv.slice(2)
const includeClosed = args.includes('--all')
const dryRun = args.includes('--dry')
const loud = args.includes('--loud')

async function main() {
  const where = includeClosed ? {} : { status: { notIn: ['RESOLVED', 'CLOSED'] as const } }
  const tickets = await prisma.ticket.findMany({
    where,
    select: { id: true, ticketCode: true },
    orderBy: { id: 'asc' },
  })

  console.log(`[backfill-sla] 대상 티켓 ${tickets.length}건 (${includeClosed ? '전체' : '열린 티켓만'})`)
  console.log(`[backfill-sla] 모드: ${dryRun ? 'DRY RUN(쓰기 없음)' : loud ? 'LOUD(quiet 마킹 없음 — 테스트 전용)' : 'QUIET(과거 초과분 알림 억제)'}`)

  if (dryRun) {
    const policies = await prisma.slaPolicy.findMany({
      where: { isActive: true },
      select: { id: true, name: true, priority: true, targets: { where: { isActive: true }, select: { metric: true } } },
      orderBy: { priority: 'asc' },
    })
    console.log('[backfill-sla] 활성 정책:')
    for (const p of policies) {
      console.log(`  - (${p.priority}) ${p.name} — 타깃 ${p.targets.length}종: ${p.targets.map((t) => t.metric).join(', ')}`)
    }
    console.log('[backfill-sla] DRY RUN 종료 — 실제 생성은 옵션 없이 재실행')
    return
  }

  const total = { created: 0, updated: 0, breached: 0, met: 0, canceled: 0, failed: 0 }
  let done = 0

  for (const t of tickets) {
    try {
      const r = await syncTicketClocks(t.id, { quiet: !loud })
      total.created += r.created
      total.updated += r.updated
      total.breached += r.breached
      total.met += r.met
      total.canceled += r.canceled
    } catch (err) {
      total.failed++
      console.error(`  ✗ ${t.ticketCode}: ${err instanceof Error ? err.message : String(err)}`)
    }
    done++
    if (done % 100 === 0) console.log(`  … ${done}/${tickets.length}`)
  }

  console.log('\n[backfill-sla] 완료')
  console.log(`  시계 생성 ${total.created} · 갱신 ${total.updated}`)
  console.log(`  상태 분포 — 초과(BREACHED) ${total.breached} · 달성(MET) ${total.met} · 취소 ${total.canceled}`)
  if (total.failed > 0) console.log(`  실패 ${total.failed}건 (위 로그 확인)`)

  // 검증: quiet 모드에서 "알림 미발송 상태로 남은 초과 시계"가 0이어야 한다
  const pending = await prisma.ticketSlaClock.count({
    where: { state: 'BREACHED', notifiedBreachAt: null },
  })
  const byMetric = await prisma.ticketSlaClock.groupBy({
    by: ['metric', 'state'],
    _count: { _all: true },
    orderBy: { metric: 'asc' },
  })
  console.log('\n  metric × state:')
  for (const g of byMetric) console.log(`    ${g.metric.padEnd(14)} ${g.state.padEnd(10)} ${g._count._all}`)
  console.log(`\n  알림 대기(초과·미발송) 시계: ${pending}건 ${loud ? '' : pending === 0 ? '✓ quiet 백필 정상' : '⚠ quiet 백필인데 0이 아님 — 확인 필요'}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
