/**
 * P8 백필: 기존 설치계획 → 티켓 생성 (ticketId 없는 건만, 단일 트랜잭션)
 * 실행: npx tsx scripts/backfill-install-plan-tickets.mts
 */
import { PrismaClient } from '@prisma/client'
import { createTicketForInstallPlan } from '../lib/ticketDomain'

const prisma = new PrismaClient()

async function main() {
  const targets = await prisma.installPlan.findMany({
    where: { ticketId: null },
    select: {
      id: true, planCode: true, hospitalCode: true, writeStatus: true, replyStatus: true, replyDate: true, createdAt: true,
      hospital: { select: { hospitalName: true, hiraHospitalName: true } },
      assignees: { select: { userId: true }, orderBy: { id: 'asc' } },
    },
    orderBy: { id: 'asc' },
  })
  console.log(`대상 설치계획: ${targets.length}건`)
  if (targets.length === 0) return

  await prisma.$transaction(async (tx) => {
    for (const ip of targets) {
      await createTicketForInstallPlan(tx, {
        id: ip.id,
        planCode: ip.planCode,
        hospitalCode: ip.hospitalCode,
        hospitalName: ip.hospital?.hospitalName ?? ip.hospital?.hiraHospitalName ?? null,
        writeStatus: ip.writeStatus,
        replyStatus: ip.replyStatus,
        assigneeUserIds: ip.assignees.map((a) => a.userId),
        createdAt: ip.createdAt,
        replyDate: ip.replyDate,
      }, null, 'backfill')
    }
  }, { timeout: 120_000 })

  const linked = await prisma.installPlan.count({ where: { ticketId: { not: null } } })
  const total = await prisma.installPlan.count()
  const tickets = await prisma.ticket.count({ where: { refType: 'INSTALL_PLAN' } })
  console.log(`완료: 설치계획 ${linked}/${total} 연결, INSTALL_PLAN 티켓 ${tickets}건`)
  if (linked !== total || tickets !== linked) throw new Error('정합성 불일치 — 확인 필요')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
