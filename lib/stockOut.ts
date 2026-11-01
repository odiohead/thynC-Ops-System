/**
 * 출고요청(출고업무) 도메인 헬퍼 — projects/stock_out_request_design.md
 * 코드 발번(SOR-YYYYMM-NNNN, KST 월별 시퀀스 — VOC/MNT/IP 발번 패턴) + 품목 요약 + 수정 권한 판정.
 */
import { Prisma, TicketStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { STOCK_OUT_PURPOSE_LABELS, type StockOutPurpose } from '@/lib/stockOutShared'

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
  req: { createdById: string | null; status: { ticketStatus: TicketStatus | null } | null },
  adminPerm?: boolean // stock_out.admin 권한 — RBAC v1.5 가산, ADMIN 동일 취급 (VIEWER 선차단 유지)
): boolean {
  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') return true
  if (user.role === 'VIEWER') return false
  if (adminPerm) return true
  if (req.createdById !== user.userId) return false
  return !isTerminalStockOutStatus(req.status?.ticketStatus)
}

/** items 입력 검증 — [{inventoryItemId, quantity}] 최소 1행·해당 업무에 노출된 활성 자재관리 품목·정수 qty>0·중복 금지 (v2 §6) */
export async function validateStockOutLines(raw: unknown, purpose: StockOutPurpose, keepIds: number[] = []): Promise<{ inventoryItemId: number; quantity: number }[]> {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('출고 품목을 1개 이상 입력하세요.')
  const lines: { inventoryItemId: number; quantity: number }[] = []
  const seen = new Set<number>()
  for (const row of raw) {
    const r = row as { inventoryItemId?: unknown; itemId?: unknown; quantity?: unknown }
    const inventoryItemId = Number(r?.inventoryItemId ?? r?.itemId)
    const quantity = Number(r?.quantity)
    if (!Number.isInteger(inventoryItemId)) throw new Error('품목이 올바르지 않습니다.')
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('수량은 1 이상의 정수여야 합니다.')
    if (seen.has(inventoryItemId)) throw new Error('같은 품목이 중복 입력되었습니다.')
    seen.add(inventoryItemId)
    lines.push({ inventoryItemId, quantity })
  }
  // 이미 담긴 라인(keepIds)은 노출 해제돼도 유지 — 신규 라인만 업무 노출 체크 필수
  const keep = new Set(keepIds)
  const ids = lines.map((l) => l.inventoryItemId)
  const found = await prisma.inventoryItem.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true, stockOutPurposes: { where: { purpose }, select: { purpose: true } } },
  })
  const byId = new Map(found.map((f) => [f.id, f]))
  for (const id of ids) {
    const f = byId.get(id)
    if (!f) throw new Error('사용할 수 없는 품목이 포함되어 있습니다.')
    if (f.stockOutPurposes.length === 0 && !keep.has(id)) throw new Error(`'${STOCK_OUT_PURPOSE_LABELS[purpose]}' 출고에 노출되지 않은 품목이 포함되어 있습니다. 설정 > 출고 품목 관리를 확인하세요.`)
  }
  return lines
}
