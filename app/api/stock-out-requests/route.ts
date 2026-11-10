import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { isStockOutPurpose } from '@/lib/stockOutShared'
import { createStockOutRequest, StockOutCreateError } from '@/lib/stockOutCreate'
import { notifyTicketCreated } from '@/lib/notify'
import { notifyStockOutCreated } from '@/lib/stockOutNotify'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'

/**
 * 출고요청 목록/등록 (stock_out_request_design.md §7 — 7번째 티켓 도메인 STOCK_OUT)
 * 구축 등 프로젝트 업무는 프로젝트 필수, 영업 유형(평가용·판매용·오산영업소 — 모바일 등록)은 프로젝트 없이
 * 목적·납품처(병원/기타)·수령지·수취인 (stock_out_sales_request_design.md). 등록 시 연결 티켓 자동 생성(레코드+라인+티켓 단일 트랜잭션).
 * 담당 배정은 티켓이 단독 소유 — 도메인에는 생성자(createdBy)만 기록.
 */

const listInclude = {
  project: { select: { projectCode: true, projectName: true, hospital: { select: { hospitalCode: true, hospitalName: true } } } },
  asReceipt: { select: { id: true, asCode: true } }, // 분실 AS 연동 (2026-11-10)
  destHospital: { select: { hospitalCode: true, hospitalName: true } },
  status: { select: { id: true, name: true, color: true } },
  createdBy: { select: { id: true, name: true } },
  ticket: { select: { id: true, ticketCode: true, status: true, owner: { select: { id: true, name: true } } } },
  items: {
    select: { id: true, inventoryItemId: true, quantity: true, item: { select: { id: true, name: true, modelName: true, inventory: { select: { id: true, name: true } }, category: { select: { name: true } } } } },
    orderBy: { id: 'asc' as const },
  },
} as const

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const where: Prisma.StockOutRequestWhereInput = {}

  // 희망 출고일 기간 필터 (DATE 컬럼 — UTC 자정 기준)
  const from = sp.get('from')
  const to = sp.get('to')
  if (from || to) {
    where.requestDate = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    }
  }

  // 숫자 파라미터 NaN 방어 (VOC 리뷰 선례)
  const statusId = parseInt(sp.get('statusId') ?? '')
  if (Number.isInteger(statusId)) where.statusId = statusId

  const projectCode = sp.get('projectCode')
  if (projectCode) where.projectCode = projectCode

  const createdById = sp.get('createdById')
  if (createdById === 'me') where.createdById = user.userId
  else if (createdById) where.createdById = createdById

  const purposeParam = sp.get('purpose')
  if (purposeParam === 'SALES_TYPES') where.purpose = { in: ['EVALUATION', 'SALES', 'OSAN_OFFICE'] }
  else if (isStockOutPurpose(purposeParam)) where.purpose = purposeParam

  const q = sp.get('q')?.trim()
  if (q) {
    where.OR = [
      { sorCode: { contains: q, mode: 'insensitive' } },
      { note: { contains: q, mode: 'insensitive' } },
      { project: { projectName: { contains: q, mode: 'insensitive' } } },
      { project: { hospital: { hospitalName: { contains: q, mode: 'insensitive' } } } },
      { destHospital: { hospitalName: { contains: q, mode: 'insensitive' } } },
      { destText: { contains: q, mode: 'insensitive' } },
      { recipient: { contains: q, mode: 'insensitive' } },
    ]
  }

  const page = Math.max(1, parseInt(sp.get('page') ?? '1') || 1)
  const pageSize = Math.min(100, Math.max(10, parseInt(sp.get('pageSize') ?? '30') || 30))

  const [total, requests] = await Promise.all([
    prisma.stockOutRequest.count({ where }),
    prisma.stockOutRequest.findMany({
      where,
      include: listInclude,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  return NextResponse.json({ requests, total, page, pageSize })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  // 검증·발번·라인·연결 티켓은 공용 코어(lib/stockOutCreate.ts — 분실 AS [출고요청]과 동일 경로, 2026-11-10). 수동 생성은 AS 연결 없음
  let created: { id: number; sorCode: string; ticketId: number; title: string }
  try {
    created = await createStockOutRequest({ ...body, asReceiptId: null }, { userId: user.userId, name: user.name })
  } catch (e) {
    if (e instanceof StockOutCreateError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }
  const ticketId = created.ticketId
  const title = created.title

  const stockOutRequest = await prisma.stockOutRequest.findUnique({ where: { id: created.id }, include: listInclude })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'stock_out_request',
    resourceId: created.sorCode,
    resourceLabel: `${created.sorCode} ${title}`,
    after: stockOutRequest,
  })

  // Slack 알림 — 티켓 파이프라인 단일 소스 (규칙 1), best-effort
  syncTicketClocksSafe(ticketId)
  notifyTicketCreated({ ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})
  notifyStockOutCreated(created.id).catch(() => {}) // 출고업무 전용 '출고요청 등록' 도메인 이벤트 (2026-11-02, projects/stock_out_notify_design.md)

  return NextResponse.json({ stockOutRequest }, { status: 201 })
}
