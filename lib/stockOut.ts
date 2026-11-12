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

/** 출고요청 라인 */
export interface StockOutLine { inventoryItemId: number; quantity: number }

/** items 입력 검증 — [{inventoryItemId, quantity}] 최소 1행·해당 업무에 노출된 활성 자재관리 품목·정수 qty>0·중복 금지 (v2 §6) */
export async function validateStockOutLines(raw: unknown, purpose: StockOutPurpose, keepIds: number[] = []): Promise<StockOutLine[]> {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('출고 품목을 1개 이상 입력하세요.')
  const lines: StockOutLine[] = []
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
    select: { id: true, name: true, stockOutKind: { select: { itemId: true } }, stockOutPurposes: { where: { purpose }, select: { purpose: true } } },
  })
  const byId = new Map(found.map((f) => [f.id, f]))
  for (const id of ids) {
    const f = byId.get(id)
    if (!f) throw new Error('사용할 수 없는 품목이 포함되어 있습니다.')
    // 시스템 구성품 종류는 시스템 수량에서 자동 계산 — 직접 라인으로 받지 않는다 (출고 처리에서 같은 품목이 두 번 잡히는 것 방지)
    if (f.stockOutKind) throw new Error(`'${f.name}'은(는) 시스템 구성품이라 직접 요청할 수 없습니다. 시스템 수량에 따라 자동 계산됩니다.`)
    if (f.stockOutPurposes.length === 0 && !keep.has(id)) throw new Error(`'${STOCK_OUT_PURPOSE_LABELS[purpose]}' 출고에 노출되지 않은 품목이 포함되어 있습니다. 설정 > 출고 품목 관리를 확인하세요.`)
  }
  return lines
}

/**
 * 요청 단위 시스템 구성품 (2026-11-12) — 구성품 종류(`stock_out_component_kinds`)별 합계 = Σ(시스템 라인 수량 × 구성 수량).
 * 신청자가 적은 미출고 수량(`rawUnshipped: [{itemId, quantity}]`)을 검증해 함께 돌려준다 — 0 ≤ 미출고 ≤ 합계, 합계가 없는 종류에는 입력 불가.
 * `rawUnshipped`가 undefined면(미출고를 모르는 호출 — 모바일 등록·분실 AS 연동) `fallback`(기존 저장값)을 합계 한도로 잘라 이어받는다.
 */
export interface StockOutComponentRow { itemId: number; quantity: number; unshippedQuantity: number; sortOrder: number }
export async function resolveStockOutComponents(
  lines: StockOutLine[],
  rawUnshipped: unknown,
  fallback: { itemId: number; unshippedQuantity: number }[] = [],
  client: DbClient = prisma,
): Promise<StockOutComponentRow[]> {
  const kinds = await client.stockOutComponentKind.findMany({ select: { itemId: true, sortOrder: true, item: { select: { name: true } } }, orderBy: [{ sortOrder: 'asc' }, { itemId: 'asc' }] })
  const qtyByParent = new Map(lines.map((l) => [l.inventoryItemId, l.quantity]))
  const comps = kinds.length && lines.length
    ? await client.stockOutItemComponent.findMany({ where: { parentItemId: { in: lines.map((l) => l.inventoryItemId) }, childItemId: { in: kinds.map((k) => k.itemId) }, quantity: { gt: 0 } }, select: { parentItemId: true, childItemId: true, quantity: true } })
    : []
  const total = new Map<number, number>()
  for (const c of comps) total.set(c.childItemId, (total.get(c.childItemId) ?? 0) + (qtyByParent.get(c.parentItemId) ?? 0) * c.quantity)

  const want = new Map<number, number>()
  if (rawUnshipped === undefined || rawUnshipped === null) {
    for (const f of fallback) want.set(f.itemId, Math.min(f.unshippedQuantity, total.get(f.itemId) ?? 0))
  } else {
    if (!Array.isArray(rawUnshipped)) throw new Error('미출고 수량 형식이 올바르지 않습니다.')
    const nameOf = new Map(kinds.map((k) => [k.itemId, k.item.name]))
    for (const u of rawUnshipped as { itemId?: unknown; quantity?: unknown }[]) {
      const itemId = Number(u?.itemId)
      const q = Number(u?.quantity)
      if (!Number.isInteger(itemId) || !nameOf.has(itemId)) throw new Error('미출고 수량의 구성품이 올바르지 않습니다. 구성 설정이 바뀌었을 수 있으니 창을 닫고 다시 시도하세요.')
      if (!Number.isInteger(q) || q < 0) throw new Error('미출고 수량은 0 이상의 정수여야 합니다.')
      if (q === 0) continue
      const max = total.get(itemId) ?? 0
      if (q > max) throw new Error(`'${nameOf.get(itemId)}' 미출고 수량(${q})이 구성품 수량(${max})보다 많습니다.`)
      want.set(itemId, q)
    }
  }
  return kinds
    .filter((k) => (total.get(k.itemId) ?? 0) > 0)
    .map((k) => ({ itemId: k.itemId, quantity: total.get(k.itemId)!, unshippedQuantity: want.get(k.itemId) ?? 0, sortOrder: k.sortOrder }))
}

/** 라인 쓰기 (생성·라인 교체 공용) — 호출 전에 기존 라인은 비워져 있어야 한다 */
export async function writeStockOutLines(tx: Prisma.TransactionClient, requestId: number, lines: StockOutLine[]): Promise<void> {
  await tx.stockOutRequestItem.createMany({ data: lines.map((l) => ({ requestId, inventoryItemId: l.inventoryItemId, quantity: l.quantity })) })
}

/** 요청 단위 구성품 쓰기 — 전체 교체. 이미 기록된 출고 처리 시리얼은 같은 구성품이면 이어받는다 */
export async function writeStockOutComponents(tx: Prisma.TransactionClient, requestId: number, rows: StockOutComponentRow[]): Promise<void> {
  const prev = await tx.stockOutRequestComponent.findMany({ where: { requestId }, select: { itemId: true, shippedSerials: true, unshippedSerials: true } })
  const prevBy = new Map(prev.map((r) => [r.itemId, r]))
  await tx.stockOutRequestComponent.deleteMany({ where: { requestId } })
  if (!rows.length) return
  await tx.stockOutRequestComponent.createMany({
    data: rows.map((r) => ({ requestId, ...r, shippedSerials: prevBy.get(r.itemId)?.shippedSerials ?? null, unshippedSerials: prevBy.get(r.itemId)?.unshippedSerials ?? null })),
  })
}
