/**
 * 정정·취소(admin) — "사실은 이벤트로, 실수는 취소로" (§8.2)
 *
 * - editEvent          : 인플레이스 UPDATE(허용 필드만) + edited_* + fold 재검증(불성립 409). 신규 4종(INTAKE·REPAIR_DONE·SCRAP·SITE_MOVE)은 occurredOn·memo·ref만.
 *                        배치 축 스냅샷 이벤트의 occurredOn 정정은 id 순↔일자 순 역전 쌍을 만들면 409(`assertNoAxisInversion`, §8.2 3 — editImportBatchDate 동일)
 * - cancelLastEvent    : LIFO 물리 DELETE — 배치 축 이벤트(REGISTER·MOVE_WARD·RECOVER·AS_OPEN·AS_CLEAR)는 occurred_on 순 접미 판정(`assertSuffix`, B-35),
 *                        교체·이관 그룹은 짝 동시 취소, 임포트 행은 배치 카운트 감소, CORRECT는 `cancelCorrectEvent`(식별 컬럼 복원),
 *                        신규 4종은 `cancelUnitStateEvent`(단건, action_group 확장 없음, changes.before 복원)
 * - 스냅샷 규약(2026-09-17 §8.2, 단일 정렬 기준 = id): 스냅샷 이벤트 취소는 같은 유닛에 id가 더 큰 스냅샷 이벤트가 취소 집합 밖에 있으면 409(`assertNoLaterSnapshot`).
 *   배치 축 이벤트 취소 후 유닛 condition/location은 `rederiveUnitState`(① 남은 id 최대 스냅샷 after → ② 취소 이벤트 before → ③ 배치 파생) — I-3·I-4 위반은 warnings
 * - cancelImportBatch  : 배치 밖 배치 축 이벤트가 있으면 409(스냅샷 판정은 기기당 메모리 1회 `laterSnapshotOutside`), 아니면 이벤트→배치 행 DELETE·재등록 RECOVERED 복원·이관 원복 + 유닛 재도출.
 *                        배치 행이 사라지는 유닛의 CORRECT는 **상태 스냅샷 CORRECT를 제외하고** 삭제(재도출 ①이 취소 전 값을 되찾도록 — I-6·B-32)
 * 3층 구조: 취소로 배치 상태 이벤트가 0건이 되면 **배치 행(`hospital_devices`)만 삭제**하고 유닛(`device_units`)은 남긴다(`rebuildOrDelete` 경유).
 * `deletedDeviceIds`는 배치 행이 사라진 유닛 id 목록이다.
 * - editImportBatchDate: 배치 이벤트 occurred_on 일괄 UPDATE + 각 개체 fold 재검증
 * 서비스는 logAudit을 부르지 않는다 — 반환값의 before 스냅샷을 라우트가 기록한다.
 */
import { Prisma } from '@prisma/client'
import { DEVICE_PLACEMENT_AXIS_EVENT_TYPES, DEVICE_UNIT_STATE_EVENT_TYPES, RECOVERY_REASON_CATEGORY, isSnapshotEvent } from '@/lib/deviceRegistryShared'
import {
  RegistryError,
  eventLabel,
  getUnitOr404,
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
  type FoldState,
  type RegistryCtx,
  type RegistryOpts,
  type RegistryRef,
  type UnitRow,
} from './core'
import { assertNoLaterSnapshot, laterSnapshotOutside, rederiveUnitState, restoreUnitStateBefore, unitStateWarnings, type UnitStateSnapshot } from './condition'
import type { ChangeSet } from './write'

const isPlacementAxis = (e: { eventType: string }) => (DEVICE_PLACEMENT_AXIS_EVENT_TYPES as readonly string[]).includes(e.eventType)
const isUnitStateType = (t: string) => (DEVICE_UNIT_STATE_EVENT_TYPES as readonly string[]).includes(t)

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
  /** 배치 행이 있는 유닛만 — 배치 없는 유닛(신규 4종만 가진 유닛 등)은 null */
  device: DeviceRow | null
}

/**
 * 이벤트 인플레이스 정정. 신규 4종은 현행 키 집합 중 occurredOn·memo·ref만 성립(reasonCodeId·ward는 타입 검사 400).
 * 주의: ref 정정은 `ownsDeviceState`(AS 되돌림 게이트)·INTAKE B-37 스킵 판정이 ref_code에 의존하므로 게이트·스킵 판정을 바꾼다(§7.0 ref 규칙).
 * occurredOn 정정은 유닛 condition/location에 영향 없음(id 순 — §8.2 3). 단 배치 축 스냅샷 이벤트는 일자 순↔id 순 역전 쌍을 만드는 정정을 409로 막는다(`assertNoAxisInversion`).
 */
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
      if (v !== ymd(ev.occurredOn)) {
        const serial = (await tx.deviceUnit.findUnique({ where: { id: ev.deviceId }, select: { serialNo: true } }))?.serialNo ?? `#${ev.deviceId}`
        await assertNoAxisInversion(tx, ev, v, serial)
        data.occurredOn = ymdToDate(v)
      }
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
    return { before: ev, after, device: (await getUnitOr404(tx, ev.deviceId)).device }
  })
}

/**
 * 배치 축 스냅샷 이벤트(REGISTER·RECOVER·AS_OPEN·AS_CLEAR — changes 보유)의 업무일자 정정 시 **occurred_on 순(`assertSuffix`)↔id 순(`assertNoLaterSnapshot`) 역전 쌍** 차단
 * (§8.2 3, B-35 — 생성 시점 차단 `assertNoLaterSnapshotAxisEvent`와 같은 규칙, P2 리뷰 2026-09-17). 같은 유닛의 다른 배치 축 스냅샷 이벤트 중
 * (id < 대상 ∧ occurred_on > 새 일자) 또는 (id > 대상 ∧ occurred_on < 새 일자)가 있으면 409 — 허용하면 두 이벤트 모두 취소 불가(교착)가 된다.
 * 신규 4종·CORRECT·MOVE_WARD(비스냅샷)·배포 전 이벤트(스냅샷 없음)는 취소 순서로 풀리므로 대상 아님. `excludeIds`는 같은 일자로 함께 옮기는 이벤트(임포트 배치).
 */
async function assertNoAxisInversion(tx: DbClient, ev: { id: number; deviceId: number; eventType: string; changes: unknown }, newYmd: string, serial: string, excludeIds?: ReadonlySet<number>) {
  if (!isSnapshotEvent(ev) || !(DEVICE_PLACEMENT_AXIS_EVENT_TYPES as readonly string[]).includes(ev.eventType)) return
  const others = await tx.hospitalDeviceEvent.findMany({
    where: { deviceId: ev.deviceId, id: { not: ev.id }, eventType: { in: [...DEVICE_PLACEMENT_AXIS_EVENT_TYPES] }, changes: { not: Prisma.DbNull } },
    orderBy: { id: 'asc' },
  })
  const hit = others.find((o) => {
    if (excludeIds?.has(o.id) || !isSnapshotEvent(o)) return false
    const on = ymd(o.occurredOn) ?? ''
    return (o.id < ev.id && on > newYmd) || (o.id > ev.id && on < newYmd)
  })
  if (hit) {
    throw new RegistryError(409, `${serial}: 업무일자 순서와 기록 순서가 어긋나 정정할 수 없습니다(${eventLabel(hit)}) — 최근 이벤트를 먼저 취소하세요`, { serial })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// cancelLastEvent — LIFO 취소 (그룹 짝·임포트 행·CORRECT·유닛 상태 이벤트)
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
  /** CORRECT·유닛 상태 이벤트 취소 시 복원한 값 */
  restored?: ChangeSet
  /** 유닛 재도출 결과(유닛 id → 상태·위치, §8.2 2) */
  unitStates?: Record<number, UnitStateSnapshot>
  /** 재도출이 I-3·I-4를 깨는 등 차단하지 않는 안내 */
  warnings: string[]
}

/** CORRECT 복원 대상 — 유닛 컬럼(시리얼·원문·모델·MAC·용도) / 배치 컬럼(닉네임·상품유형·계약건). condition/location은 전용 매핑(`restoreUnitStateBefore`) */
const CORRECT_UNIT_FIELDS = new Set(['serialNo', 'serialRaw', 'deviceInfoId', 'macAddress', 'usageTypeId'])
const CORRECT_PLACEMENT_FIELDS = new Set(['extDeviceCode', 'productType', 'dealCode'])
const CORRECT_STATE_FIELDS = new Set(['condition', 'location'])

function restoredDeviceOf(d: DeviceRow | null): CancelEventResult['restoredDevices'] {
  return d ? [{ id: d.id, serialNo: d.serialNo, status: d.status, hospitalCode: d.hospitalCode }] : []
}

/** CORRECT 취소 — 조회는 배치 무관(§7.0). 상태 스냅샷 CORRECT(수리완료 해제·상태/위치 보정)는 `assertNoLaterSnapshot` + before 복원 */
async function cancelCorrectEvent(tx: DbClient, ev: EventRow): Promise<CancelEventResult> {
  const { unit, placement } = await getUnitOr404(tx, ev.deviceId)
  const later = await tx.hospitalDeviceEvent.findFirst({ where: { deviceId: ev.deviceId, eventType: 'CORRECT', id: { gt: ev.id } }, select: { id: true } })
  if (later) throw new RegistryError(409, '이후 정정 이벤트가 있습니다 — 최근 정정부터 취소하세요')
  const snapshot = isSnapshotEvent(ev)
  if (snapshot) await assertNoLaterSnapshot(tx, ev.deviceId, ev.id, { serial: unit.serialNo })
  const changes = (ev.changes ?? {}) as ChangeSet
  const unitData: Record<string, unknown> = {}
  const placementData: Record<string, unknown> = {}
  const restored: ChangeSet = {}
  const current = { ...(unit as unknown as Record<string, unknown>), ...((placement ?? {}) as unknown as Record<string, unknown>) }
  for (const [field, v] of Object.entries(changes)) {
    if (CORRECT_STATE_FIELDS.has(field)) continue
    const isUnit = CORRECT_UNIT_FIELDS.has(field)
    if ((!isUnit && !CORRECT_PLACEMENT_FIELDS.has(field)) || !v || typeof v !== 'object') continue
    if (!isUnit && !placement) throw new RegistryError(409, `${unit.serialNo}: 배치 행이 없는 기기 — 배치 속성(${field}) 정정은 되돌릴 수 없습니다`)
    const before = (v as { before: unknown }).before
    restored[field] = { before: current[field], after: before }
    ;(isUnit ? unitData : placementData)[field] = before ?? null
  }
  if (unitData.serialNo !== undefined && unitData.serialNo !== unit.serialNo) {
    const dup = await tx.deviceUnit.findUnique({ where: { serialNo: String(unitData.serialNo) }, select: { id: true } })
    if (dup && dup.id !== unit.id) throw new RegistryError(409, `복원할 시리얼(${String(unitData.serialNo)})이 이미 다른 기기에 등록되어 있습니다`)
  }
  try {
    if (Object.keys(unitData).length > 0) await tx.deviceUnit.update({ where: { id: unit.id }, data: unitData as Prisma.DeviceUnitUncheckedUpdateInput })
    if (Object.keys(placementData).length > 0) await tx.hospitalDevice.update({ where: { deviceId: unit.id }, data: placementData as Prisma.HospitalDeviceUncheckedUpdateInput })
  } catch (e) {
    throw mapDbError(e)
  }
  const unitStates: Record<number, UnitStateSnapshot> = {}
  const warnings: string[] = []
  if (snapshot) {
    const r = await restoreUnitStateBefore(tx, unit, ev)
    restored.condition = { before: r.before.condition, after: r.restored.condition }
    restored.location = { before: r.before.location, after: r.restored.location }
    unitStates[unit.id] = r.restored
    warnings.push(...unitStateWarnings(unit.serialNo, r.restored, placement ? { status: placement.status, hospitalCode: placement.hospitalCode } : null))
  }
  await tx.hospitalDeviceEvent.delete({ where: { id: ev.id } })
  const updated = await getUnitOr404(tx, unit.id)
  return {
    cancelledEvents: [ev],
    cancelledEventIds: [ev.id],
    deletedDeviceIds: [],
    restoredDevices: restoredDeviceOf(updated.device),
    affectedDeviceIds: [unit.id],
    batchAdjustments: [],
    restored,
    unitStates,
    warnings,
  }
}

/** 신규 4종(INTAKE·REPAIR_DONE·SCRAP·SITE_MOVE) 취소 — 단건(action_group 확장 없음), id 순 이후 스냅샷 있으면 409, `changes.before` 복원(location 전용 매핑) */
async function cancelUnitStateEvent(tx: DbClient, ev: EventRow): Promise<CancelEventResult> {
  const { unit, placement } = await getUnitOr404(tx, ev.deviceId)
  await assertNoLaterSnapshot(tx, ev.deviceId, ev.id, { serial: unit.serialNo })
  const r = await restoreUnitStateBefore(tx, unit, ev)
  await tx.hospitalDeviceEvent.delete({ where: { id: ev.id } })
  const updated = await getUnitOr404(tx, unit.id)
  return {
    cancelledEvents: [ev],
    cancelledEventIds: [ev.id],
    deletedDeviceIds: [],
    restoredDevices: restoredDeviceOf(updated.device),
    affectedDeviceIds: [unit.id],
    batchAdjustments: [],
    restored: {
      condition: { before: r.before.condition, after: r.restored.condition },
      location: { before: r.before.location, after: r.restored.location },
    },
    unitStates: { [unit.id]: r.restored },
    warnings: unitStateWarnings(unit.serialNo, r.restored, placement ? { status: placement.status, hospitalCode: placement.hospitalCode } : null),
  }
}

/**
 * 취소 대상 확장 — 같은 action_group에서 이 개체와 related_device_id로 얽힌 개체들의 배치 축 이벤트(교체·이관 짝, 소급 3건).
 * 일괄(bulk) 그룹은 related 링크가 없어 이 개체의 이벤트만 잡힌다. CORRECT·신규 4종은 그룹에 있어도 확장·취소 대상이 아니다.
 */
function expandCancelSet(anchor: EventRow, group: readonly EventRow[]): { deviceIds: Set<number>; toCancel: EventRow[] } {
  const deviceIds = new Set<number>([anchor.deviceId])
  let grew = true
  while (grew) {
    grew = false
    for (const e of group) {
      if (!isPlacementAxis(e)) continue
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
  const toCancel = group.filter((e) => isPlacementAxis(e) && deviceIds.has(e.deviceId))
  return { deviceIds, toCancel }
}

/** 각 개체에서 취소 이벤트들이 배치 축 이벤트 열의 접미(suffix)인지 — 아니면 이후 이벤트가 있는 것 (occurred_on 순, B-35) */
function assertSuffix(serialNo: string, axisEvents: readonly EventRow[], cancelIds: Set<number>, what: string) {
  const sorted = sortEvents(axisEvents)
  const first = sorted.findIndex((e) => cancelIds.has(e.id))
  if (first < 0) return
  for (let i = first; i < sorted.length; i++) {
    if (!cancelIds.has(sorted[i].id)) {
      throw new RegistryError(409, `${serialNo}: 이후 이벤트(${eventLabel(sorted[i])})가 있어 ${what}할 수 없습니다 — 최근 이벤트부터 취소하세요`)
    }
  }
}

/** rebuild 결과 → 재도출 입력의 배치 형상 */
function placementForRederive(deleted: boolean, state: FoldState) {
  return deleted ? null : { status: state.status, hospitalCode: state.hospitalCode, asStartedOn: state.asStartedOn, placedOn: state.placedOn, recoveredOn: state.recoveredOn }
}

export async function cancelLastEvent(ctx: RegistryCtx, input: { eventId: number }, opts?: RegistryOpts): Promise<CancelEventResult> {
  return withRegistryTx(opts, async (tx) => {
    const ev = await tx.hospitalDeviceEvent.findUnique({ where: { id: Number(input.eventId) } })
    if (!ev) throw new RegistryError(404, '이벤트를 찾을 수 없습니다')
    if (ev.eventType === 'CORRECT') return cancelCorrectEvent(tx, ev)
    if (isUnitStateType(ev.eventType)) return cancelUnitStateEvent(tx, ev)

    const group = ev.actionGroup ? await tx.hospitalDeviceEvent.findMany({ where: { actionGroup: ev.actionGroup } }) : [ev]
    const { deviceIds, toCancel } = expandCancelSet(ev, group)
    const cancelIds = new Set(toCancel.map((e) => e.id))
    const deviceById = await loadDevices(tx, Array.from(deviceIds))
    const unitById = await loadUnits(tx, Array.from(deviceIds))
    const serialOf = (id: number) => deviceById.get(id)?.serialNo ?? unitById.get(id)?.serialNo ?? String(id)
    const eventsMap = await loadDeviceEvents(tx, Array.from(deviceIds))

    // LIFO — 개체별로 취소 이벤트가 배치 축 이벤트의 접미여야 한다 (신 기기에 다른 이벤트가 있으면 409). 신규 4종·CORRECT는 제외(B-35)
    for (const id of Array.from(deviceIds)) {
      if (!deviceById.has(id)) continue
      assertSuffix(serialOf(id), (eventsMap.get(id) ?? []).filter(isPlacementAxis), cancelIds, '취소')
    }
    // 스냅샷 규약(§8.2 1) — 취소되는 스냅샷 이벤트보다 id가 큰 스냅샷 이벤트가 집합 밖에 있으면 409 (예: 소급 AS_CLEAR 뒤 REPAIR_DONE, REGISTER(오늘)+INTAKE(과거일))
    for (const e of toCancel) {
      if (isSnapshotEvent(e)) await assertNoLaterSnapshot(tx, e.deviceId, e.id, { cancelIds, serial: serialOf(e.deviceId) })
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

    // 배치 상태 이벤트 0 유닛은 배치 행 삭제(유닛은 남김, FK SET NULL 반영) → 나머지 재계산 — 모두 rebuildOrDelete 경유
    const deletedDeviceIds: number[] = []
    const restoredDevices: CancelEventResult['restoredDevices'] = []
    const unitStates: Record<number, UnitStateSnapshot> = {}
    const warnings: string[] = []
    const cancelledByDevice = new Map<number, EventRow[]>()
    for (const e of toCancel) (cancelledByDevice.get(e.deviceId) ?? cancelledByDevice.set(e.deviceId, []).get(e.deviceId)!).push(e)
    for (const id of Array.from(deviceIds)) {
      if (!deviceById.has(id) && !(await tx.hospitalDevice.findUnique({ where: { deviceId: id }, select: { id: true } }))) continue
      const { deleted, state } = await rebuildOrDelete(tx, id)
      if (deleted) deletedDeviceIds.push(id)
      else restoredDevices.push({ id, serialNo: serialOf(id), status: state.status!, hospitalCode: state.hospitalCode })
      // 배치 축 이벤트가 취소된 유닛은 상태·위치 재도출(B-32 ①②③)
      const cancelled = cancelledByDevice.get(id)
      if (cancelled && cancelled.length > 0) {
        const unit = unitById.get(id) ?? (await getUnitOr404(tx, id)).unit
        const r = await rederiveUnitState(tx, unit as UnitRow, { cancelled, placement: placementForRederive(deleted, state) })
        unitStates[id] = r.state
        warnings.push(...r.warnings)
      }
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
      unitStates,
      warnings,
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
  /** 유닛 재도출이 I-3·I-4를 깨는 등 차단하지 않는 안내(§8.2 2) */
  warnings: string[]
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
    const unitById = await loadUnits(tx, deviceIds)
    const eventsMap = await loadDeviceEvents(tx, deviceIds)
    const serialOf = (id: number) => deviceById.get(id)?.serialNo ?? unitById.get(id)?.serialNo ?? String(id)

    // 차단: 배치 밖 배치 축 이벤트가 배치 이벤트 뒤에 있는 기기 (CORRECT·신규 4종·memo는 차단 사유 아님 — B-35)
    const blockers: string[] = []
    for (const id of Array.from(deviceIds)) {
      const sorted = sortEvents((eventsMap.get(id) ?? []).filter(isPlacementAxis))
      const first = sorted.findIndex((e) => batchIds.has(e.id))
      if (first < 0) continue
      const offender = sorted.slice(first).find((e) => !batchIds.has(e.id))
      if (offender) blockers.push(`${serialOf(id)}(${eventLabel(offender)})`)
    }
    if (blockers.length > 0) {
      throw new RegistryError(
        409,
        `배치 밖 이벤트가 있는 기기 ${blockers.length}대 — ${blockers.slice(0, 10).join(' · ')}${blockers.length > 10 ? ' …' : ''} 해당 이벤트를 드로어에서 먼저 취소하면 배치를 취소할 수 있습니다`
      )
    }
    // 스냅샷 규약(§8.2 1) — 배치 스냅샷 이벤트보다 id가 큰 스냅샷 이벤트(입고·수리 완료 등)가 배치 밖에 있으면 409.
    // eventsMap(유닛 전 이벤트)으로 기기당 메모리 판정 — 배치 행 수만큼 findMany를 내지 않는다(2,000행 배치 = 2,000 쿼리 회피)
    const snapshotBlockers: string[] = []
    for (const id of Array.from(deviceIds)) {
      const hit = laterSnapshotOutside(eventsMap.get(id) ?? [], batchIds)
      if (hit) snapshotBlockers.push(`${serialOf(id)}(${eventLabel(hit)})`)
    }
    if (snapshotBlockers.length > 0) {
      throw new RegistryError(
        409,
        `이후 상태 스냅샷 이벤트가 있는 기기 ${snapshotBlockers.length}대 — ${snapshotBlockers.slice(0, 10).join(' · ')}${snapshotBlockers.length > 10 ? ' …' : ''} 최근 이벤트부터 드로어에서 취소하면 배치를 취소할 수 있습니다`
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
      warnings: [],
    }
    const willDelete: number[] = []
    const willRebuild: number[] = []
    for (const id of Array.from(deviceIds)) {
      const all = eventsMap.get(id) ?? []
      const axis = all.filter(isPlacementAxis)
      const inBatch = axis.filter((e) => batchIds.has(e.id))
      const hasTransfer = inBatch.some((e) => e.eventType === 'RECOVER')
      summary.serials.push(serialOf(id))
      if (axis.length === inBatch.length) {
        willDelete.push(id)
        if (all.some((e) => e.eventType === 'CORRECT' && !isSnapshotEvent(e))) summary.correctedSerials.push(serialOf(id))
      } else {
        willRebuild.push(id)
        if (hasTransfer) summary.restoredTransfers.push({ deviceId: id, serialNo: serialOf(id), hospitalCode: inBatch.find((e) => e.eventType === 'RECOVER')!.hospitalCode })
        else summary.restoredDeviceIds.push(id)
      }
    }

    // 삭제·재계산 — 배치 행이 삭제되는 유닛도 rebuildOrDelete 경유(배치 상태 이벤트 0 → 행 삭제) + 유닛 재도출
    await tx.hospitalDeviceEvent.deleteMany({ where: { importBatchId: batch.id } })
    if (willDelete.length > 0) {
      // 유닛·배치 속성 CORRECT만 삭제 — 상태 스냅샷 CORRECT(수리완료 해제·A-6 PRE_SHIP 진입 보정)는 남겨 재도출 ①(id 최대 스냅샷 after, I-6)이 취소 전 값을 되찾게 한다.
      // (유닛 속성 CORRECT(시리얼·MAC·용도)까지 지우는 동작은 기존 유지 — 별건 재검토)
      const correctIds = willDelete.flatMap((id) => (eventsMap.get(id) ?? []).filter((e) => e.eventType === 'CORRECT' && !isSnapshotEvent(e)).map((e) => e.id))
      if (correctIds.length > 0) await tx.hospitalDeviceEvent.deleteMany({ where: { id: { in: correctIds } } })
    }
    const cancelledByDevice = new Map<number, EventRow[]>()
    for (const e of batchEvents) (cancelledByDevice.get(e.deviceId) ?? cancelledByDevice.set(e.deviceId, []).get(e.deviceId)!).push(e)
    for (const id of [...willDelete, ...willRebuild]) {
      const { deleted, state } = await rebuildOrDelete(tx, id, {
        illegal: (bad) => new RegistryError(409, `${serialOf(id)}: 배치 취소 후 이벤트 순서가 성립하지 않습니다 — ${eventLabel(bad)}`),
      })
      if (deleted) summary.deletedDeviceIds.push(id)
      const unit = unitById.get(id) ?? (await getUnitOr404(tx, id)).unit
      const r = await rederiveUnitState(tx, unit as UnitRow, { cancelled: cancelledByDevice.get(id) ?? [], placement: placementForRederive(deleted, state) })
      summary.warnings.push(...r.warnings)
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

    const events = await tx.hospitalDeviceEvent.findMany({ where: { importBatchId: batch.id } })
    const deviceIds = Array.from(new Set(events.map((e) => e.deviceId)))
    const units = await loadUnits(tx, deviceIds)
    const serialById = new Map(Array.from(units.values()).map((u) => [u.id, u.serialNo]))
    // 배치 축 스냅샷(REGISTER·RECOVER) 일자 이동이 배치 밖 이벤트와 id 순↔일자 순 역전을 만들면 409(§8.2 3) — 배치 안 이벤트끼리는 같은 일자로 옮겨 역전 없음
    const batchIds = new Set(events.map((e) => e.id))
    for (const e of events) await assertNoAxisInversion(tx, e, after, serialById.get(e.deviceId) ?? `#${e.deviceId}`, batchIds)
    await tx.hospitalDeviceEvent.updateMany({ where: { importBatchId: batch.id }, data: { occurredOn: ymdToDate(after) } })
    for (const id of Array.from(deviceIds)) {
      await rebuildUnitProjection(tx, id, {
        illegal: (bad) => new RegistryError(409, `${serialById.get(id) ?? id}: 업무일자를 ${after}로 바꾸면 이벤트 순서가 성립하지 않습니다 — ${eventLabel(bad)}`),
      })
    }
    const updated = await tx.hospitalDeviceImportBatch.update({ where: { id: batch.id }, data: { occurredOn: ymdToDate(after) } })
    return { batch: updated, before, after, eventCount: events.length, deviceCount: deviceIds.length }
  })
}
