/**
 * P5 백필: 기존 유지보수 → 티켓 생성 + maintenance_logs → ticket_logs 이관 (원본 보존)
 * 실행: npx tsx scripts/backfill-maintenance-tickets.mts
 * 재실행 안전: ticketId가 이미 있는 유지보수는 건너뜀. 전체 단일 트랜잭션(실패 시 롤백).
 * 사전 조건: seed-ticket-masters.sql 적용(유지보수 큐·장애 CTI), DB 백업 권장.
 */
import { PrismaClient } from '@prisma/client'
import { createTicketForMaintenance } from '../lib/ticketDomain'

const prisma = new PrismaClient()

async function main() {
  const targets = await prisma.maintenance.findMany({
    where: { ticketId: null },
    select: {
      id: true, maintenanceCode: true, title: true, hospitalCode: true, priority: true,
      reportedAt: true, resolvedAt: true, createdAt: true,
      status: { select: { name: true } },
      type: { select: { name: true } },
      assignees: { select: { userId: true }, orderBy: { id: 'asc' } },
      logs: { select: { id: true, authorId: true, content: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: 'asc' } },
    },
    orderBy: { id: 'asc' },
  })
  console.log(`대상 유지보수: ${targets.length}건`)
  if (targets.length === 0) return

  let logMoved = 0
  await prisma.$transaction(async (tx) => {
    for (const m of targets) {
      const ticketId = await createTicketForMaintenance(tx, {
        id: m.id,
        maintenanceCode: m.maintenanceCode,
        title: m.title,
        hospitalCode: m.hospitalCode,
        priority: m.priority,
        statusName: m.status?.name ?? null,
        typeName: m.type?.name ?? null,
        assigneeUserIds: m.assignees.map((a) => a.userId),
        reportedAt: m.reportedAt,
        resolvedAt: m.resolvedAt,
        createdAt: m.createdAt,
      }, null, 'backfill')

      // 처리 기록 이관 (원본 maintenance_logs 보존 — 읽기만 중단 예정)
      for (const log of m.logs) {
        await tx.ticketLog.create({
          data: {
            ticketId,
            logType: 'comment',
            authorId: log.authorId,
            contentHtml: log.content,
            payload: { migratedFrom: 'maintenance_logs', originId: log.id },
            createdAt: log.createdAt,
            updatedAt: log.updatedAt,
          },
        })
        logMoved++
      }
    }
  }, { timeout: 120_000 })

  // 검증
  const linked = await prisma.maintenance.count({ where: { ticketId: { not: null } } })
  const total = await prisma.maintenance.count()
  const tickets = await prisma.ticket.count({ where: { refType: 'MAINTENANCE' } })
  console.log(`완료: 유지보수 ${linked}/${total} 연결, MAINTENANCE 티켓 ${tickets}건, 로그 이관 ${logMoved}건`)
  if (linked !== total || tickets !== linked) throw new Error('정합성 불일치 — 확인 필요')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
