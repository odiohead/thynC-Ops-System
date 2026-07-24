/**
 * P7 백필: 기존 답사 → 티켓 생성 (ticketId 없는 건만, 단일 트랜잭션)
 * 실행: npx tsx scripts/backfill-site-visit-tickets.mts
 */
import { PrismaClient } from '@prisma/client'
import { createTicketForSiteVisit } from '../lib/ticketDomain'

const prisma = new PrismaClient()

async function main() {
  const targets = await prisma.siteVisit.findMany({
    where: { ticketId: null },
    select: {
      id: true, siteVisitCode: true, hospitalCode: true, replyDate: true, createdAt: true,
      hospital: { select: { hospitalName: true, hiraHospitalName: true } },
      status: { select: { name: true } },
      assignees: { select: { userId: true }, orderBy: { id: 'asc' } },
    },
    orderBy: { id: 'asc' },
  })
  console.log(`대상 답사: ${targets.length}건`)
  if (targets.length === 0) return

  await prisma.$transaction(async (tx) => {
    for (const s of targets) {
      await createTicketForSiteVisit(tx, {
        id: s.id,
        siteVisitCode: s.siteVisitCode,
        hospitalCode: s.hospitalCode,
        hospitalName: s.hospital?.hospitalName ?? s.hospital?.hiraHospitalName ?? null,
        statusName: s.status?.name ?? null,
        assigneeUserIds: s.assignees.map((a) => a.userId),
        createdAt: s.createdAt,
        replyDate: s.replyDate,
      }, null, 'backfill')
    }
  }, { timeout: 120_000 })

  const linked = await prisma.siteVisit.count({ where: { ticketId: { not: null } } })
  const total = await prisma.siteVisit.count()
  const tickets = await prisma.ticket.count({ where: { refType: 'SITE_VISIT' } })
  console.log(`완료: 답사 ${linked}/${total} 연결, SITE_VISIT 티켓 ${tickets}건`)
  if (linked !== total || tickets !== linked) throw new Error('정합성 불일치 — 확인 필요')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
