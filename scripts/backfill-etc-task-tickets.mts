/**
 * P6 백필: 기존 기타업무 → 티켓 생성 (ticketId 없는 건만, 단일 트랜잭션)
 * 실행: npx tsx scripts/backfill-etc-task-tickets.mts
 */
import { PrismaClient } from '@prisma/client'
import { createTicketForEtcTask } from '../lib/ticketDomain'

const prisma = new PrismaClient()

async function main() {
  const targets = await prisma.etcTask.findMany({
    where: { ticketId: null },
    select: {
      id: true, etcTaskCode: true, title: true, priority: true, resolvedAt: true, createdAt: true,
      status: { select: { name: true } },
      hospitals: { select: { hospitalCode: true }, orderBy: { id: 'asc' } },
      assignees: { select: { userId: true }, orderBy: { id: 'asc' } },
    },
    orderBy: { id: 'asc' },
  })
  console.log(`대상 기타업무: ${targets.length}건`)
  if (targets.length === 0) return

  await prisma.$transaction(async (tx) => {
    for (const e of targets) {
      await createTicketForEtcTask(tx, {
        id: e.id,
        etcTaskCode: e.etcTaskCode,
        title: e.title,
        priority: e.priority,
        statusName: e.status?.name ?? null,
        hospitalCodes: e.hospitals.map((h) => h.hospitalCode),
        assigneeUserIds: e.assignees.map((a) => a.userId),
        resolvedAt: e.resolvedAt,
        createdAt: e.createdAt,
      }, null, 'backfill')
    }
  }, { timeout: 60_000 })

  const linked = await prisma.etcTask.count({ where: { ticketId: { not: null } } })
  const total = await prisma.etcTask.count()
  const tickets = await prisma.ticket.count({ where: { refType: 'ETC' } })
  console.log(`완료: 기타업무 ${linked}/${total} 연결, ETC 티켓 ${tickets}건`)
  if (linked !== total || tickets !== linked) throw new Error('정합성 불일치 — 확인 필요')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
