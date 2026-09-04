import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { canEditAsReceipt } from '@/lib/asReceipt'
import { AS_CATEGORIES, AS_METHODS, AS_DEST_TYPES } from '@/lib/asReceiptShared'
import { applyItemChanges, AsServiceError, type LineInput } from '@/lib/asReceiptService'
import { syncAsReceiptToTicket } from '@/lib/ticket-domains/asReceipt'
import { clearDeviceAs, RegistryError } from '@/lib/deviceRegistry'
import { todayKst } from '@/lib/deviceRegistryShared'
import { notifyTicketChanged } from '@/lib/notify'
import { syncTicketClocksSafe } from '@/lib/sla'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * AS접수 상세/수정/삭제 (as_work_design.md §7)
 * 수정·삭제 권한: ADMIN 이상 항상 / USER는 본인 등록 + 종결(완료·취소) 전 (§13-1)
 */

const detailInclude = {
  hospital: { select: { hospitalCode: true, hospitalName: true } },
  status: { select: { id: true, name: true, color: true, ticketStatus: true } },
  createdBy: { select: { id: true, name: true } },
  ticket: { select: { id: true, ticketCode: true, status: true, owner: { select: { id: true, name: true } } } },
  items: {
    select: {
      id: true, serialNo: true, deviceId: true, newDeviceId: true, deviceKind: true, wardName: true,
      symptom: true, processNote: true, outcome: true, newSerialNo: true,
      shipMethod: true, shipTrackingNo: true, shippedAt: true,
      device: {
        select: {
          id: true,
          deviceInfo: { select: { deviceName: true } },
          placement: { select: { status: true, hospitalCode: true, asStartedOn: true, asRefCode: true, ward: { select: { name: true } } } },
        },
      },
      newDevice: { select: { id: true, serialNo: true } },
    },
    orderBy: { id: 'asc' as const },
  },
} as const

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const asReceipt = await prisma.asReceipt.findUnique({ where: { id }, include: detailInclude })
  if (!asReceipt) return NextResponse.json({ error: 'AS접수를 찾을 수 없습니다.' }, { status: 404 })

  return NextResponse.json({ asReceipt })
}

/** YYYY-MM-DD | '' | null → Date | null (undefined = 미변경) */
function dateOrNull(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const d = new Date(String(v))
  if (isNaN(d.getTime())) throw new AsServiceError(400, '날짜가 올바르지 않습니다.')
  return d
}

const strOrNull = (v: unknown): string | null | undefined =>
  v === undefined ? undefined : typeof v === 'string' && v.trim() ? v.trim() : null

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const existing = await prisma.asReceipt.findUnique({
    where: { id },
    include: { status: { select: { id: true, name: true, ticketStatus: true } } },
  })
  if (!existing) return NextResponse.json({ error: 'AS접수를 찾을 수 없습니다.' }, { status: 404 })

  if (!canEditAsReceipt(user, existing)) {
    return NextResponse.json({ error: '수정 권한이 없습니다. 본인 등록 건은 완료·취소 전까지만 수정할 수 있습니다.' }, { status: 403 })
  }

  const body = await request.json()
  const data: Prisma.AsReceiptUncheckedUpdateInput = {}
  let items: LineInput[] | null = null

  try {
    if (body.category !== undefined) {
      if (!(AS_CATEGORIES as readonly string[]).includes(body.category)) throw new AsServiceError(400, '구분이 올바르지 않습니다.')
      data.category = body.category
    }
    if (body.receiptDate !== undefined) {
      const d = dateOrNull(body.receiptDate)
      if (!d) throw new AsServiceError(400, '접수일을 입력하세요.')
      data.receiptDate = d
    }
    if (body.pickupMethod !== undefined) {
      if (body.pickupMethod && !(AS_METHODS as readonly string[]).includes(body.pickupMethod)) throw new AsServiceError(400, '수거방법이 올바르지 않습니다.')
      data.pickupMethod = body.pickupMethod || null
    }
    if (body.destType !== undefined) {
      if (body.destType && !(AS_DEST_TYPES as readonly string[]).includes(body.destType)) throw new AsServiceError(400, '발송지 구분이 올바르지 않습니다.')
      data.destType = body.destType || null
    }
    data.reporterName = strOrNull(body.reporterName)
    data.pickupTrackingNo = strOrNull(body.pickupTrackingNo)
    data.destInfo = strOrNull(body.destInfo)
    data.note = strOrNull(body.note)
    data.pickedUpAt = dateOrNull(body.pickedUpAt)
    data.receivedAt = dateOrNull(body.receivedAt)
    data.expectedShipDate = dateOrNull(body.expectedShipDate)
    if (body.preReplace !== undefined) data.preReplace = body.preReplace === true

    if (body.statusId !== undefined) {
      const sid = Number(body.statusId)
      const row = Number.isInteger(sid)
        ? await prisma.statusCode.findFirst({ where: { id: sid, category: 'AS_STATUS' }, select: { id: true, ticketStatus: true } })
        : null
      if (!row) throw new AsServiceError(400, '상태가 올바르지 않습니다.')
      data.statusId = row.id
      if (row.id !== existing.statusId) {
        data.statusChangedAt = new Date()
        // 완료일 자동 관리 — 종결 버킷(완료·취소 → CLOSED 매핑) 진입 시 기록, 이탈 시 해제
        const terminal = row.ticketStatus === 'RESOLVED' || row.ticketStatus === 'CLOSED'
        if (terminal && !existing.resolvedAt) data.resolvedAt = new Date()
        if (!terminal && existing.resolvedAt) data.resolvedAt = null
      }
    }
    if (body.items !== undefined) {
      if (!Array.isArray(body.items)) throw new AsServiceError(400, '기기 라인 형식이 올바르지 않습니다.')
      items = (body.items as Record<string, unknown>[]).map((row) => ({
        serial: String(row.serial ?? ''),
        symptom: row.symptom === undefined ? undefined : typeof row.symptom === 'string' ? row.symptom : null,
        wardName: row.wardName === undefined ? undefined : typeof row.wardName === 'string' ? row.wardName : null,
        deviceKind: row.deviceKind === undefined ? undefined : typeof row.deviceKind === 'string' ? row.deviceKind : null,
        processNote: row.processNote === undefined ? undefined : typeof row.processNote === 'string' ? row.processNote : null,
      }))
    }
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }

  // 갱신 + 라인 반영 + 티켓 동기화(어댑터 경유 — 규칙 3)를 한 트랜잭션으로
  let warnings: string[] = []
  try {
    warnings = await prisma.$transaction(
      async (tx) => {
        const updated = await tx.asReceipt.update({ where: { id }, data, select: { id: true, asCode: true, hospitalCode: true, receiptDate: true } })
        const w = items ? await applyItemChanges(tx, updated, items, { userId: user.userId, name: user.name }) : []
        await syncAsReceiptToTicket(tx, id, user.userId)
        return w
      },
      { timeout: 60000, maxWait: 10000 }
    )
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof RegistryError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }

  const asReceipt = await prisma.asReceipt.findUnique({ where: { id }, include: detailInclude })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'as_receipt',
    resourceId: existing.asCode,
    resourceLabel: `${existing.asCode}`,
    before: existing,
    after: asReceipt,
  })

  if (existing.ticketId) {
    syncTicketClocksSafe(existing.ticketId)
    notifyTicketChanged({ ticketId: existing.ticketId, actorName: user.name, actorId: user.userId }).catch(() => {})
  }

  return NextResponse.json({ asReceipt, warnings })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const existing = await prisma.asReceipt.findUnique({
    where: { id },
    include: {
      status: { select: { id: true, name: true, ticketStatus: true } },
      items: { select: { id: true, serialNo: true, deviceId: true, outcome: true } },
    },
  })
  if (!existing) return NextResponse.json({ error: 'AS접수를 찾을 수 없습니다.' }, { status: 404 })

  if (!canEditAsReceipt(user, existing)) {
    return NextResponse.json({ error: '삭제 권한이 없습니다. 본인 등록 건은 완료·취소 전까지만 삭제할 수 있습니다.' }, { status: 403 })
  }

  // 이 접수가 켠 AS 표시 해제(best-effort) 후 삭제 — 기록된 이벤트는 보존 (§5)
  await prisma.$transaction(
    async (tx) => {
      const today = todayKst()
      for (const item of existing.items) {
        if (!item.deviceId || item.outcome) continue
        const placement = await tx.hospitalDevice.findUnique({
          where: { deviceId: item.deviceId },
          select: { asStartedOn: true, asRefCode: true },
        })
        if (placement?.asStartedOn && placement.asRefCode === existing.asCode) {
          try {
            await clearDeviceAs(
              {
                hospitalCode: existing.hospitalCode,
                actor: { userId: user.userId, name: user.name },
                occurredOn: today,
                source: 'MANUAL',
                memo: `${existing.asCode} 접수 삭제`,
              },
              { deviceId: item.deviceId },
              { client: tx }
            )
          } catch (e) {
            if (!(e instanceof RegistryError)) throw e
          }
        }
      }
      await tx.asReceipt.delete({ where: { id } }) // 라인은 FK CASCADE
    },
    { timeout: 60000, maxWait: 10000 }
  )

  // 연결 티켓도 삭제 (도메인과 생명주기 공유 — 유지보수 P5·VOC 선례)
  if (existing.ticketId) {
    await prisma.ticket.delete({ where: { id: existing.ticketId } }).catch(() => {})
  }

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'as_receipt',
    resourceId: existing.asCode,
    resourceLabel: `${existing.asCode}`,
    before: existing,
  })

  return NextResponse.json({ success: true })
}
