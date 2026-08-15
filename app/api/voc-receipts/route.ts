import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { nextVocCode } from '@/lib/csCodes'
import { createTicketForVoc } from '@/lib/ticket-domains/voc'
import { notifyTicketCreated } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'

/**
 * VOC접수 목록/등록 (cs_ticket_workflow_design.md §5 — 2026-08-15 개정)
 * 도메인 레코드 — 등록 시 연결 티켓(refType 'VOC') 자동 생성 = CS 마스터 티켓.
 * 담당 배정은 티켓이 단독 소유 — 도메인에는 생성자(createdBy)만 기록한다.
 */

const listInclude = {
  hospital: { select: { hospitalCode: true, hospitalName: true } },
  channel: { select: { id: true, name: true, color: true } },
  vocType: { select: { id: true, name: true, color: true } },
  status: { select: { id: true, name: true, color: true } },
  createdBy: { select: { id: true, name: true } },
  ticket: { select: { id: true, ticketCode: true, status: true, owner: { select: { id: true, name: true } } } },
} as const

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const where: Prisma.VocReceiptWhereInput = {}

  const from = sp.get('from')
  const to = sp.get('to')
  if (from || to) {
    where.receivedAt = {
      ...(from ? { gte: new Date(`${from}T00:00:00+09:00`) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59.999+09:00`) } : {}),
    }
  }

  // 숫자 파라미터는 NaN 방어 — NaN이 Prisma where에 들어가면 500 (리뷰 2026-08-15)
  const statusId = parseInt(sp.get('statusId') ?? '')
  if (Number.isInteger(statusId)) where.statusId = statusId

  const vocTypeId = parseInt(sp.get('vocTypeId') ?? '')
  if (Number.isInteger(vocTypeId)) where.vocTypeId = vocTypeId

  const hospitalCode = sp.get('hospitalCode')
  if (hospitalCode) where.hospitalCode = hospitalCode

  const createdById = sp.get('createdById')
  if (createdById) where.createdById = createdById

  const q = sp.get('q')?.trim()
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { content: { contains: q, mode: 'insensitive' } },
      { vocCode: { contains: q, mode: 'insensitive' } },
      { customerName: { contains: q, mode: 'insensitive' } },
      { hospitalNameRaw: { contains: q, mode: 'insensitive' } },
      { hospital: { hospitalName: { contains: q, mode: 'insensitive' } } },
    ]
  }

  const page = Math.max(1, parseInt(sp.get('page') ?? '1') || 1)
  const pageSize = Math.min(100, Math.max(10, parseInt(sp.get('pageSize') ?? '30') || 30))

  const [total, vocReceipts] = await Promise.all([
    prisma.vocReceipt.count({ where }),
    prisma.vocReceipt.findMany({
      where,
      include: listInclude,
      orderBy: { receivedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  return NextResponse.json({ vocReceipts, total, page, pageSize })
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 })

  let hospitalCode: string | null = null
  if (typeof body.hospitalCode === 'string' && body.hospitalCode) {
    const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: body.hospitalCode }, select: { hospitalCode: true } })
    if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 400 })
    hospitalCode = hospital.hospitalCode
  }

  async function statusCodeOf(category: string, idVal: unknown, label: string): Promise<number | null> {
    if (typeof idVal !== 'number') return null
    const row = await prisma.statusCode.findFirst({ where: { id: idVal, category }, select: { id: true } })
    if (!row) throw new Error(`${label}이(가) 올바르지 않습니다.`)
    return row.id
  }

  let channelId: number | null
  let vocTypeId: number | null
  let statusId: number | null
  try {
    channelId = await statusCodeOf('VOC_CHANNEL', body.channelId, '접수 채널')
    vocTypeId = await statusCodeOf('VOC_TYPE', body.vocTypeId, 'VOC 분류')
    statusId = await statusCodeOf('VOC_STATUS', body.statusId, '상태')
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  // 기본 상태 '접수'
  if (!statusId) {
    const accept = await prisma.statusCode.findFirst({ where: { category: 'VOC_STATUS', name: '접수' }, select: { id: true } })
    statusId = accept?.id ?? null
  }

  let receivedAt: Date | undefined
  if (body.receivedAt) {
    const d = new Date(body.receivedAt)
    if (isNaN(d.getTime())) return NextResponse.json({ error: '접수 일시가 올바르지 않습니다.' }, { status: 400 })
    receivedAt = d
  }

  const statusRow = statusId ? await prisma.statusCode.findUnique({ where: { id: statusId }, select: { name: true } }) : null

  // VOC 레코드 + 연결 티켓을 **한 트랜잭션**으로 — 티켓 없는 VOC를 만들지 않는다 (실패 시 전부 롤백).
  // 코드 발번 UNIQUE 충돌(P2002)은 1회 재시도.
  let created!: { id: number; vocCode: string }
  let ticketId!: number
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const voc = await tx.vocReceipt.create({
          data: {
            vocCode: await nextVocCode(tx),
            title,
            hospitalCode,
            hospitalNameRaw: hospitalCode ? null : (typeof body.hospitalNameRaw === 'string' && body.hospitalNameRaw.trim() ? body.hospitalNameRaw.trim() : null),
            customerName: typeof body.customerName === 'string' && body.customerName.trim() ? body.customerName.trim() : null,
            customerPhone: typeof body.customerPhone === 'string' && body.customerPhone.trim() ? body.customerPhone.trim() : null,
            channelId,
            vocTypeId,
            statusId,
            content: typeof body.content === 'string' && body.content.trim() ? body.content.trim() : null,
            receivedAt,
            createdById: user.userId,
          },
        })
        const tid = await createTicketForVoc(tx, {
          id: voc.id,
          vocCode: voc.vocCode,
          title: voc.title,
          hospitalCode: voc.hospitalCode,
          hospitalName: null,
          statusName: statusRow?.name ?? null,
          statusId: voc.statusId,
          vocTypeId: voc.vocTypeId,
          content: voc.content,
          receivedAt: voc.receivedAt,
          resolvedAt: null,
          createdAt: voc.createdAt,
        }, user.userId, 'domain')
        return { voc, tid }
      })
      created = result.voc
      ticketId = result.tid
      break
    } catch (err) {
      if (attempt === 0 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue
      throw err
    }
  }

  const vocReceipt = await prisma.vocReceipt.findUnique({ where: { id: created.id }, include: listInclude })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'voc_receipt',
    resourceId: created.vocCode,
    resourceLabel: `${created.vocCode} ${title}`,
    after: vocReceipt,
  })

  // Slack 알림 (티켓 파이프라인 단일 소스 — 규칙 1) — best-effort
  syncTicketClocksSafe(ticketId)
  notifyTicketCreated({ ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})

  return NextResponse.json({ vocReceipt }, { status: 201 })
}
