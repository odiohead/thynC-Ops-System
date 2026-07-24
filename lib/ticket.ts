// 서버 전용 헬퍼 (prisma 의존). 전이표·라벨 등 공용 상수는 lib/ticket-shared.ts
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { TicketLogType } from '@/lib/ticket-shared'

export {
  TICKET_TRANSITIONS,
  canTransition,
  TICKET_STATUS_LABELS,
  TICKET_SEVERITY_LABELS,
} from '@/lib/ticket-shared'
export type { TicketLogType } from '@/lib/ticket-shared'

type DbClient = Prisma.TransactionClient | typeof prisma

// 채번: TK-YYYYMM-NNNNN (월별 시퀀스). UNIQUE 충돌 시 호출부에서 재시도.
export async function generateTicketCode(client: DbClient = prisma): Promise<string> {
  const now = new Date()
  const prefix = `TK-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`
  const last = await client.ticket.findFirst({
    where: { ticketCode: { startsWith: prefix } },
    orderBy: { ticketCode: 'desc' },
    select: { ticketCode: true },
  })
  const seq = last ? parseInt(last.ticketCode.slice(prefix.length), 10) + 1 : 1
  return `${prefix}${String(seq).padStart(5, '0')}`
}

// 시스템 이벤트 기록 — 모든 mutation은 이 함수로 타임라인에 남긴다 (프로세스 지표 원천)
export async function addTicketEvent(
  client: DbClient,
  ticketId: number,
  logType: Exclude<TicketLogType, 'comment'>,
  authorId: string | null,
  payload: Prisma.InputJsonValue
) {
  await client.ticketLog.create({
    data: { ticketId, logType, authorId, payload },
  })
}
