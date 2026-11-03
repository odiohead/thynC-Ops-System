import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { nextSorCode, validateStockOutLines } from '@/lib/stockOut'
import { isStockOutPurpose, type StockOutPurpose } from '@/lib/stockOutShared'
import { createTicketForStockOut } from '@/lib/ticket-domains/stockOut'
import { notifyTicketCreated } from '@/lib/notify'
import { notifyStockOutCreated } from '@/lib/stockOutNotify'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'

/**
 * 출고요청 목록/등록 (stock_out_request_design.md §7 — 7번째 티켓 도메인 STOCK_OUT)
 * 프로젝트 필수 연결. 등록 시 연결 티켓 자동 생성(레코드+라인+티켓 단일 트랜잭션).
 * 담당 배정은 티켓이 단독 소유 — 도메인에는 생성자(createdBy)만 기록.
 */

const listInclude = {
  project: { select: { projectCode: true, projectName: true, hospital: { select: { hospitalCode: true, hospitalName: true } } } },
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
  if (createdById) where.createdById = createdById

  const q = sp.get('q')?.trim()
  if (q) {
    where.OR = [
      { sorCode: { contains: q, mode: 'insensitive' } },
      { note: { contains: q, mode: 'insensitive' } },
      { project: { projectName: { contains: q, mode: 'insensitive' } } },
      { project: { hospital: { hospitalName: { contains: q, mode: 'insensitive' } } } },
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

  // 프로젝트 필수 (설계 §2-3 — 프로젝트 없이 출고요청 불가)
  const projectCode = typeof body.projectCode === 'string' ? body.projectCode.trim() : ''
  if (!projectCode) return NextResponse.json({ error: '프로젝트를 선택하세요.' }, { status: 400 })
  const project = await prisma.project.findUnique({
    where: { projectCode },
    select: { projectCode: true, projectName: true, hospitalCode: true },
  })
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 400 })

  // 희망 출고일 필수
  const requestDate = body.requestDate ? new Date(body.requestDate) : new Date(NaN)
  if (isNaN(requestDate.getTime())) return NextResponse.json({ error: '희망 출고일을 입력하세요.' }, { status: 400 })

  // 업무 구분 — 이번 범위는 프로젝트 팝업 = 구축(BUILD) 고정. 명시 입력 시 어휘만 검증
  const purpose: StockOutPurpose = body.purpose === undefined || body.purpose === null ? 'BUILD' : body.purpose
  if (!isStockOutPurpose(purpose)) return NextResponse.json({ error: '업무 구분이 올바르지 않습니다.' }, { status: 400 })

  let items: { inventoryItemId: number; quantity: number }[]
  try {
    items = await validateStockOutLines(body.items, purpose)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  // 상태 — 지정 시 카테고리 검증, 미지정이면 '요청'
  let statusId: number | null = null
  if (body.statusId !== undefined && body.statusId !== null && body.statusId !== '') {
    const sid = Number(body.statusId)
    const row = Number.isInteger(sid)
      ? await prisma.statusCode.findFirst({ where: { id: sid, category: 'STOCK_OUT_STATUS' }, select: { id: true } })
      : null
    if (!row) return NextResponse.json({ error: '상태가 올바르지 않습니다.' }, { status: 400 })
    statusId = row.id
  } else {
    const req = await prisma.statusCode.findFirst({ where: { category: 'STOCK_OUT_STATUS', name: '요청' }, select: { id: true } })
    statusId = req?.id ?? null
  }
  const statusRow = statusId ? await prisma.statusCode.findUnique({ where: { id: statusId }, select: { name: true } }) : null

  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null

  // 레코드+라인+연결 티켓 단일 트랜잭션 — 티켓 없는 출고요청을 만들지 않는다. 발번 P2002 1회 재시도.
  let created!: { id: number; sorCode: string }
  let ticketId!: number
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const sor = await tx.stockOutRequest.create({
          data: {
            sorCode: await nextSorCode(tx),
            projectCode: project.projectCode,
            purpose,
            statusId,
            requestDate,
            note,
            createdById: user.userId,
          },
        })
        await tx.stockOutRequestItem.createMany({ data: items.map((l) => ({ requestId: sor.id, ...l })) })
        const tid = await createTicketForStockOut(tx, {
          id: sor.id,
          sorCode: sor.sorCode,
          projectName: project.projectName,
          hospitalCode: project.hospitalCode,
          statusName: statusRow?.name ?? null,
          statusId: sor.statusId,
          note: sor.note,
          requestDate: sor.requestDate,
          resolvedAt: null,
          createdAt: sor.createdAt,
        }, user.userId, 'domain')
        return { sor, tid }
      })
      created = result.sor
      ticketId = result.tid
      break
    } catch (err) {
      if (attempt === 0 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue
      throw err
    }
  }

  const stockOutRequest = await prisma.stockOutRequest.findUnique({ where: { id: created.id }, include: listInclude })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'stock_out_request',
    resourceId: created.sorCode,
    resourceLabel: `${created.sorCode} ${project.projectName}`,
    after: stockOutRequest,
  })

  // Slack 알림 — 티켓 파이프라인 단일 소스 (규칙 1), best-effort
  syncTicketClocksSafe(ticketId)
  notifyTicketCreated({ ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})
  notifyStockOutCreated(created.id).catch(() => {}) // 출고업무 전용 '출고요청 등록' 도메인 이벤트 (2026-11-02, projects/stock_out_notify_design.md)

  return NextResponse.json({ stockOutRequest }, { status: 201 })
}
