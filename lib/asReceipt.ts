/**
 * AS업무(AS접수) 도메인 헬퍼 — projects/as_work_design.md
 * 코드 발번(AS-YYYYMM-NNNN — SOR/VOC 발번 패턴) + 수정 권한 판정 + 종결 판정.
 * 기기현황 이벤트 연동은 API 라우트가 lib/deviceRegistry 서비스 함수(ref 'AS')로 직접 수행.
 */
import { Prisma, TicketStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type DbClient = Prisma.TransactionClient | typeof prisma

/** KST 기준 YYYYMM */
function ymKst(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 7).replace('-', '')
}

/** AS접수 — AS-YYYYMM-NNNN (동시 생성 UNIQUE 충돌 P2002는 호출부에서 재시도) */
export async function nextAsCode(client: DbClient = prisma): Promise<string> {
  const prefix = `AS-${ymKst()}-`
  const last = await client.asReceipt.findFirst({
    where: { asCode: { startsWith: prefix } },
    orderBy: { asCode: 'desc' },
    select: { asCode: true },
  })
  const seq = last ? parseInt(last.asCode.slice(prefix.length), 10) + 1 : 1
  return `${prefix}${String(seq).padStart(4, '0')}`
}

/** 현재 상태가 종결 버킷(완료·취소 — RESOLVED/CLOSED 매핑)인지 — 수정 잠금 판정 */
export function isTerminalAsStatus(ticketStatus: TicketStatus | null | undefined): boolean {
  return ticketStatus === 'RESOLVED' || ticketStatus === 'CLOSED'
}

/** 수정·삭제 권한: ADMIN 이상 항상 / USER는 본인 등록 + 종결(완료·취소) 전 / VIEWER 불가 (SOR canEdit 패턴 — §13-1 등록자 기준) */
export function canEditAsReceipt(
  user: { userId: string; role: string },
  receipt: { createdById: string | null; status: { ticketStatus: TicketStatus | null } | null }
): boolean {
  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') return true
  if (user.role === 'VIEWER') return false
  if (receipt.createdById !== user.userId) return false
  return !isTerminalAsStatus(receipt.status?.ticketStatus)
}
