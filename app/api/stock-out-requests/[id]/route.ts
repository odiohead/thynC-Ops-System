import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { hasPermission } from '@/lib/appRoles'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { canEditStockOutRequest, validateStockOutLines } from '@/lib/stockOut'
import type { StockOutPurpose } from '@/lib/stockOutShared'
import { syncStockOutToTicket } from '@/lib/ticket-domains/stockOut'
import { notifyTicketChanged } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * 출고요청 상세/수정/삭제 (stock_out_request_design.md §7)
 * 수정·삭제 권한: ADMIN 이상 항상 / USER는 본인 요청 + 종결(완료·취소) 전 (설계 §2-6)
 */

const detailInclude = {
  project: { select: { projectCode: true, projectName: true, hospital: { select: { hospitalCode: true, hospitalName: true } } } },
  status: { select: { id: true, name: true, color: true, ticketStatus: true } },
  createdBy: { select: { id: true, name: true } },
  fulfilledBy: { select: { id: true, name: true } },
  ticket: { select: { id: true, ticketCode: true, status: true, owner: { select: { id: true, name: true } } } },
  items: {
    select: { id: true, inventoryItemId: true, quantity: true, fulfilledSerials: true, item: { select: { id: true, name: true, modelName: true, isSerialManaged: true, inventory: { select: { id: true, name: true } }, category: { select: { name: true } } } } },
    orderBy: { id: 'asc' as const },
  },
  // 처리 전표 (P2 — stock_out_request_id 역조회, 취소 여부 포함)
  transactions: {
    select: {
      id: true, txCode: true, txType: true, quantity: true, lotNo: true, txDate: true, canceledAt: true,
      item: { select: { name: true } },
      inventory: { select: { name: true } },
    },
    orderBy: { id: 'asc' as const },
  },
} as const

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const stockOutRequest = await prisma.stockOutRequest.findUnique({ where: { id }, include: detailInclude })
  if (!stockOutRequest) return NextResponse.json({ error: '출고요청을 찾을 수 없습니다.' }, { status: 404 })

  return NextResponse.json({ stockOutRequest })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const existing = await prisma.stockOutRequest.findUnique({
    where: { id },
    include: { status: { select: { id: true, name: true, ticketStatus: true } }, items: { select: { inventoryItemId: true } } },
  })
  if (!existing) return NextResponse.json({ error: '출고요청을 찾을 수 없습니다.' }, { status: 404 })

  // ADMIN 이상 또는 (USER 이상 + stock_out.admin 권한) — RBAC v1.5 가산, VIEWER 제외
  if (!canEditStockOutRequest(user, existing, await hasPermission(user, 'stock_out.admin'))) {
    return NextResponse.json({ error: '수정 권한이 없습니다. 본인 요청은 완료·취소 전까지만 수정할 수 있습니다.' }, { status: 403 })
  }

  const body = await request.json()
  const data: Prisma.StockOutRequestUncheckedUpdateInput = {}
  let items: { inventoryItemId: number; quantity: number }[] | null = null

  try {
    if (body.requestDate !== undefined) {
      const d = body.requestDate ? new Date(body.requestDate) : new Date(NaN)
      if (isNaN(d.getTime())) return NextResponse.json({ error: '희망 출고일이 올바르지 않습니다.' }, { status: 400 })
      data.requestDate = d
    }
    if (body.note !== undefined) data.note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null
    if (body.statusId !== undefined) {
      const sid = Number(body.statusId)
      const row = Number.isInteger(sid)
        ? await prisma.statusCode.findFirst({ where: { id: sid, category: 'STOCK_OUT_STATUS' }, select: { id: true, ticketStatus: true } })
        : null
      if (!row) return NextResponse.json({ error: '상태가 올바르지 않습니다.' }, { status: 400 })
      data.statusId = row.id
      if (row.id !== existing.statusId) {
        data.statusChangedAt = new Date()
        // 완료일 자동 관리 — 종결 버킷(완료·취소 → CLOSED 매핑) 진입 시 기록, 이탈 시 해제
        const terminal = row.ticketStatus === 'RESOLVED' || row.ticketStatus === 'CLOSED'
        if (terminal && !existing.resolvedAt) data.resolvedAt = new Date()
        if (!terminal && existing.resolvedAt) data.resolvedAt = null
      }
    }
    if (body.items !== undefined) items = await validateStockOutLines(body.items, existing.purpose as StockOutPurpose, existing.items.map((l) => l.inventoryItemId))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  // 갱신 + 라인 교체 + 티켓 동기화(어댑터 경유 — 규칙 3)를 한 트랜잭션으로
  await prisma.$transaction(async (tx) => {
    await tx.stockOutRequest.update({ where: { id }, data })
    if (items) {
      await tx.stockOutRequestItem.deleteMany({ where: { requestId: id } })
      await tx.stockOutRequestItem.createMany({ data: items.map((l) => ({ requestId: id, ...l })) })
    }
    await syncStockOutToTicket(tx, id, user.userId)
  })

  const stockOutRequest = await prisma.stockOutRequest.findUnique({ where: { id }, include: detailInclude })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'stock_out_request',
    resourceId: existing.sorCode,
    resourceLabel: `${existing.sorCode}`,
    before: existing,
    after: stockOutRequest,
  })

  if (existing.ticketId) {
    syncTicketClocksSafe(existing.ticketId)
    notifyTicketChanged({ ticketId: existing.ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})
  }

  return NextResponse.json({ stockOutRequest })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const existing = await prisma.stockOutRequest.findUnique({
    where: { id },
    include: { status: { select: { id: true, name: true, ticketStatus: true } } },
  })
  if (!existing) return NextResponse.json({ error: '출고요청을 찾을 수 없습니다.' }, { status: 404 })

  // ADMIN 이상 또는 (USER 이상 + stock_out.admin 권한) — RBAC v1.5 가산, VIEWER 제외
  if (!canEditStockOutRequest(user, existing, await hasPermission(user, 'stock_out.admin'))) {
    return NextResponse.json({ error: '삭제 권한이 없습니다. 본인 요청은 완료·취소 전까지만 삭제할 수 있습니다.' }, { status: 403 })
  }

  await prisma.stockOutRequest.delete({ where: { id } }) // 라인은 FK CASCADE

  // 연결 티켓도 삭제 (도메인과 생명주기 공유 — 유지보수 P5·VOC 선례)
  if (existing.ticketId) {
    await prisma.ticket.delete({ where: { id: existing.ticketId } }).catch(() => {})
  }

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'stock_out_request',
    resourceId: existing.sorCode,
    resourceLabel: `${existing.sorCode}`,
    before: existing,
  })

  return NextResponse.json({ success: true })
}
