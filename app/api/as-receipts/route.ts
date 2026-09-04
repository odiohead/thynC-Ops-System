import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { nextAsCode } from '@/lib/asReceipt'
import { AS_CATEGORIES, AS_METHODS, parseSerialTextarea } from '@/lib/asReceiptShared'
import { matchSerials, matchWarning, openAsFlags, AsServiceError, type LineInput } from '@/lib/asReceiptService'
import { createTicketForAsReceipt } from '@/lib/ticket-domains/asReceipt'
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

  const statusId = parseInt(sp.get('statusId') ?? '')
  if (Number.isInteger(statusId)) where.statusId = statusId

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

  // 병원 필수
  const hospitalCode = typeof body.hospitalCode === 'string' ? body.hospitalCode.trim() : ''
  if (!hospitalCode) return NextResponse.json({ error: '병원을 선택하세요.' }, { status: 400 })
  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode }, select: { hospitalCode: true, hospitalName: true } })
  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 400 })

  // 구분 (고장/분실 — 결정 10)
  const category = typeof body.category === 'string' ? body.category : 'FAULT'
  if (!(AS_CATEGORIES as readonly string[]).includes(category)) return NextResponse.json({ error: '구분이 올바르지 않습니다.' }, { status: 400 })

  // 접수일 필수 (기본 오늘은 클라이언트 몫)
  const receiptDate = body.receiptDate ? new Date(body.receiptDate) : new Date(NaN)
  if (isNaN(receiptDate.getTime())) return NextResponse.json({ error: '접수일을 입력하세요.' }, { status: 400 })

  const pickupMethod = body.pickupMethod ?? null
  if (pickupMethod && !(AS_METHODS as readonly string[]).includes(pickupMethod)) {
    return NextResponse.json({ error: '수거방법이 올바르지 않습니다.' }, { status: 400 })
  }

  const lines = parseLines(body)
  if (!lines.length) return NextResponse.json({ error: '기기 시리얼을 1개 이상 입력하세요.' }, { status: 400 })
  const seen = new Set<string>()
  for (const l of lines) {
    const key = l.serial.replace(/\s+/g, '').toUpperCase()
    if (!key) return NextResponse.json({ error: '시리얼이 비어 있습니다.' }, { status: 400 })
    if (seen.has(key)) return NextResponse.json({ error: `같은 시리얼이 중복 입력되었습니다: ${key}` }, { status: 400 })
    seen.add(key)
  }

  // 상태 — 지정 시 카테고리 검증, 미지정이면 '접수'
  let statusId: number | null = null
  if (body.statusId !== undefined && body.statusId !== null && body.statusId !== '') {
    const sid = Number(body.statusId)
    const row = Number.isInteger(sid)
      ? await prisma.statusCode.findFirst({ where: { id: sid, category: 'AS_STATUS' }, select: { id: true } })
      : null
    if (!row) return NextResponse.json({ error: '상태가 올바르지 않습니다.' }, { status: 400 })
    statusId = row.id
  } else {
    const open = await prisma.statusCode.findFirst({ where: { category: 'AS_STATUS', name: '접수' }, select: { id: true } })
    statusId = open?.id ?? null
  }
  const statusRow = statusId ? await prisma.statusCode.findUnique({ where: { id: statusId }, select: { name: true } }) : null

  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null
  const reporterName = typeof body.reporterName === 'string' && body.reporterName.trim() ? body.reporterName.trim() : null
  const pickupTrackingNo = typeof body.pickupTrackingNo === 'string' && body.pickupTrackingNo.trim() ? body.pickupTrackingNo.trim() : null
  const preReplace = body.preReplace === true

  // 티켓 설명 소스 — 비고 또는 라인 접수사유 상위 3건
  const symptoms = lines.map((l) => l.symptom?.trim()).filter((s): s is string => !!s)
  const description = note ?? (symptoms.length ? symptoms.slice(0, 3).join(' / ') : null)

  // 레코드+라인+연결 티켓+AS 표시 단일 트랜잭션 — 발번 P2002 1회 재시도
  let created!: { id: number; asCode: string }
  let ticketId!: number
  let warnings: string[] = []
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await prisma.$transaction(
          async (tx) => {
            const receipt = await tx.asReceipt.create({
              data: {
                asCode: await nextAsCode(tx),
                hospitalCode: hospital.hospitalCode,
                category,
                receiptDate,
                reporterName,
                pickupMethod,
                pickupTrackingNo,
                preReplace,
                statusId,
                note,
                createdById: user.userId,
              },
            })
            // 라인 매칭 + 생성
            const txWarnings: string[] = []
            const matches = await matchSerials(tx, hospital.hospitalCode, lines.map((l) => l.serial))
            const flagTargets: { serialNo: string; deviceId: number }[] = []
            for (let i = 0; i < matches.length; i++) {
              const m = matches[i]
              const line = lines[i]
              const w = matchWarning(m)
              if (w) txWarnings.push(w)
              await tx.asReceiptItem.create({
                data: {
                  receiptId: receipt.id,
                  serialNo: m.serialNo,
                  deviceId: m.deviceId,
                  deviceKind: m.deviceId ? null : line.deviceKind?.trim() || null,
                  wardName: line.wardName?.trim() || m.wardName,
                  symptom: line.symptom?.trim() || null,
                },
              })
              if (m.state === 'ACTIVE_HERE' && !m.asOpen) flagTargets.push({ serialNo: m.serialNo, deviceId: m.deviceId! })
            }
            const tid = await createTicketForAsReceipt(tx, {
              id: receipt.id,
              asCode: receipt.asCode,
              hospitalCode: hospital.hospitalCode,
              hospitalName: hospital.hospitalName,
              category,
              statusName: statusRow?.name ?? null,
              statusId: receipt.statusId,
              description,
              resolvedAt: null,
              createdAt: receipt.createdAt,
            }, user.userId, 'domain')
            // AS 표시 — 접수일 기준, 실패는 경고 (ref 검증이 접수 레코드를 참조하므로 티켓 생성 후 호출 무관)
            txWarnings.push(
              ...(await openAsFlags(
                tx,
                { asCode: receipt.asCode, hospitalCode: hospital.hospitalCode },
                flagTargets,
                { userId: user.userId, name: user.name },
                receipt.receiptDate.toISOString().slice(0, 10)
              ))
            )
            return { receipt, tid, txWarnings }
          },
          { timeout: 60000, maxWait: 10000 }
        )
        created = result.receipt
        ticketId = result.tid
        warnings = result.txWarnings
        break
      } catch (err) {
        if (attempt === 0 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue
        throw err
      }
    }
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }

  const asReceipt = await prisma.asReceipt.findUnique({ where: { id: created.id }, include: listInclude })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'as_receipt',
    resourceId: created.asCode,
    resourceLabel: `${created.asCode} ${hospital.hospitalName}`,
    after: asReceipt,
  })

  // Slack 알림 — 티켓 파이프라인 단일 소스 (규칙 1), best-effort
  syncTicketClocksSafe(ticketId)
  notifyTicketCreated({ ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})

  return NextResponse.json({ asReceipt, warnings }, { status: 201 })
}
