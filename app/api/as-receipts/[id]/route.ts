import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser, isUserOrAbove } from '@/lib/auth'
import { hasPermission } from '@/lib/appRoles'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { canEditAsReceipt, canDeleteAsReceipt, asStatusChangeData } from '@/lib/asReceipt'
import { AS_PICKUP_METHODS, AS_CATEGORIES, AS_DEST_TYPES, classifyAsRegistryLine } from '@/lib/asReceiptShared'
import { findOpenLinesBySerial, duplicatesForReceipt, syncCombinedPackByTracking } from '@/lib/asReceiptSearch'
import { applyItemChanges, setUnitInUse, AsServiceError, type LineInput } from '@/lib/asReceiptService'
import { syncAsReceiptToTicket } from '@/lib/ticket-domains/asReceipt'
import { toRegistryErrorResponse } from '@/lib/deviceRegistry'
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
      symptom: true, processNote: true, outcome: true, newSerialNo: true, draftOutcome: true, draftNewSerialNo: true, // 초안 (2026-09-14)
      shipMethod: true, shipTrackingNo: true, shippedAt: true,
      intakeState: true, receivedAt: true, receiptSerialNo: true, intakeSource: true, // 입고 대조 (2026-09-11)
      repairedAt: true, repairedBy: { select: { id: true, name: true } }, // 수리완료 체크 (2026-09-17 — 제3축)
      device: {
        select: {
          id: true,
          condition: true, locationHospitalCode: true, locationSite: { select: { value: true } }, locationHospital: { select: { hospitalName: true } }, // 기기 상태·위치 축 (2026-09-17) → 응답 `device.unit`으로 정형화
          deviceInfo: { select: { deviceName: true } },
          placement: { select: { status: true, hospitalCode: true, asStartedOn: true, asRefCode: true, ward: { select: { name: true } } } },
        },
      },
      newDevice: { select: { id: true, serialNo: true } },
    },
    orderBy: { id: 'asc' as const },
  },
} as const

type DetailReceipt = NonNullable<Prisma.Result<typeof prisma.asReceipt, { include: typeof detailInclude }, 'findUnique'>>

/**
 * 상세 응답 라인 정형화 (2026-09-17) — `device.unit { condition, locationSiteValue, locationHospitalCode, locationHospitalName }`(설계 §7.1 계약 + 병원명 표시용).
 * 유닛 형상 체인(§5.1)에 맞춰 select에서 빠지면 UI가 조용히 '미확인'으로 보이므로 이 한 곳에서 조립한다.
 */
function shapeDetailItems(items: DetailReceipt['items']) {
  return items.map((i) => ({
    ...i,
    device: i.device
      ? { ...i.device, unit: { condition: i.device.condition, locationSiteValue: i.device.locationSite?.value ?? null, locationHospitalCode: i.device.locationHospitalCode, locationHospitalName: i.device.locationHospital?.hospitalName ?? null } }
      : i.device,
  }))
}

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const asReceipt = await prisma.asReceipt.findUnique({ where: { id }, include: detailInclude })
  if (!asReceipt) return NextResponse.json({ error: 'AS접수를 찾을 수 없습니다.' }, { status: 404 })

  // 라인별 원장 정합 태그 (2026-09-10) — 미종결 라인의 시리얼로 현재 배치를 실시간 대조(등록 시 deviceId 스냅샷과 무관)
  const openSerials = asReceipt.items.filter((i) => !i.outcome).map((i) => i.serialNo)
  const units = openSerials.length
    ? await prisma.deviceUnit.findMany({
        where: { serialNo: { in: openSerials } },
        select: { serialNo: true, placement: { select: { status: true, hospitalCode: true, hospital: { select: { hospitalName: true } } } } },
      })
    : []
  const unitBySerial = new Map(units.map((u) => [u.serialNo, {
    placement: u.placement ? { status: u.placement.status, hospitalCode: u.placement.hospitalCode, hospitalName: u.placement.hospital?.hospitalName ?? null } : null,
  }]))
  const dupBySerial = duplicatesForReceipt(asReceipt.id, openSerials, await findOpenLinesBySerial(openSerials)) // 중복접수 (2026-09-18)
  const items = shapeDetailItems(asReceipt.items).map((i) => ({
    ...i,
    registryTag: i.outcome ? null : classifyAsRegistryLine(asReceipt.hospitalCode, unitBySerial.get(i.serialNo)),
    duplicateOf: i.outcome ? [] : (dupBySerial.get(i.serialNo) ?? []), // 같은 시리얼 미종결 라인을 가진 다른 접수번호
  }))

  return NextResponse.json({ asReceipt: { ...asReceipt, items } })
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

  // ADMIN 이상 또는 (USER 이상 + as_receipt.admin 권한) — RBAC v1.5 가산, VIEWER 제외
  const adminPerm = isUserOrAbove(user.role) && (await hasPermission(user, 'as_receipt.admin'))
  if (!canEditAsReceipt(user, existing, adminPerm)) {
    return NextResponse.json({ error: '수정 권한이 없습니다. 본인 등록 건은 완료·취소 전까지만 수정할 수 있습니다.' }, { status: 403 })
  }

  const body = await request.json()
  const data: Prisma.AsReceiptUncheckedUpdateInput = {}
  let items: LineInput[] | null = null
  let autoPickup = false // 수거 송장 기입 → '수거중' 자동 전이 여부 (응답·경고용)

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
      if (body.pickupMethod && !(AS_PICKUP_METHODS as readonly string[]).includes(body.pickupMethod)) throw new AsServiceError(400, '수거방법이 올바르지 않습니다.')
      data.pickupMethod = body.pickupMethod || null
    }
    if (body.destType !== undefined) {
      if (body.destType && !(AS_DEST_TYPES as readonly string[]).includes(body.destType)) throw new AsServiceError(400, '발송지 구분이 올바르지 않습니다.')
      data.destType = body.destType || null
    }
    data.reporterName = strOrNull(body.reporterName)
    data.pickupTrackingNo = strOrNull(body.pickupTrackingNo)
    data.destInfo = strOrNull(body.destInfo)
    if (body.pickupDestDiffers !== undefined) data.pickupDestDiffers = body.pickupDestDiffers === true
    data.pickupDestInfo = strOrNull(body.pickupDestInfo)
    data.note = strOrNull(body.note)
    data.pickedUpAt = dateOrNull(body.pickedUpAt)
    data.receivedAt = dateOrNull(body.receivedAt)
    data.expectedShipDate = dateOrNull(body.expectedShipDate)
    if (body.preReplace !== undefined) data.preReplace = body.preReplace === true
    // 태그 (2026-09-15)
    if (body.priorityRepair !== undefined) data.priorityRepair = body.priorityRepair === true
    if (body.firmwareUpdate !== undefined) data.firmwareUpdate = body.firmwareUpdate === true
    if (body.accessoryIncluded !== undefined) data.accessoryIncluded = body.accessoryIncluded === true
    if (body.combinedPack !== undefined) data.combinedPack = body.combinedPack === true // 합포장 (2026-09-19)
    // 병원 변경 (2026-09-10 — 시트 인입 오매칭 보정용). 미종결 라인은 새 병원 기준 재매칭·AS 표시 이전, 티켓 병원은 어댑터 동기화
    if (typeof body.hospitalCode === 'string' && body.hospitalCode.trim() && body.hospitalCode.trim() !== existing.hospitalCode) {
      const code = body.hospitalCode.trim()
      const h = await prisma.hospital.findUnique({ where: { hospitalCode: code }, select: { hospitalCode: true } })
      if (!h) throw new AsServiceError(400, '병원을 찾을 수 없습니다.')
      data.hospitalCode = code
    }

    // 수거 송장번호 최초 기입 → 상태 '수거중' 자동 (2026-09-15 사용자 요청). 명시 statusId가 오면 그쪽 우선. '접수'보다 뒤 단계면 유지
    if (body.statusId === undefined && data.pickupTrackingNo && !existing.pickupTrackingNo) {
      const [pickup, cur] = await Promise.all([
        prisma.statusCode.findFirst({ where: { category: 'AS_STATUS', name: '수거중' }, select: { id: true, order: true } }),
        existing.statusId ? prisma.statusCode.findUnique({ where: { id: existing.statusId }, select: { order: true } }) : Promise.resolve(null),
      ])
      if (pickup && existing.statusId !== pickup.id && (cur?.order ?? 0) < pickup.order) {
        data.statusId = pickup.id
        data.statusChangedAt = new Date()
        autoPickup = true
      }
    }
    if (body.statusId !== undefined) {
      const sid = Number(body.statusId)
      const row = Number.isInteger(sid)
        ? await prisma.statusCode.findFirst({ where: { id: sid, category: 'AS_STATUS' }, select: { id: true, ticketStatus: true } })
        : null
      if (!row) throw new AsServiceError(400, '상태가 올바르지 않습니다.')
      data.statusId = row.id
      Object.assign(data, asStatusChangeData(existing, row, todayKst())) // statusChangedAt·완료일 자동 관리 — 일괄 상태변경과 공용 (2026-09-21)
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
        // 병원이 바뀌었는데 라인이 안 왔으면 기존 라인 그대로 재매칭
        const lines = items ?? (data.hospitalCode
          ? (await tx.asReceiptItem.findMany({ where: { receiptId: id }, orderBy: { id: 'asc' } })).map((i) => ({ serial: i.serialNo }))
          : null)
        const w = lines ? await applyItemChanges(tx, updated, lines, { userId: user.userId, name: user.name }, { previousHospitalCode: existing.hospitalCode }) : []
        await syncAsReceiptToTicket(tx, id, user.userId)
        return w
      },
      { timeout: 60000, maxWait: 10000 }
    )
  } catch (e) {
    if (e instanceof AsServiceError) return NextResponse.json({ error: e.message }, { status: e.status })
    const r = toRegistryErrorResponse(e) // RegistryError·RegistryTxAbort(2026-09-17) 공통 — 본문 { error, … }
    if (r) return NextResponse.json(r.body, { status: r.status })
    throw e
  }

  // 합포장 자동 태그 (2026-09-19): 수거 송장번호가 기입·변경됐고 같은 번호(영숫자 정규화)의 다른 접수가 있으면 양쪽 모두 켬 (끄지는 않음 — 수동 해제 존중)
  if (data.pickupTrackingNo && data.pickupTrackingNo !== existing.pickupTrackingNo) {
    warnings.push(...(await syncCombinedPackByTracking(id, data.pickupTrackingNo).catch((e) => { console.warn('[as] 합포장 자동 태그 실패:', e); return [] as string[] })))
  }

  const updatedRow = await prisma.asReceipt.findUnique({ where: { id }, include: detailInclude })
  const asReceipt = updatedRow ? { ...updatedRow, items: shapeDetailItems(updatedRow.items) } : null

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

  return NextResponse.json({ asReceipt, warnings: autoPickup ? ["수거 송장번호 기입 → 상태 '수거중'으로 자동 변경", ...warnings] : warnings, autoPickup })
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

  // ADMIN 이상 또는 (USER 이상 + as_receipt.admin 권한) — RBAC v1.5 가산, VIEWER 제외
  const adminPerm = isUserOrAbove(user.role) && (await hasPermission(user, 'as_receipt.admin'))
  if (!canDeleteAsReceipt(user, existing, adminPerm)) {
    return NextResponse.json({ error: '삭제 권한이 없습니다. 본인 등록 건은 완료·취소 전까지만 삭제할 수 있습니다.' }, { status: 403 })
  }

  // 미종결 라인 기기 IN_USE·병원 복귀(best-effort — 게이트·플래그 소유 판정은 setUnitInUse, 이 접수가 켠 플래그는 AS_CLEAR·아니면 CORRECT 폴백) 후 삭제 — 기록된 이벤트는 보존 (§5)
  // CORRECT 폴백의 ref { AS, asCode }는 삭제 전 삽입이라 validateRef 통과 — 삭제 후 소프트 참조로 잔존 (2026-09-17 §7.3)
  let warnings: string[] = []
  try {
    warnings = await prisma.$transaction(
      async (tx) => {
        const today = todayKst()
        const out: string[] = []
        for (const item of existing.items) {
          if (!item.deviceId || item.outcome) continue
          out.push(...(await setUnitInUse(
            tx,
            { hospitalCode: existing.hospitalCode, actor: { userId: user.userId, name: user.name }, occurredOn: today, source: 'MANUAL', ref: { type: 'AS', code: existing.asCode } },
            item.deviceId,
            { locationToHospital: true, memo: `접수 삭제 ${existing.asCode}` }
          )))
        }
        await tx.asReceipt.delete({ where: { id } }) // 라인은 FK CASCADE
        return out
      },
      { timeout: 60000, maxWait: 10000 }
    )
  } catch (e) {
    const r = toRegistryErrorResponse(e) // RegistryTxAbort(유닛 가드 실패 — tx 전체 롤백) → 409. RegistryError는 setUnitInUse가 경고로 흡수
    if (r) return NextResponse.json(r.body, { status: r.status })
    throw e
  }

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
    after: warnings.length ? { warnings } : undefined,
  })

  return NextResponse.json({ success: true, warnings })
}
