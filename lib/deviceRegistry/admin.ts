/**
 * 정정·취소(admin) — "사실은 이벤트로, 실수는 취소로" (§8.2)
 *
 * - editEvent          : 인플레이스 UPDATE(허용 필드만) + edited_* + fold 재검증(불성립 409)
 * - cancelLastEvent    : LIFO 물리 DELETE(CORRECT 제외 판정) — 교체·이관 그룹은 짝 동시 취소, 임포트 행은 배치 카운트 감소
 * - cancelImportBatch  : 배치 밖 상태 이벤트가 있으면 409, 아니면 이벤트→배치 행 DELETE·재등록 RECOVERED 복원·이관 원복
 * 3층 구조: 취소로 이벤트가 0건이 되면 **배치 행(`hospital_devices`)만 삭제**하고 유닛(`device_units`)은 남긴다(시리얼 정체성은 자동 삭제하지 않음).
 * `deletedDeviceIds`는 배치 행이 사라진 유닛 id 목록이다.
 * - editImportBatchDate: 배치 이벤트 occurred_on 일괄 UPDATE + 각 개체 fold 재검증
 * 서비스는 logAudit을 부르지 않는다 — 반환값의 before 스냅샷을 라우트가 기록한다.
 */
import { Prisma } from '@prisma/client'
import { RECOVERY_REASON_CATEGORY } from '@/lib/deviceRegistryShared'
import {
  RegistryError,
  eventLabel,
  getDeviceOr404,
  loadDeviceEvents,
  loadDevices,
  loadUnits,
  mapDbError,
  rebuildOrDelete,
  rebuildUnitProjection,
  requireOccurredOn,
  sortEvents,
  validateRef,
  withRegistryTx,
  ymd,
  ymdToDate,
  type DbClient,
  type DeviceRow,
  type EventRow,
  type RegistryCtx,
  type RegistryOpts,
  type RegistryRef,
} from './core'
import type { ChangeSet } from './write'

// ─────────────────────────────────────────────────────────────────────────────
// editEvent
// ─────────────────────────────────────────────────────────────────────────────

export interface EventPatch {
  occurredOn?: string
  memo?: string | null
  reasonCodeId?: number
  ref?: RegistryRef | null
  toWardId?: number | null
  fromWardId?: number | null
}

const EVENT_PATCH_KEYS = new Set(['occurredOn', 'memo', 'reasonCodeId', 'ref', 'toWardId', 'fromWardId'])

export interface EditEventResult {
  before: EventRow
  after: EventRow
  device: DeviceRow
}

export async function editEvent(ctx: RegistryCtx, input: { eventId: number; patch: EventPatch }, opts?: RegistryOpts): Promise<EditEventResult> {
  return withRegistryTx(opts, async (tx) => {
    const ev = await tx.hospitalDeviceEvent.findUnique({ where: { id: Number(input.eventId) } })
    if (!ev) throw new RegistryError(404, '이벤트를 찾을 수 없습니다')
    const patch = input.patch ?? {}
    const unknown = Object.keys(patch).filter((k) => !EVENT_PATCH_KEYS.has(k))
    if (unknown.length > 0) throw new RegistryError(400, `정정할 수 없는 필드입니다: ${unknown.join(', ')} — 취소 후 재입력하세요`)

    const data: Prisma.HospitalDeviceEventUncheckedUpdateInput = {}
    if (patch.occurredOn !== undefined) {
      const v = requireOccurredOn(patch.occurredOn)
      if (v !== ymd(ev.occurredOn)) data.occurredOn = ymdToDate(v)
    }
    if (patch.memo !== undefined) {
      const v = patch.memo != null && String(patch.memo).trim() ? String(patch.memo).trim() : null
      if (v !== (ev.memo ?? null)) data.memo = v
    }
    if (patch.reasonCodeId !== undefined) {
      if (ev.eventType !== 'RECOVER') throw new RegistryError(400, '회수 사유는 RECOVER 이벤트에서만 정정할 수 있습니다')
      const r = await tx.statusCode.findFirst({ where: { id: Number(patch.reasonCodeId), category: RECOVERY_REASON_CATEGORY }, select: { id: true } })
      if (!r) throw new RegistryError(400, '회수 사유가 올바르지 않습니다')
      if (r.id !== ev.reasonCodeId) data.reasonCodeId = r.id
    }
    if (patch.ref !== undefined) {
      const { ref } = await validateRef(tx, patch.ref, ev.hospitalCode)
      if ((ref?.type ?? null) !== ev.refType || (ref?.code ?? null) !== ev.refCode) {
        data.refType = ref?.type ?? null
        data.refCode = ref?.code ?? null
      }
    }
    if (patch.toWardId !== undefined) {
      if (ev.eventType !== 'REGISTER' && ev.eventType !== 'MOVE_WARD') throw new RegistryError(400, '도착 병동은 REGISTER/MOVE_WARD 이벤트에서만 정정할 수 있습니다')
      const v = patch.toWardId == null ? null : Number(patch.toWardId)
      if (v == null && ev.eventType === 'MOVE_WARD') throw new RegistryError(400, '병동 이동의 도착 병동은 비울 수 없습니다')
      if (v != null) {
        const w = await tx.hospitalWard.findFirst({ where: { id: v, hospitalCode: ev.hospitalCode ?? '' }, select: { id: true } })
        if (!w) throw new RegistryError(404, '병동을 찾을 수 없습니다 (이 병원 소속이 아님)')
        if (ev.eventType === 'MOVE_WARD' && v === ev.fromWardId) throw new RegistryError(400, '출발 병동과 도착 병동이 같습니다')
      }
      if (v !== ev.toWardId) data.toWardId = v
    }
    if (patch.fromWardId !== undefined) {
      if (ev.eventType !== 'RECOVER') throw new RegistryError(400, '출발 병동은 RECOVER 이벤트에서만 정정할 수 있습니다')
      const v = patch.fromWardId == null ? null : Number(patch.fromWardId)
      if (v != null) {
        const w = await tx.hospitalWard.findFirst({ where: { id: v, hospitalCode: ev.hospitalCode ?? '' }, select: { id: true } })
        if (!w) throw new RegistryError(404, '병동을 찾을 수 없습니다 (이 병원 소속이 아님)')
      }
      if (v !== ev.fromWardId) data.fromWardId = v
    }
    if (Object.keys(data).length === 0) throw new RegistryError(400, '변경 사항이 없습니다')

    const after = await tx.hospitalDeviceEvent.update({
      where: { id: ev.id },
      data: { ...data, editedAt: new Date(), editedById: ctx.actor?.userId ?? null },
    })
    await rebuildUnitProjection(tx, ev.deviceId, {
      illegal: (bad) => new RegistryError(409, `정정하면 이벤트 순서가 성립하지 않습니다 — ${eventLabel(bad)}`),
    })
    return { before: ev, after, device: await getDeviceOr404(tx, ev.deviceId) }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// cancelLastEvent — LIFO 취소 (그룹 짝·임포트 행·CORRECT)
// ─────────────────────────────────────────────────────────────────────────────

export interface CancelEventResult {
  /** 삭제된 이벤트 스냅샷(audit before 전문) */
  cancelledEvents: EventRow[]
  cancelledEventIds: number[]
  deletedDeviceIds: number[]
  /** 재계산되어 남은 개체 */
  restoredDevices: { id: number; serialNo: string; status: string; hospitalCode: string | null }[]
  affectedDeviceIds: number[]
  batchAdjustments: { batchId: number; serialNo: string; kind: 'new' | 'reregister' | 'transfer' }[]
  /** CORRECT 취소 시 복원한 값 */
  restored?: ChangeSet
}

/** CORRECT 복원 대상 — 유닛 컬럼(시리얼·원문·모델·MAC·용도) / 배치 컬럼(닉네임·상품유형·계약건) */
const CORRECT_UNIT_FIELDS = new Set(['serialNo', 'serialRaw', 'deviceInfoId', 'macAddress', 'usageTypeId'])
const CORRECT_PLACEMENT_FIELDS = new Set(['extDeviceCode', 'productType', 'dealCode'])

async function cancelCorrectEvent(tx: DbClient, ev: EventRow): Promise<CancelEventResult> {
  const device = await getDeviceOr404(tx, ev.deviceId)
  const later = await tx.hospitalDeviceEvent.findFirst({ where: { deviceId: ev.deviceId, eventType: 'CORRECT', id: { gt: ev.id } }, select: { id: true } })
  if (later) throw new RegistryError(409, '이후 정정 이벤트가 있습니다 — 최근 정정부터 취소하세요')
  const changes = (ev.changes ?? {}) as ChangeSet
  const unitData: Record<string, unknown> = {}
  const placementData: Record<string, unknown> = {}
  const restored: ChangeSet = {}
  for (const [field, v] of Object.entries(changes)) {
    const isUnit = CORRECT_UNIT_FIELDS.has(field)
    if ((!isUnit && !CORRECT_PLACEMENT_FIELDS.has(field)) || !v || typeof v !== 'object') continue
    const before = (v as { before: unknown }).before
    restored[field] = { before: (device as unknown as Record<string, unknown>)[field], after: before }
    ;(isUnit ? unitData : placementData)[field] = before ?? null
  }
  if (unitData.serialNo !== undefined && unitData.serialNo !== device.serialNo) {
    const dup = await tx.deviceUnit.findUnique({ where: { serialNo: String(unitData.serialNo) }, select: { id: true } })
    if (dup && dup.id !== device.id) throw new RegistryError(409, `복원할 시리얼(${String(unitData.serialNo)})이 이미 다른 기기에 등록되어 있습니다`)
  }
  try {
    if (Object.keys(unitData).length > 0) await tx.deviceUnit.update({ where: { id: device.id }, data: unitData as Prisma.DeviceUnitUncheckedUpdateInput })
    if (Object.keys(placementData).length > 0) await tx.hospitalDevice.update({ where: { deviceId: device.id }, data: placementData as Prisma.HospitalDeviceUncheckedUpdateInput })
  } catch (e) {
    throw mapDbError(e)
  }
  await tx.hospitalDeviceEvent.delete({ where: { id: ev.id } })
  const updated = await getDeviceOr404(tx, device.id)
  return {
    cancelledEvents: [ev],
    cancelledEventIds: [ev.id],
    deletedDeviceIds: [],
    restoredDevices: [{ id: updated.id, serialNo: updated.serialNo, status: updated.status, hospitalCode: updated.hospitalCode }],
    affectedDeviceIds: [updated.id],
    batchAdjustments: [],
    restored,
  }
}

/**
 * 취소 대상 확장 — 같은 action_group에서 이 개체와 related_device_id로 얽힌 개체들의 상태 이벤트(교체·이관 짝, 소급 3건).
 * 일괄(bulk) 그룹은 related 링크가 없어 이 개체의 이벤트만 잡힌다.
 */
function expandCancelSet(anchor: EventRow, group: readonly EventRow[]): { deviceIds: Set<number>; toCancel: EventRow[] } {
  const deviceIds = new Set<number>([anchor.deviceId])
  let grew = true
  while (grew) {
    grew = false
    for (const e of group) {
      if (e.eventType === 'CORRECT') continue
      if (deviceIds.has(e.deviceId) && e.relatedDeviceId != null && !deviceIds.has(e.relatedDeviceId)) {
        deviceIds.add(e.relatedDeviceId)
        grew = true
      }
      if (e.relatedDeviceId != null && deviceIds.has(e.relatedDeviceId) && !deviceIds.has(e.deviceId)) {
        deviceIds.add(e.deviceId)
        grew = true
      }
    }
  }
  const toCancel = group.filter((e) => e.eventType !== 'CORRECT' && deviceIds.has(e.deviceId))
  return { deviceIds, toCancel }
}

/** 각 개체에서 취소 이벤트들이 상태 이벤트 열의 접미(suffix)인지 — 아니면 이후 이벤트가 있는 것 */
function assertSuffix(serialNo: string, stateEvents: readonly EventRow[], cancelIds: Set<number>, what: string) {
  const sorted = sortEvents(stateEvents)
  const first = sorted.findIndex((e) => cancelIds.has(e.id))
  if (first < 0) return
  for (let i = first; i < sorted.length; i++) {
    if (!cancelIds.has(sorted[i].id)) {
      throw new RegistryError(409, `${serialNo}: 이후 이벤트(${eventLabel(sorted[i])})가 있어 ${what}할 수 없습니다 — 최근 이벤트부터 취소하세요`)
    }
  }
}

export async function cancelLastEvent(ctx: RegistryCtx, input: { eventId: number }, opts?: RegistryOpts): Promise<CancelEventResult> {
  void ctx
  return withRegistryTx(opts, async (tx) => {
    const ev = await tx.hospitalDeviceEvent.findUnique({ where: { id: Number(input.eventId) } })
    if (!ev) throw new RegistryError(404, '이벤트를 찾을 수 없습니다')
    if (ev.eventType === 'CORRECT') return cancelCorrectEvent(tx, ev)

    const group = ev.actionGroup ? await tx.hospitalDeviceEvent.findMany({ where: { actionGroup: ev.actionGroup } }) : [ev]
    const { deviceIds, toCancel } = expandCancelSet(ev, group)
    const cancelIds = new Set(toCancel.map((e) => e.id))
    const deviceById = await loadDevices(tx, Array.from(deviceIds))
    const unitById = await loadUnits(tx, Array.from(deviceIds))
    const serialOf = (id: number) => deviceById.get(id)?.serialNo ?? unitById.get(id)?.serialNo ?? String(id)
    const eventsMap = await loadDeviceEvents(tx, Array.from(deviceIds))

    // LIFO — 개체별로 취소 이벤트가 접미여야 한다 (신 기기에 다른 이벤트가 있으면 409)
    for (const id of Array.from(deviceIds)) {
      if (!deviceById.has(id)) continue
      assertSuffix(serialOf(id), (eventsMap.get(id) ?? []).filter((e) => e.eventType !== 'CORRECT'), cancelIds, '취소')
    }

    // (3)(d) 시스템 짝 연결 해제 — 취소되는 REGISTER(신)의 related=구 → 구의 RECOVER.related_device_id=신 을 NULL
    for (const e of toCancel) {
      if (e.eventType === 'REGISTER' && e.relatedDeviceId != null) {
        await tx.hospitalDeviceEvent.updateMany({
          where: { deviceId: e.relatedDeviceId, eventType: 'RECOVER', relatedDeviceId: e.deviceId, id: { notIn: Array.from(cancelIds) } },
          data: { relatedDeviceId: null },
        })
        deviceIds.add(e.relatedDeviceId)
      }
    }

    await tx.hospitalDeviceEvent.deleteMany({ where: { id: { in: Array.from(cancelIds) } } })

    // 이벤트 0 유닛은 배치 행 삭제(유닛은 남김, FK SET NULL 반영) → 나머지 재계산
    const deletedDeviceIds: number[] = []
    const remaining: number[] = []
    for (const id of Array.from(deviceIds)) {
      if (!deviceById.has(id) && !(await tx.hospitalDevice.findUnique({ where: { deviceId: id }, select: { id: true } }))) continue
      const cnt = await tx.hospitalDeviceEvent.count({ where: { deviceId: id } })
      if (cnt === 0) {
        await tx.hospitalDevice.deleteMany({ where: { deviceId: id } })
        deletedDeviceIds.push(id)
      } else remaining.push(id)
    }
    const restoredDevices: CancelEventResult['restoredDevices'] = []
    for (const id of remaining) {
      const { state } = await rebuildUnitProjection(tx, id)
      restoredDevices.push({ id, serialNo: serialOf(id), status: state.status ?? 'ACTIVE', hospitalCode: state.hospitalCode })
    }

    // 임포트 행 단건 취소 — 배치 카운트 감소 + summary.cancelledRows (§8.2)
    const batchAdjustments: CancelEventResult['batchAdjustments'] = []
    const byBatch = new Map<number, EventRow[]>()
    for (const e of toCancel) if (e.importBatchId != null) (byBatch.get(e.importBatchId) ?? byBatch.set(e.importBatchId, []).get(e.importBatchId)!).push(e)
    for (const [batchId, evs] of Array.from(byBatch)) {
      const batch = await tx.hospitalDeviceImportBatch.findUnique({ where: { id: batchId } })
      if (!batch) continue
      const perDevice = new Map<number, EventRow[]>()
      for (const e of evs) (perDevice.get(e.deviceId) ?? perDevice.set(e.deviceId, []).get(e.deviceId)!).push(e)
      const dec = { registeredCount: 0, reregisteredCount: 0, transferredCount: 0 }
      const cancelledRows: unknown[] = []
      for (const [deviceId, des] of Array.from(perDevice)) {
        const serialNo = serialOf(deviceId)
        let kind: 'new' | 'reregister' | 'transfer'
        if (des.some((e) => e.eventType === 'RECOVER')) kind = 'transfer'
        else if (deletedDeviceIds.includes(deviceId)) kind = 'new'
        else kind = 'reregister'
        if (kind === 'transfer') dec.transferredCount += 1
        else if (kind === 'new') dec.registeredCount += 1
        else dec.reregisteredCount += 1
        batchAdjustments.push({ batchId, serialNo, kind })
        cancelledRows.push({ serialNo, kind, eventIds: des.map((e) => e.id), cancelledAt: new Date().toISOString(), by: ctx.actor?.name ?? null })
      }
      const summary = (batch.summary && typeof batch.summary === 'object' ? (batch.summary as Record<string, unknown>) : {}) as Record<string, unknown>
      const prev = Array.isArray(summary.cancelledRows) ? (summary.cancelledRows as unknown[]) : []
      await tx.hospitalDeviceImportBatch.update({
        where: { id: batchId },
        data: {
          registeredCount: Math.max(0, batch.registeredCount - dec.registeredCount),
          reregisteredCount: Math.max(0, batch.reregisteredCount - dec.reregisteredCount),
          transferredCount: Math.max(0, batch.transferredCount - dec.transferredCount),
          summary: { ...summary, cancelledRows: [...prev, ...cancelledRows] } as unknown as Prisma.InputJsonValue,
        },
      })
    }

    return {
      cancelledEvents: toCancel,
      cancelledEventIds: Array.from(cancelIds),
      deletedDeviceIds,
      restoredDevices,
      affectedDeviceIds: Array.from(deviceIds),
      batchAdjustments,
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// cancelImportBatch
// ─────────────────────────────────────────────────────────────────────────────

export interface CancelBatchSummary {
  serials: string[]
  restoredDeviceIds: number[]
  restoredTransfers: { deviceId: number; serialNo: string; hospitalCode: string | null }[]
  newWardsKept: unknown[]
  correctedSerials: string[]
  deletedDeviceIds: number[]
  eventCount: number
}

export interface CancelBatchResult {
  batch: Prisma.HospitalDeviceImportBatchGetPayload<Record<string, never>>
  summary: CancelBatchSummary
  /** audit before 전문 */
  cancelledEvents: EventRow[]
}

export async function cancelImportBatch(ctx: RegistryCtx, input: { batchId: number }, opts?: RegistryOpts): Promise<CancelBatchResult> {
  return withRegistryTx(opts, async (tx) => {
    const batch = await tx.hospitalDeviceImportBatch.findUnique({ where: { id: Number(input.batchId) } })
    if (!batch) throw new RegistryError(404, '임포트 배치를 찾을 수 없습니다')
    if (batch.cancelledAt) throw new RegistryError(409, '이미 취소된 배치입니다')
    const batchEvents = await tx.hospitalDeviceEvent.findMany({ where: { importBatchId: batch.id } })
    const batchIds = new Set(batchEvents.map((e) => e.id))
    const deviceIds = Array.from(new Set(batchEvents.map((e) => e.deviceId)))
    const deviceById = await loadDevices(tx, deviceIds)
    const eventsMap = await loadDeviceEvents(tx, deviceIds)

    // 차단: 배치 밖 상태 이벤트가 배치 이벤트 뒤에 있는 기기 (CORRECT·memo는 차단 사유 아님)
    const blockers: string[] = []
    for (const id of Array.from(deviceIds)) {
      const d = deviceById.get(id)!
      const sorted = sortEvents((eventsMap.get(id) ?? []).filter((e) => e.eventType !== 'CORRECT'))
      const first = sorted.findIndex((e) => batchIds.has(e.id))
      if (first < 0) continue
      const offender = sorted.slice(first).find((e) => !batchIds.has(e.id))
      if (offender) blockers.push(`${d.serialNo}(${eventLabel(offender)})`)
    }
    if (blockers.length > 0) {
      throw new RegistryError(
        409,
        `배치 밖 이벤트가 있는 기기 ${blockers.length}대 — ${blockers.slice(0, 10).join(' · ')}${blockers.length > 10 ? ' …' : ''} 해당 이벤트를 드로어에서 먼저 취소하면 배치를 취소할 수 있습니다`
      )
    }

    // 분류
    const summary: CancelBatchSummary = {
      serials: [],
      restoredDeviceIds: [],
      restoredTransfers: [],
      newWardsKept: [],
      correctedSerials: [],
      deletedDeviceIds: [],
      eventCount: batchEvents.length,
    }
    const willDelete: number[] = []
    const willRebuild: number[] = []
    for (const id of Array.from(deviceIds)) {
      const d = deviceById.get(id)!
      const all = eventsMap.get(id) ?? []
      const state = all.filter((e) => e.eventType !== 'CORRECT')
      const inBatch = state.filter((e) => batchIds.has(e.id))
      const hasTransfer = inBatch.some((e) => e.eventType === 'RECOVER')
      summary.serials.push(d.serialNo)
      if (state.length === inBatch.length) {
        willDelete.push(id)
        if (all.some((e) => e.eventType === 'CORRECT')) summary.correctedSerials.push(d.serialNo)
      } else {
        willRebuild.push(id)
        if (hasTransfer) summary.restoredTransfers.push({ deviceId: id, serialNo: d.serialNo, hospitalCode: inBatch.find((e) => e.eventType === 'RECOVER')!.hospitalCode })
        else summary.restoredDeviceIds.push(id)
      }
    }

    // 삭제·재계산
    await tx.hospitalDeviceEvent.deleteMany({ where: { importBatchId: batch.id } })
    if (willDelete.length > 0) {
      await tx.hospitalDeviceEvent.deleteMany({ where: { deviceId: { in: willDelete }, eventType: 'CORRECT' } })
      await tx.hospitalDevice.deleteMany({ where: { deviceId: { in: willDelete } } }) // 배치 행만 — 유닛은 남긴다
      summary.deletedDeviceIds = willDelete
    }
    for (const id of willRebuild) {
      const { deleted } = await rebuildOrDelete(tx, id, {
        illegal: (bad) => new RegistryError(409, `${deviceById.get(id)?.serialNo ?? id}: 배치 취소 후 이벤트 순서가 성립하지 않습니다 — ${eventLabel(bad)}`),
      })
      if (deleted) summary.deletedDeviceIds.push(id)
    }
    const prevSummary = batch.summary && typeof batch.summary === 'object' ? (batch.summary as Record<string, unknown>) : {}
    summary.newWardsKept = Array.isArray(prevSummary.newWards) ? (prevSummary.newWards as unknown[]) : []

    const updated = await tx.hospitalDeviceImportBatch.update({
      where: { id: batch.id },
      data: { cancelledAt: new Date(), cancelledById: ctx.actor?.userId ?? null, cancelSummary: summary as unknown as Prisma.InputJsonValue },
    })
    return { batch: updated, summary, cancelledEvents: batchEvents }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// editImportBatchDate
// ─────────────────────────────────────────────────────────────────────────────

export interface EditBatchDateResult {
  batch: Prisma.HospitalDeviceImportBatchGetPayload<Record<string, never>>
  before: string
  after: string
  eventCount: number
  deviceCount: number
}

export async function editImportBatchDate(ctx: RegistryCtx, input: { batchId: number; occurredOn: string }, opts?: RegistryOpts): Promise<EditBatchDateResult> {
  void ctx
  return withRegistryTx(opts, async (tx) => {
    const batch = await tx.hospitalDeviceImportBatch.findUnique({ where: { id: Number(input.batchId) } })
    if (!batch) throw new RegistryError(404, '임포트 배치를 찾을 수 없습니다')
    if (batch.cancelledAt) throw new RegistryError(409, '취소된 배치의 업무일자는 정정할 수 없습니다')
    if (!input.occurredOn) throw new RegistryError(400, '업무일자를 입력하세요')
    const after = requireOccurredOn(input.occurredOn)
    const before = ymd(batch.occurredOn)!
    if (after === before) throw new RegistryError(400, '변경 사항이 없습니다')

    const events = await tx.hospitalDeviceEvent.findMany({ where: { importBatchId: batch.id }, select: { id: true, deviceId: true } })
    await tx.hospitalDeviceEvent.updateMany({ where: { importBatchId: batch.id }, data: { occurredOn: ymdToDate(after) } })
    const deviceIds = Array.from(new Set(events.map((e) => e.deviceId)))
    const units = await loadUnits(tx, deviceIds)
    const serialById = new Map(Array.from(units.values()).map((u) => [u.id, u.serialNo]))
    for (const id of Array.from(deviceIds)) {
      await rebuildUnitProjection(tx, id, {
        illegal: (bad) => new RegistryError(409, `${serialById.get(id) ?? id}: 업무일자를 ${after}로 바꾸면 이벤트 순서가 성립하지 않습니다 — ${eventLabel(bad)}`),
      })
    }
    const updated = await tx.hospitalDeviceImportBatch.update({ where: { id: batch.id }, data: { occurredOn: ymdToDate(after) } })
    return { batch: updated, before, after, eventCount: events.length, deviceCount: deviceIds.length }
  })
}

