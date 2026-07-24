/**
 * P9 백필: 기존 프로젝트 → 티켓 생성 (ticketId 없는 건만, 단일 트랜잭션)
 * 실행: npx tsx scripts/backfill-project-tickets.mts
 */
import { PrismaClient } from '@prisma/client'
import { createTicketForProject } from '../lib/ticketDomain'

const prisma = new PrismaClient()

async function main() {
  const targets = await prisma.project.findMany({
    where: { ticketId: null },
    select: {
      id: true, projectCode: true, projectName: true, hospitalCode: true, endDateExpected: true, createdAt: true,
      buildStatus: { select: { label: true } },
      assignees: { select: { userId: true }, orderBy: { id: 'asc' } },
    },
    orderBy: { id: 'asc' },
  })
  console.log(`대상 프로젝트: ${targets.length}건`)
  if (targets.length === 0) return

  await prisma.$transaction(async (tx) => {
    for (const p of targets) {
      await createTicketForProject(tx, {
        id: p.id,
        projectCode: p.projectCode,
        projectName: p.projectName,
        hospitalCode: p.hospitalCode,
        buildStatusLabel: p.buildStatus?.label ?? null,
        assigneeUserIds: p.assignees.map((a) => a.userId),
        endDateExpected: p.endDateExpected,
        createdAt: p.createdAt,
      }, null, 'backfill')
    }
  }, { timeout: 180_000 })

  const linked = await prisma.project.count({ where: { ticketId: { not: null } } })
  const total = await prisma.project.count()
  const tickets = await prisma.ticket.count({ where: { refType: 'PROJECT' } })
  console.log(`완료: 프로젝트 ${linked}/${total} 연결, PROJECT 티켓 ${tickets}건`)
  if (linked !== total || tickets !== linked) throw new Error('정합성 불일치 — 확인 필요')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
