import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { AS_CATEGORIES, parseSerialTextarea } from '@/lib/asReceiptShared'
import { createAsReceipt, AsServiceError, type LineInput } from '@/lib/asReceiptService'
import { notifyTicketCreated } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'

/**
 * AS접수 목록/등록 (as_work_design.md §7 — 8번째 티켓 도메인 AS)
 * 병원 필수 연결. 등록 시 연결 티켓 자동 생성 + 라인별 기기현황 AS 표시(경고 수집) — 단일 트랜잭션.
 * 담당 배정은 티켓이 단독 소유 — 도메인에는 등록자(createdBy)만 기록.
 */

const listInclude = {
  hospital: { select: { hospitalCode: true, hospitalName: true } },
  status: { select: { id: true, name: true, color: true } },
  createdBy: { select: { id: true, name: true } },
  ticket: { select: { id: true, ticketCode: true, status: true, owner: { select: { id: true, name: true } } } },
  items: { select: { id: true, serialNo: true, outcome: true }, orderBy: { id: 'asc' as const } },
} as const

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const where: Prisma.AsReceiptWhereInput = {}

  // 접수일 기간 필터
  const from = sp.get('from')
  const to = sp.get('to')
  if (from || to) {
    where.receiptDate = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    }
  }

  // 상태 복수 선택 (2026-09-07) — ?statusId=1&statusId=2
  const statusIds = sp.getAll('statusId').map((v) => parseInt(v)).filter((v) => Number.isInteger(v))
  if (statusIds.length === 1) where.statusId = statusIds[0]
  else if (statusIds.length > 1) where.statusId = { in: statusIds }

  const category = sp.get('category')
  if (category && (AS_CATEGORIES as readonly string[]).includes(category)) where.category = category

  const hospitalCode = sp.get('hospitalCode')
  if (hospitalCode) where.hospitalCode = hospitalCode

  const q = sp.get('q')?.trim()
  if (q) {
    where.OR = [
      { asCode: { contains: q, mode: 'insensitive' } },
      { reporterName: { contains: q, mode: 'insensitive' } },
      { hospital: { hospitalName: { contains: q, mode: 'insensitive' } } },
      { items: { some: { serialNo: { contains: q.replace(/\s+/g, ''), mode: 'insensitive' } } } },
    ]
  }

  const page = Math.max(1, parseInt(sp.get('page') ?? '1') || 1)
  const pageSize = Math.min(100, Math.max(10, parseInt(sp.get('pageSize') ?? '30') || 30))

  const [total, receipts] = await Promise.all([
    prisma.asReceipt.count({ where }),
    prisma.asReceipt.findMany({
      where,
      include: listInclude,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  return NextResponse.json({ receipts, total, page, pageSize })
}

/** items 입력 정리 — [{serial, symptom?, wardName?, deviceKind?}] 또는 serialsText(줄 단위) */
function parseLines(body: Record<string, unknown>): LineInput[] {
  if (Array.isArray(body.items) && body.items.length) {
    return (body.items as Record<string, unknown>[]).map((row) => ({
      serial: String(row.serial ?? ''),
      symptom: typeof row.symptom === 'string' ? row.symptom : null,
      wardName: typeof row.wardName === 'string' ? row.wardName : null,
      deviceKind: typeof row.deviceKind === 'string' ? row.deviceKind : null,
    }))
  }
  if (typeof body.serialsText === 'string') return parseSerialTextarea(body.serialsText).map((serial) => ({ serial }))
  return []
}


export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()

  // 상태 statusId — 빈 문자열은 미지정으로
  let statusId: number | null | undefined = undefined
  if (body.statusId !== undefined && body.statusId !== null && body.statusId !== '') {
    const sid = Number(body.statusId)
    statusId = Number.isInteger(sid) ? sid : NaN as unknown as number // 비정수는 서비스에서 400
  }

  // 접수일 필수 (기본 오늘은 클라이언트 몫)
  const receiptDate = body.receiptDate ? new Date(body.receiptDate) : new Date(NaN)

  let result!: Awaited<ReturnType<typeof createAsReceipt>>
  try {
    result = await createAsReceipt(
      {
        hospitalCode: typeof body.hospitalCode === 'string' ? body.hospitalCode : '',
        category: typeof body.category === 'string' ? body.category : 'FAULT',
        receiptDate,
        reporterName: typeof body.reporterName === 'string' ? body.reporterName : null,
        pickupMethod: body.pickupMethod ?? null,
        pickupTrackingNo: typeof body.pickupTrackingNo === 'string' ? body.pickupTrackingNo : null,
        preReplace: body.preReplace === true,
        statusId,
        note: typeof body.note === 'string' ? body.note : null,
        lines: parseLines(body),
      },
      { userId: user.userId, name: user.name }
    )
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }

  const asReceipt = await prisma.asReceipt.findUnique({ where: { id: result.id }, include: listInclude })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'as_receipt',
    resourceId: result.asCode,
    resourceLabel: `${result.asCode} ${result.hospitalName}`,
    after: asReceipt,
  })

  // Slack 알림 — 티켓 파이프라인 단일 소스 (규칙 1), best-effort
  syncTicketClocksSafe(result.ticketId)
  notifyTicketCreated({ ticketId: result.ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})

  return NextResponse.json({ asReceipt, warnings: result.warnings }, { status: 201 })
}
