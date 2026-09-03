/**
 * 출고요청(출고업무) 도메인 헬퍼 — projects/stock_out_request_design.md
 * 코드 발번(SOR-YYYYMM-NNNN, KST 월별 시퀀스 — VOC/MNT/IP 발번 패턴) + 품목 요약 + 수정 권한 판정.
 */
import { Prisma, TicketStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type DbClient = Prisma.TransactionClient | typeof prisma

/** KST 기준 YYYYMM */
function ymKst(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 7).replace('-', '')
}

/** 출고요청 — SOR-YYYYMM-NNNN (동시 생성 UNIQUE 충돌 P2002는 호출부에서 재시도) */
export async function nextSorCode(client: DbClient = prisma): Promise<string> {
  const prefix = `SOR-${ymKst()}-`
  const last = await client.stockOutRequest.findFirst({
    where: { sorCode: { startsWith: prefix } },
    orderBy: { sorCode: 'desc' },
    select: { sorCode: true },
  })
  const seq = last ? parseInt(last.sorCode.slice(prefix.length), 10) + 1 : 1
  return `${prefix}${String(seq).padStart(4, '0')}`
}

/** 품목 라인 요약 한 줄 — 'thynC 시스템 30 1 외 2종 · 총 8개' (배너·알림·목록 공용) */
export function summarizeStockOutItems(lines: { quantity: number; item: { name: string } }[]): string {
  if (!lines.length) return '품목 없음'
  const total = lines.reduce((s, l) => s + l.quantity, 0)
  const first = `${lines[0].item.name} ${lines[0].quantity}`
  const rest = lines.length > 1 ? ` 외 ${lines.length - 1}종` : ''
  return `${first}${rest} · 총 ${total}개`
}

/** 현재 상태가 종결 버킷(완료·취소 — RESOLVED/CLOSED 매핑)인지 — 수정 잠금 판정 (설계 §2-6) */
export function isTerminalStockOutStatus(ticketStatus: TicketStatus | null | undefined): boolean {
  return ticketStatus === 'RESOLVED' || ticketStatus === 'CLOSED'
}

/** 수정·삭제 권한: ADMIN 이상 항상 / USER는 본인 요청 + 종결(완료·취소) 전 / VIEWER 불가 */
export function canEditStockOutRequest(
  user: { userId: string; role: string },
  req: { createdById: string | null; status: { ticketStatus: TicketStatus | null } | null }
): boolean {
  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') return true
  if (user.role === 'VIEWER') return false
  if (req.createdById !== user.userId) return false
  return !isTerminalStockOutStatus(req.status?.ticketStatus)
}
