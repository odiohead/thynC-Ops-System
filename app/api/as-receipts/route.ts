import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { AS_CATEGORIES, AS_TAGS, AS_TAG_FIELDS, parseSerialTextarea, summarizeAsRegistryTags, isAsIntakeIssue, type AsTag, parseAsSearchField } from '@/lib/asReceiptShared'
import { buildAsReceiptSearchOr, findOpenLinesBySerial, duplicatesForReceipt } from '@/lib/asReceiptSearch'
import { createAsReceipt, AsServiceError, type LineInput } from '@/lib/asReceiptService'
import { toRegistryErrorResponse } from '@/lib/deviceRegistry'
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
  items: {
    select: {
      id: true, serialNo: true, outcome: true, deviceKind: true, intakeState: true, receivedAt: true, shippedAt: true, shipTrackingNo: true, // 입고 대조 (2026-09-11) · 발송일·발송 송장 열 (2026-09-15) · 입고일 열 (2026-09-16)
      repairedAt: true, // 수리완료 체크 (2026-09-17) — 목록 기기군 배지 `수리 n/m`
      device: { select: { deviceInfo: { select: { deviceName: true } }, placement: { select: { productType: true } } } }, // 목록 기기별 대수 표기 (CX #1) + 상품유형(일반/라이트, 2026-09-10)
      newDevice: { select: { placement: { select: { productType: true } } } }, // 교체 라인 — 구기기 배치가 회수된 뒤에는 교체기 배치의 상품유형으로 판별
    },
    orderBy: { id: 'asc' as const },
  },
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

  // 태그 필터 (2026-09-15) — ?tag=PRE_REPLACE&tag=PRIORITY_REPAIR (복수 = 모두 켜진 접수, AND)
  for (const t of sp.getAll('tag')) {
    if ((AS_TAGS as readonly string[]).includes(t)) where[AS_TAG_FIELDS[t as AsTag]] = true
  }

  // 접수 2주 경과 미처리 (2026-09-15 — 요약 카드 클릭 필터): summary.overdue2w와 동일 정의(KST 오늘 기준 14일 전 미만 접수 & 비종결·상태 없음)
  if (sp.get('overdue') === '1') {
    const kstTodayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
    const cut = new Date(new Date(`${kstTodayYmd}T00:00:00Z`).getTime() - 14 * 86400000)
    where.receiptDate = { ...(where.receiptDate as object | undefined), lt: cut } // 접수일 기간 필터(gte/lte)와 병행 가능
    where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { OR: [{ statusId: null }, { status: { ticketStatus: { notIn: ['RESOLVED', 'CLOSED'] } } }, { status: { ticketStatus: null } }] }]
  }

  // 접수 기기상태 '확인필요' 필터 (2026-09-15) — 목록 배지와 같은 정의: 미종결 라인 중 원장 정합 태그(미등록·미배치·회수·타병원) 또는 입고 대조(미입고·미식별입고) 또는 중복접수(같은 시리얼 미종결 라인이 다른 접수에 — 2026-09-18)가 있는 접수
  if (sp.get('needsCheck') === '1') {
    const rows = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
      SELECT DISTINCT r.id FROM as_receipts r
      JOIN as_receipt_items i ON i.receipt_id = r.id AND i.outcome IS NULL
      LEFT JOIN device_units du ON du.serial_no = i.serial_no
      LEFT JOIN hospital_devices hd ON hd.device_id = du.id
      WHERE i.intake_state IN ('MISMATCH', 'EXTRA')
         OR du.id IS NULL OR hd.id IS NULL OR hd.status <> 'ACTIVE' OR hd.hospital_code IS DISTINCT FROM r.hospital_code
         OR EXISTS (SELECT 1 FROM as_receipt_items o JOIN as_receipts orr ON orr.id = o.receipt_id LEFT JOIN status_codes os ON os.id = orr.status_id
                    WHERE o.serial_no = i.serial_no AND o.outcome IS NULL AND o.receipt_id <> r.id
                      AND (os.ticket_status IS NULL OR os.ticket_status NOT IN ('RESOLVED', 'CLOSED')))`) // 중복접수 (2026-09-18) — 상대 접수가 종결이면 제외 (2026-09-19, findOpenLinesBySerial과 동일 정의)
    where.id = { in: rows.map((x) => x.id) }
  }

  const hospitalCode = sp.get('hospitalCode')
  if (hospitalCode) where.hospitalCode = hospitalCode

  // 기기군 필터 (2026-09-11) — ?group=ECG|SPO2 (둘 다면 미지정). 원장 모델명 → 미등록 기기종류 → 시리얼 접두(A 심전계 / P 산소포화도)
  const group = sp.get('group')
  if (group === 'ECG' || group === 'SPO2') {
    const [nameKey, kindKey, prefix] = group === 'ECG' ? ['심전', '심전', 'A'] : ['산소', '산소', 'P']
    where.items = {
      ...(where.items as object | undefined),
      some: {
        ...((where.items as { some?: object } | undefined)?.some ?? {}),
        OR: [
          { device: { deviceInfo: { deviceName: { contains: nameKey } } } },
          { deviceId: null, deviceKind: { contains: kindKey } },
          { deviceId: null, deviceKind: null, serialNo: { startsWith: prefix } },
        ],
      },
    }
  }

  // 발송(출고)일 기간 필터 (CX #9) — 라인 shippedAt 기준
  const shippedFrom = sp.get('shippedFrom')
  const shippedTo = sp.get('shippedTo')
  if (shippedFrom || shippedTo) {
    where.items = {
      some: {
        ...((where.items as { some?: object } | undefined)?.some ?? {}),
        shippedAt: {
          ...(shippedFrom ? { gte: new Date(shippedFrom) } : {}),
          ...(shippedTo ? { lte: new Date(shippedTo) } : {}),
        },
      },
    }
  }

  // 입고일 기간 필터 (2026-09-16) — 라인 receivedAt 또는 접수 헤더 receivedAt(최초 입고처리일) 중 하나가 범위 안이면 포함 (목록 입고일 열과 같은 소스)
  const receivedFrom = sp.get('receivedFrom')
  const receivedTo = sp.get('receivedTo')
  if (receivedFrom || receivedTo) {
    const range = { ...(receivedFrom ? { gte: new Date(receivedFrom) } : {}), ...(receivedTo ? { lte: new Date(receivedTo) } : {}) }
    where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { OR: [{ receivedAt: range }, { items: { some: { receivedAt: range } } }] }]
  }

  const q = sp.get('q')?.trim()
  const searchOr = q ? await buildAsReceiptSearchOr(q, parseAsSearchField(sp.get('field'))) : null // 항목(field)·쉼표 복수 키워드 — lib/asReceiptSearch 단일 소스 (2026-09-18)
  if (searchOr) where.OR = searchOr

  const page = Math.max(1, parseInt(sp.get('page') ?? '1') || 1)
  const pageSize = Math.min(100, Math.max(10, parseInt(sp.get('pageSize') ?? '30') || 30))

  // 정렬 (2026-09-16) — ?sort=<key>&dir=asc|desc. 기본 등록 최신순. 입고일·발송일은 라인 집계(최신 라인 날짜, 입고일은 헤더 폴백)라 Prisma orderBy 불가 → id 전량 조회 후 JS 정렬·페이지 슬라이스
  const sortKey = sp.get('sort') ?? ''
  const dir: 'asc' | 'desc' = sp.get('dir') === 'desc' ? 'desc' : 'asc'
  const SCALAR_SORT: Record<string, Prisma.AsReceiptOrderByWithRelationInput[]> = {
    asCode: [{ asCode: dir }],
    hospital: [{ hospital: { hospitalName: dir } }, { id: 'desc' }],
    category: [{ category: dir }, { id: 'desc' }],
    status: [{ status: { order: dir } }, { id: 'desc' }],
    receiptDate: [{ receiptDate: dir }, { id: dir }],
  }
  const AGG_SORT = ['receivedAt', 'shippedAt']

  const total = await prisma.asReceipt.count({ where })
  let receipts: Prisma.AsReceiptGetPayload<{ include: typeof listInclude }>[]
  if (AGG_SORT.includes(sortKey)) {
    const all = await prisma.asReceipt.findMany({
      where,
      select: { id: true, receivedAt: true, items: { select: { receivedAt: true, shippedAt: true } } },
    })
    const keyOf = (r: (typeof all)[number]) => {
      const lineDates = r.items.map((i) => (sortKey === 'receivedAt' ? i.receivedAt : i.shippedAt)).filter((d): d is Date => !!d).map((d) => d.getTime())
      if (lineDates.length) return Math.max(...lineDates)
      return sortKey === 'receivedAt' && r.receivedAt ? r.receivedAt.getTime() : null
    }
    const keyed = all.map((r) => ({ id: r.id, k: keyOf(r) }))
    keyed.sort((a, b) => {
      if (a.k === null && b.k === null) return b.id - a.id
      if (a.k === null) return 1 // 빈 값은 방향과 무관하게 뒤로
      if (b.k === null) return -1
      const c = a.k - b.k
      return (dir === 'asc' ? c : -c) || b.id - a.id
    })
    const pageIds = keyed.slice((page - 1) * pageSize, page * pageSize).map((x) => x.id)
    const fetched = await prisma.asReceipt.findMany({ where: { id: { in: pageIds } }, include: listInclude })
    const byId = new Map(fetched.map((r) => [r.id, r]))
    receipts = pageIds.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r)
  } else {
    receipts = await prisma.asReceipt.findMany({
      where,
      include: listInclude,
      orderBy: SCALAR_SORT[sortKey] ?? [{ createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
  }

  // 원장 정합 태그 (2026-09-10) — 페이지 내 미종결 라인 시리얼의 현재 배치를 1회 조회해 접수 단위로 집계
  const openSerials = Array.from(new Set(receipts.flatMap((r) => r.items.filter((i) => !i.outcome).map((i) => i.serialNo))))
  const units = openSerials.length
    ? await prisma.deviceUnit.findMany({
        where: { serialNo: { in: openSerials } },
        select: { serialNo: true, placement: { select: { status: true, hospitalCode: true, hospital: { select: { hospitalName: true } } } } },
      })
    : []
  const unitBySerial = new Map(units.map((u) => [u.serialNo, {
    placement: u.placement ? { status: u.placement.status, hospitalCode: u.placement.hospitalCode, hospitalName: u.placement.hospital?.hospitalName ?? null } : null,
  }]))
  const openBySerial = await findOpenLinesBySerial(openSerials) // 중복접수 대조 (2026-09-18)
  const withTags = receipts.map((r) => ({
    ...r,
    registryTags: summarizeAsRegistryTags(r.hospitalCode, r.items, unitBySerial, duplicatesForReceipt(r.id, r.items.filter((i) => !i.outcome).map((i) => i.serialNo), openBySerial)),
    intakeIssues: r.items.filter((i) => !i.outcome && isAsIntakeIssue(i.intakeState)).length, // 입고 대조 미입고·미식별입고 라인 수 (2026-09-11)
  }))

  return NextResponse.json({ receipts: withTags, total, page, pageSize })
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
        priorityRepair: body.priorityRepair === true, // 태그 (2026-09-15)
        firmwareUpdate: body.firmwareUpdate === true,
        accessoryIncluded: body.accessoryIncluded === true,
        statusId,
        note: typeof body.note === 'string' ? body.note : null,
        lines: parseLines(body),
      },
      { userId: user.userId, name: user.name }
    )
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    const r = toRegistryErrorResponse(e) // RegistryTxAbort(AS 표시 암묵 전이의 유닛 가드 실패 — 2026-09-17) → 409. RegistryError는 openAsFlags가 경고로 흡수
    if (r) return NextResponse.json(r.body, { status: r.status })
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
