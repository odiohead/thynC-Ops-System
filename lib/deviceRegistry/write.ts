/**
 * 디바이스 원장 쓰기 — 등록·이동·회수·교체·일괄·식별 정정·메모 (§7.0 계약, §4.1 불변식, §4.2 전이표)
 *
 * 모든 경로: 이벤트 INSERT → `rebuildUnitProjection`(fold) → 불성립이면 409로 트랜잭션 롤백.
 * 신규 개체 행의 초기 프로젝션도 같은 `foldEvents`로 계산한다(REGISTER 1건).
 */
import { Prisma } from '@prisma/client'
import { normalizeSerial, normalizeWardName, type DeviceEventType } from '@/lib/deviceRegistryShared'
import {
  RegistryError,
  assertTransition,
  eventLabel,
  foldEvents,
  getDeviceOr404,
  getWardById,
  guardOf,
  hospitalNames,
  insertEvent,
  insertEvents,
  loadDeviceEvents,
  loadTrackedModels,
  mapDbError,
  prepareCtx,
  projectionData,
  reasonByValue,
  rebuildUnitProjection,
  requireRecoveryReason,
  resolveModel,
  resolveWardInput,
  resolveWardsByName,
  retroIllegal,
  sortEvents,
  stateAt,
  stateEventsAfter,
  uniqInts,
  wardNames,
  withRegistryTx,
  ymd,
  type Conflict,
  type DbClient,
  type DeviceRow,
  type EventInput,
  type EventRow,
  type FoldEvent,
  type RegistryCtx,
  type RegistryOpts,
  type SkippedItem,
  type TrackedModel,
  type WardRef,
} from './core'
import { matchInventoryUnits, type WmsMatch } from './wms'

// ─────────────────────────────────────────────────────────────────────────────
// 공용 소도구
// ─────────────────────────────────────────────────────────────────────────────

/** 신규 개체 행 생성 입력 — 프로젝션은 REGISTER 1건 fold 결과 */
function newDeviceData(args: {
  model: TrackedModel
  serialNo: string
  serialRaw: string | null
  macAddress?: string | null
  extDeviceCode?: string | null
  hospitalCode: string
  wardId: number | null
  occurredOn: string
}): Prisma.HospitalDeviceUncheckedCreateInput {
  const synthetic: FoldEvent = {
    id: 0,
    eventType: 'REGISTER',
    hospitalCode: args.hospitalCode,
    fromWardId: null,
    toWardId: args.wardId,
    reasonCodeId: null,
    occurredOn: args.occurredOn,
    relatedDeviceId: null,
  }
  const proj = projectionData(foldEvents([synthetic])) as Prisma.HospitalDeviceUncheckedCreateInput
  return {
    ...proj,
    deviceInfoId: args.model.id,
    serialNo: args.serialNo,
    serialRaw: args.serialRaw,
    macAddress: args.macAddress?.trim() || null,
    extDeviceCode: args.extDeviceCode?.trim() || null,
  }
}

function toWmsInput(d: Pick<DeviceRow, 'id' | 'serialNo' | 'serialRaw' | 'deviceInfoId'>, models: readonly TrackedModel[]) {
  return {
    id: d.id,
    serialNo: d.serialNo,
    serialRaw: d.serialRaw,
    deviceInfoId: d.deviceInfoId,
    deviceModel: models.find((m) => m.id === d.deviceInfoId)?.deviceModel ?? null,
  }
}

async function buildConflicts(client: DbClient, devices: readonly DeviceRow[]): Promise<Conflict[]> {
  const hNames = await hospitalNames(client, devices.map((d) => d.hospitalCode))
  const wNames = await wardNames(client, devices.map((d) => d.wardId))
  return devices.map((d) => ({
    serial: d.serialNo,
    deviceId: d.id,
    hospitalCode: d.hospitalCode!,
    hospitalName: hNames.get(d.hospitalCode!) ?? null,
    wardName: d.wardId != null ? wNames.get(d.wardId) ?? null : null,
    placedOn: ymd(d.placedOn),
  }))
}

/** 이관(RECOVER TRANSFER) 소급 정합 — 상대 병원 배치일 이전이거나 이후 이벤트가 있으면 409 (§7.2 error 행) */
function assertTransferConsistent(device: DeviceRow, events: readonly EventRow[], occurredOn: string, otherName: string) {
  const st = stateAt(events, occurredOn)
  if (st.status !== 'ACTIVE' || st.hospitalCode !== device.hospitalCode) {
    throw new RegistryError(
      409,
      `${device.serialNo}: 이관 업무일자(${occurredOn})가 ${otherName} 배치일(${ymd(device.placedOn) ?? '?'})보다 이릅니다 — 업무일자를 조정하거나 행을 제외하세요`,
      { serial: device.serialNo }
    )
  }
  const later = stateEventsAfter(events, occurredOn)
  if (later.length > 0) {
    throw new RegistryError(
      409,
      `${device.serialNo}: 이관 업무일자 이후 ${otherName}에 이벤트(${eventLabel(later[0])})가 있습니다 — 그 병원에서 먼저 정리하세요`,
      { serial: device.serialNo }
    )
  }
  return st
}

/** 재등록 소급 정합 — 업무일자 < 회수일이면 409 (§7.2 메시지) */
function assertReregisterConsistent(device: DeviceRow, occurredOn: string) {
  const rec = ymd(device.recoveredOn)
  if (rec && occurredOn < rec) {
    throw new RegistryError(
      409,
      `${device.serialNo}: 업무일자(${occurredOn})가 이 기기의 회수일(${rec})보다 이릅니다 — 업무일자를 조정하거나 행을 제외하세요`,
      { serial: device.serialNo }
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// registerDevices — N개 등록(신규·재등록·opt-in 이관) (§7.0 등록 중복 규약)
// ─────────────────────────────────────────────────────────────────────────────

export interface RegisterItem {
  serialInput: string
  deviceInfoId?: number | null
  /** Excel B열 '모델' (device_model 또는 device_name) */
  modelInput?: string | null
  /** 온프렘 export 초안의 deviceType */
  onpremDeviceType?: number | null
  wardId?: number | null
  wardName?: string | null
  /** 행 메모(REGISTER 이벤트 memo) — 없으면 ctx.memo */
  memo?: string | null
  macAddress?: string | null
  extDeviceCode?: string | null
}

export interface RegisterOpts extends RegistryOpts {
  /** 타 병원 ACTIVE 시리얼의 이관 opt-in — 키는 정규화 시리얼 */
  conflicts?: Record<string, 'TRANSFER'> | null
  /** 임포트 실행에서만 — 이벤트에 import_batch_id 부여, skip은 집계(409 없음) */
  importBatchId?: number | null
}

export interface RegisteredRef {
  id: number
  serialNo: string
  eventId: number
  wardId: number | null
}

export interface TransferredRef extends RegisteredRef {
  fromHospitalCode: string
  recoverEventId: number
}

export interface RegisterResult {
  actionGroup: string
  created: RegisteredRef[]
  reregistered: RegisteredRef[]
  transferred: TransferredRef[]
  skipped: SkippedItem[]
  /** 생성된 이벤트 id 전체(이관 RECOVER 포함) */
  events: number[]
  warnings: string[]
  newWards: { id: number; name: string }[]
  /** WMS 자동 연결 결과 (deviceId → 매치) */
  wms: Record<number, WmsMatch | null>
}

interface PreparedItem {
  index: number
  item: RegisterItem
  serialNo: string
  serialRaw: string | null
  model: TrackedModel
  existing: DeviceRow | null
  kind: 'create' | 'reregister' | 'transfer' | 'skip'
  ward: WardRef | null
}

export async function registerDevices(ctx: RegistryCtx, items: readonly RegisterItem[], opts?: RegisterOpts): Promise<RegisterResult> {
  return withRegistryTx(opts, (tx) => registerDevicesIn(tx, ctx, items, opts))
}

export async function registerDevicesIn(tx: DbClient, ctx: RegistryCtx, items: readonly RegisterItem[], opts?: RegisterOpts): Promise<RegisterResult> {
  const p = await prepareCtx(tx, ctx, { requireHospital: true })
  const here = p.hospitalCode!
  const warnings = [...p.warnings]
  const autoCreate = opts?.autoCreateWard ?? true
  const importMode = opts?.importBatchId != null
  if (!Array.isArray(items) || items.length === 0) throw new RegistryError(400, '등록할 시리얼이 없습니다')

  // 1) 시리얼 정규화·중복 병합
  const models = await loadTrackedModels(tx)
  const prepared: PreparedItem[] = []
  const seen = new Set<string>()
  items.forEach((item, index) => {
    const ns = normalizeSerial(item.serialInput)
    if (!ns.serialNo) throw new RegistryError(400, `${index + 1}번째 시리얼이 비어 있습니다`)
    if (seen.has(ns.serialNo)) {
      warnings.push(`${ns.serialNo}: 중복 입력을 병합했습니다`)
      return
    }
    seen.add(ns.serialNo)
    const res = resolveModel(models, {
      serialNo: ns.serialNo,
      deviceInfoId: item.deviceInfoId ?? null,
      modelInput: item.modelInput ?? null,
      onpremDeviceType: item.onpremDeviceType ?? null,
    })
    if (!res.model) throw new RegistryError(400, `${ns.serialNo}: ${res.error}`, { serial: ns.serialNo })
    for (const w of res.warnings) warnings.push(`${ns.serialNo}: ${w}`)
    prepared.push({ index, item, serialNo: ns.serialNo, serialRaw: ns.serialRaw, model: res.model, existing: null, kind: 'create', ward: null })
  })

  // 2) 기존 개체 조회 → 분류 (현재 프로젝션 기준: 같은 병원 ACTIVE=skip · 타 병원 ACTIVE=conflict/transfer · RECOVERED=reregister)
  const existingRows = await tx.hospitalDevice.findMany({ where: { serialNo: { in: prepared.map((x) => x.serialNo) } } })
  const existingBySerial = new Map(existingRows.map((d) => [d.serialNo, d]))
  const skipped: SkippedItem[] = []
  const conflictDevices: DeviceRow[] = []
  for (const x of prepared) {
    const d = existingBySerial.get(x.serialNo) ?? null
    x.existing = d
    if (!d) continue
    if (d.status === 'ACTIVE' && d.hospitalCode === here) {
      x.kind = 'skip'
      skipped.push({ deviceId: d.id, serialNo: d.serialNo, reason: '이미 이 병원에 배치 중' })
    } else if (d.status === 'ACTIVE') {
      if (opts?.conflicts?.[x.serialNo] === 'TRANSFER') x.kind = 'transfer'
      else conflictDevices.push(d)
    } else {
      x.kind = 'reregister'
    }
  }
  if (conflictDevices.length > 0) {
    throw new RegistryError(409, '타 병원에서 운용 중인 시리얼이 있습니다.', { conflicts: await buildConflicts(tx, conflictDevices) })
  }
  if (!importMode && skipped.length > 0 && (prepared.length === 1 || skipped.length === prepared.length)) {
    throw new RegistryError(409, '이미 이 병원에 배치 중인 시리얼입니다', { skipped })
  }

  // 3) 병동 해석 — id는 개별 검증, 이름은 일괄(name_norm 오름차순 생성)
  const work = prepared.filter((x) => x.kind !== 'skip')
  const wardIdCache = new Map<number, WardRef>()
  for (const id of uniqInts(work.map((x) => x.item.wardId))) wardIdCache.set(id, await getWardById(tx, here, id))
  const nameMap = await resolveWardsByName(
    tx,
    here,
    work.filter((x) => x.item.wardId == null && x.item.wardName?.trim()).map((x) => x.item.wardName!.trim()),
    { autoCreate }
  )
  for (const x of work) {
    if (x.item.wardId != null) x.ward = wardIdCache.get(Number(x.item.wardId)) ?? null
    else if (x.item.wardName?.trim()) x.ward = nameMap.get(normalizeWardName(x.item.wardName)) ?? null
  }
  const newWards = Array.from(nameMap.values()).filter((w) => w.isNew).map((w) => ({ id: w.id, name: w.name }))

  // 4) 소급 정합(불변식 3) — 재등록·이관은 업무일자 시점 상태로 검증
  const existingIds = work.filter((x) => x.existing).map((x) => x.existing!.id)
  const eventsMap = await loadDeviceEvents(tx, existingIds)
  const otherNames = await hospitalNames(tx, work.filter((x) => x.kind === 'transfer').map((x) => x.existing!.hospitalCode))
  const transferReason = work.some((x) => x.kind === 'transfer') ? await reasonByValue(tx, 'TRANSFER') : null
  const transferFromWard = new Map<number, number | null>()
  for (const x of work) {
    if (!x.existing) continue
    const evs = eventsMap.get(x.existing.id) ?? []
    if (x.kind === 'reregister') {
      assertReregisterConsistent(x.existing, p.occurredOn)
      assertTransition(stateAt(evs, p.occurredOn), 'REGISTER', here, { serial: x.serialNo })
    } else if (x.kind === 'transfer') {
      const st = assertTransferConsistent(x.existing, evs, p.occurredOn, otherNames.get(x.existing.hospitalCode!) ?? x.existing.hospitalCode!)
      transferFromWard.set(x.existing.id, st.wardId)
    }
  }

  // 5) 신규 개체 행 생성 (프로젝션 = REGISTER 1건 fold)
  const creates = work.filter((x) => x.kind === 'create')
  let createdRows: DeviceRow[] = []
  if (creates.length > 0) {
    try {
      createdRows = await tx.hospitalDevice.createManyAndReturn({
        data: creates.map((x) =>
          newDeviceData({
            model: x.model,
            serialNo: x.serialNo,
            serialRaw: x.serialRaw,
            macAddress: x.item.macAddress,
            extDeviceCode: x.item.extDeviceCode,
            hospitalCode: here,
            wardId: x.ward?.id ?? null,
            occurredOn: p.occurredOn,
          })
        ),
      })
    } catch (e) {
      throw mapDbError(e)
    }
  }
  const createdBySerial = new Map(createdRows.map((d) => [d.serialNo, d]))

  // 6) 이벤트 적재 — 이관은 RECOVER(TRANSFER)@상대 → REGISTER@이 병원 순(같은 일자 순서 = id)
  const inputs: EventInput[] = []
  const slots: { x: PreparedItem; deviceId: number; recoverIdx: number | null; registerIdx: number }[] = []
  for (const x of work) {
    const deviceId = x.existing?.id ?? createdBySerial.get(x.serialNo)!.id
    let recoverIdx: number | null = null
    if (x.kind === 'transfer') {
      recoverIdx = inputs.length
      inputs.push({
        deviceId,
        eventType: 'RECOVER',
        hospitalCode: x.existing!.hospitalCode,
        fromWardId: transferFromWard.get(deviceId) ?? null,
        reasonCodeId: transferReason!.id,
        occurredOn: p.occurredOn,
        memo: p.memo,
        ref: p.ref,
        actionGroup: p.actionGroup,
        source: p.source,
        importBatchId: opts?.importBatchId ?? null,
        actor: p.actor,
      })
    }
    const registerIdx = inputs.length
    inputs.push({
      deviceId,
      eventType: 'REGISTER',
      hospitalCode: here,
      toWardId: x.ward?.id ?? null,
      occurredOn: p.occurredOn,
      memo: x.item.memo?.trim() || p.memo,
      ref: p.ref,
      actionGroup: p.actionGroup,
      source: p.source,
      importBatchId: opts?.importBatchId ?? null,
      actor: p.actor,
    })
    slots.push({ x, deviceId, recoverIdx, registerIdx })
  }
  const events = await insertEvents(tx, inputs)

  // 7) 기존 개체 프로젝션 재계산(가드 + 소급 재-fold) · 식별 보조값 채움
  for (const s of slots) {
    if (!s.x.existing) continue
    await rebuildUnitProjection(tx, s.deviceId, { guard: guardOf(s.x.existing), illegal: retroIllegal })
    const mac = s.x.item.macAddress?.trim() || null
    const ext = s.x.item.extDeviceCode?.trim() || null
    if ((mac && !s.x.existing.macAddress) || (ext && !s.x.existing.extDeviceCode)) {
      await tx.hospitalDevice.update({
        where: { id: s.deviceId },
        data: {
          ...(mac && !s.x.existing.macAddress ? { macAddress: mac } : {}),
          ...(ext && !s.x.existing.extDeviceCode ? { extDeviceCode: ext } : {}),
        },
      })
    }
  }

  // 8) WMS 조인 키 영속 매칭 (쓰기 경로 — §9.2)
  const wmsTargets = slots.map((s) => ({
    id: s.deviceId,
    serialNo: s.x.serialNo,
    serialRaw: s.x.serialRaw ?? s.x.existing?.serialRaw ?? null,
    deviceInfoId: s.x.existing?.deviceInfoId ?? s.x.model.id,
    deviceModel: models.find((m) => m.id === (s.x.existing?.deviceInfoId ?? s.x.model.id))?.deviceModel ?? null,
  }))
  const wmsMap = await matchInventoryUnits(tx, wmsTargets, { persist: true })

  // 9) 결과
  const result: RegisterResult = {
    actionGroup: p.actionGroup,
    created: [],
    reregistered: [],
    transferred: [],
    skipped,
    events: events.map((e) => e.id),
    warnings,
    newWards,
    wms: Object.fromEntries(Array.from(wmsMap.entries())),
  }
  for (const s of slots) {
    const ref: RegisteredRef = { id: s.deviceId, serialNo: s.x.serialNo, eventId: events[s.registerIdx].id, wardId: s.x.ward?.id ?? null }
    if (s.x.kind === 'create') result.created.push(ref)
    else if (s.x.kind === 'reregister') result.reregistered.push(ref)
    else if (s.x.kind === 'transfer') {
      result.transferred.push({ ...ref, fromHospitalCode: s.x.existing!.hospitalCode!, recoverEventId: events[s.recoverIdx!].id })
    }
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// moveDeviceWard · recoverDevice — 개체 단건 (병원은 개체에서 유도 가능)
// ─────────────────────────────────────────────────────────────────────────────

export interface MoveResult {
  event: EventRow
  device: DeviceRow
  fromWardId: number | null
  toWard: WardRef
  warnings: string[]
}

export async function moveDeviceWard(
  ctx: RegistryCtx,
  input: { deviceId: number; toWardId?: number | null; toWardName?: string | null },
  opts?: RegistryOpts
): Promise<MoveResult> {
  return withRegistryTx(opts, async (tx) => {
    const device = await getDeviceOr404(tx, input.deviceId)
    const here = ctx.hospitalCode ?? device.hospitalCode
    // 현재 프로젝션 기준 전이(타 병원 409·회수됨 409)를 먼저 — 병원 문맥이 없으면 여기서 끝난다
    assertTransition(device as { status: 'ACTIVE' | 'RECOVERED'; hospitalCode: string | null }, 'MOVE_WARD', here ?? null)
    const p = await prepareCtx(tx, { ...ctx, hospitalCode: here }, { requireHospital: true })
    const toWard = await resolveWardInput(tx, here!, { wardId: input.toWardId, wardName: input.toWardName }, { autoCreate: opts?.autoCreateWard ?? true })
    if (!toWard) throw new RegistryError(400, '이동할 병동을 지정하세요')
    if (device.wardId === toWard.id) throw new RegistryError(400, '이미 해당 병동에 배치되어 있습니다')

    const events = (await loadDeviceEvents(tx, [device.id])).get(device.id) ?? []
    const st = stateAt(events, p.occurredOn)
    assertTransition(st, 'MOVE_WARD', here!, { serial: device.serialNo })
    // 소급 입력: 업무일자 시점에 이미 그 병동이면 from=to 무의미 이벤트 — 400 (현재 프로젝션 검사와 별개)
    if (st.wardId === toWard.id) throw new RegistryError(400, `업무일자(${p.occurredOn}) 시점에 이미 해당 병동에 배치되어 있습니다`)
    const event = await insertEvent(tx, {
      deviceId: device.id,
      eventType: 'MOVE_WARD',
      hospitalCode: here!,
      fromWardId: st.wardId,
      toWardId: toWard.id,
      occurredOn: p.occurredOn,
      memo: p.memo,
      ref: p.ref,
      actionGroup: p.actionGroup,
      source: p.source,
      actor: p.actor,
    })
    if (!event) throw new RegistryError(409, '같은 연결 키의 이벤트가 이미 기록되어 있습니다')
    await rebuildUnitProjection(tx, device.id, { guard: guardOf(device), illegal: retroIllegal })
    const updated = await getDeviceOr404(tx, device.id)
    return { event, device: updated, fromWardId: st.wardId, toWard, warnings: p.warnings }
  })
}

export interface RecoverResult {
  event: EventRow
  device: DeviceRow
  fromWardId: number | null
  reason: { id: number; name: string; value: string | null }
  warnings: string[]
}

export async function recoverDevice(
  ctx: RegistryCtx,
  input: { deviceId: number; reasonCodeId: number; relatedDeviceId?: number | null },
  opts?: RegistryOpts
): Promise<RecoverResult> {
  return withRegistryTx(opts, async (tx) => {
    const device = await getDeviceOr404(tx, input.deviceId)
    const here = ctx.hospitalCode ?? device.hospitalCode
    if (device.status === 'RECOVERED') throw new RegistryError(409, '이미 회수된 기기입니다')
    assertTransition(device as { status: 'ACTIVE' | 'RECOVERED'; hospitalCode: string | null }, 'RECOVER', here ?? null)
    const reason = await requireRecoveryReason(tx, input.reasonCodeId)
    const p = await prepareCtx(tx, { ...ctx, hospitalCode: here }, { requireHospital: true })
    let relatedDeviceId: number | null = null
    if (input.relatedDeviceId != null) {
      if (Number(input.relatedDeviceId) === device.id) throw new RegistryError(400, '교체 상대가 자기 자신일 수 없습니다')
      relatedDeviceId = (await getDeviceOr404(tx, Number(input.relatedDeviceId))).id
    }
    const events = (await loadDeviceEvents(tx, [device.id])).get(device.id) ?? []
    const st = stateAt(events, p.occurredOn)
    assertTransition(st, 'RECOVER', here!, { serial: device.serialNo })
    const event = await insertEvent(tx, {
      deviceId: device.id,
      eventType: 'RECOVER',
      hospitalCode: here!,
      fromWardId: st.wardId,
      reasonCodeId: reason.id,
      occurredOn: p.occurredOn,
      memo: p.memo,
      ref: p.ref,
      relatedDeviceId,
      actionGroup: p.actionGroup,
      source: p.source,
      actor: p.actor,
    })
    if (!event) throw new RegistryError(409, '같은 연결 키의 이벤트가 이미 기록되어 있습니다')
    await rebuildUnitProjection(tx, device.id, { guard: guardOf(device), illegal: retroIllegal })
    const updated = await getDeviceOr404(tx, device.id)
    return { event, device: updated, fromWardId: st.wardId, reason, warnings: p.warnings }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// replaceDevice — 교체 계약 (1)~(6) (§7.0 · §4.1-6 · §6.1 교체 폼)
// ─────────────────────────────────────────────────────────────────────────────

export interface ReplaceInput {
  oldDeviceId?: number | null
  oldSerial?: string | null
  /** 구기기 소급 등록(원장에 없음) 시 모델·병동 */
  oldDeviceInfoId?: number | null
  oldWardId?: number | null
  oldWardName?: string | null
  newSerial: string
  newDeviceInfoId?: number | null
  /** 신 기기 병동 — 생략 시 구 기기 병동 */
  toWardId?: number | null
  toWardName?: string | null
  /** 회수 사유 — 생략 시 value=DEFECT */
  reasonCodeId?: number | null
  /** (1) 신 시리얼이 타 병원 ACTIVE일 때만 유효 */
  newConflict?: 'TRANSFER' | null
}

export interface ReplaceResult {
  actionGroup: string
  /** (6) 구기기 소급 REGISTER */
  backfillEvent: EventRow | null
  /** 구기기 RECOVER — (3) 기회수면 null */
  recoverEvent: EventRow | null
  /** (1) 신 시리얼 이관 RECOVER(TRANSFER)@타 병원 */
  transferRecoverEvent: EventRow | null
  /** 신 기기 REGISTER — (5) 이미 이 병원 ACTIVE면 null */
  registerEvent: EventRow | null
  /** (5) 신 기기 병동 맞춤 MOVE_WARD */
  movedNewEvent: EventRow | null
  /** (3) 기존 구 RECOVER 이벤트에 related_device_id를 연결한 경우 그 id */
  linkedRecoverEventId: number | null
  oldDevice: DeviceRow
  newDevice: DeviceRow
  eventIds: number[]
  warnings: string[]
  wms: Record<number, WmsMatch | null>
}

export async function replaceDevice(ctx: RegistryCtx, input: ReplaceInput, opts?: RegistryOpts): Promise<ReplaceResult> {
  return withRegistryTx(opts, async (tx) => {
    const p = await prepareCtx(tx, ctx, { requireHospital: true })
    const here = p.hospitalCode!
    const warnings = [...p.warnings]
    const autoCreate = opts?.autoCreateWard ?? true
    const models = await loadTrackedModels(tx)
    const reason = input.reasonCodeId != null ? await requireRecoveryReason(tx, Number(input.reasonCodeId)) : await reasonByValue(tx, 'DEFECT')

    // ── 구 기기 식별
    let old: DeviceRow | null = null
    let oldKey: string
    let oldRaw: string | null = null
    if (input.oldDeviceId != null) {
      old = await getDeviceOr404(tx, Number(input.oldDeviceId))
      oldKey = old.serialNo
    } else {
      const ns = normalizeSerial(input.oldSerial)
      if (!ns.serialNo) throw new RegistryError(400, '구 기기 시리얼을 입력하세요')
      oldKey = ns.serialNo
      oldRaw = ns.serialRaw
      old = await tx.hospitalDevice.findUnique({ where: { serialNo: oldKey } })
    }
    const newNs = normalizeSerial(input.newSerial)
    if (!newNs.serialNo) throw new RegistryError(400, '신 기기 시리얼을 입력하세요')
    if (newNs.serialNo === oldKey) throw new RegistryError(400, '구 기기와 신 기기가 같습니다') // (4)
    let newDev = await tx.hospitalDevice.findUnique({ where: { serialNo: newNs.serialNo } })

    // ── 구 기기 분류 (2)(3)(6)
    type OldCase = 'backfill' | 'active_here' | 'recovered_here'
    let oldCase: OldCase
    let oldModel: TrackedModel | null = null
    let oldWard: WardRef | null = null
    let linkedRecover: EventRow | null = null
    let oldWardAtTime: number | null = null
    const oldEvents = old ? (await loadDeviceEvents(tx, [old.id])).get(old.id) ?? [] : []
    if (!old) {
      oldCase = 'backfill'
      const res = resolveModel(models, { serialNo: oldKey, deviceInfoId: input.oldDeviceInfoId ?? null })
      if (!res.model) throw new RegistryError(400, `구 기기 ${oldKey}: ${res.error}`)
      oldModel = res.model
      for (const w of res.warnings) warnings.push(`구 기기 ${oldKey}: ${w}`)
      oldWard = await resolveWardInput(tx, here, { wardId: input.oldWardId, wardName: input.oldWardName }, { autoCreate })
      oldWardAtTime = oldWard?.id ?? null
      warnings.push(`구 기기 ${oldKey}는 원장에 없어 업무일자로 소급 등록했습니다 (실제 설치일은 기록되지 않음)`)
    } else if (old.status === 'ACTIVE' && old.hospitalCode === here) {
      oldCase = 'active_here'
      const st = stateAt(oldEvents, p.occurredOn)
      assertTransition(st, 'RECOVER', here, { serial: old.serialNo })
      oldWardAtTime = st.wardId
    } else if (old.status === 'ACTIVE') {
      const name = (await hospitalNames(tx, [old.hospitalCode])).get(old.hospitalCode!) ?? old.hospitalCode
      throw new RegistryError(409, `구 기기가 ${name}에 배치 중 — 그 병원에서 회수(또는 이관) 기록 후 신 기기를 등록으로 처리하세요`) // (2)
    } else {
      if (old.lastHospitalCode !== here) throw new RegistryError(409, '구 기기가 이 병원에서 회수된 기기가 아닙니다 — 신 기기를 등록으로 처리하세요') // (3)
      const rec = ymd(old.recoveredOn)
      if (rec && p.occurredOn < rec) throw new RegistryError(400, `업무일자(${p.occurredOn})가 구 기기 회수일(${rec})보다 이릅니다`)
      oldCase = 'recovered_here'
      linkedRecover = [...sortEvents(oldEvents)].reverse().find((e) => e.eventType === 'RECOVER') ?? null
      oldWardAtTime = linkedRecover?.fromWardId ?? null
    }

    // ── 신 기기 병동(기본 구 병동)
    const toWard = await resolveWardInput(tx, here, { wardId: input.toWardId, wardName: input.toWardName }, { autoCreate })
    const targetWardId = toWard?.id ?? oldWardAtTime

    // ── 신 기기 분류 (1)(5)
    type NewCase = 'create' | 'reregister' | 'active_here' | 'transfer'
    let newCase: NewCase
    let newModel: TrackedModel | null = null
    const newEvents = newDev ? (await loadDeviceEvents(tx, [newDev.id])).get(newDev.id) ?? [] : []
    let transferFromWard: number | null = null
    if (!newDev) {
      newCase = 'create'
      const res = resolveModel(models, { serialNo: newNs.serialNo, deviceInfoId: input.newDeviceInfoId ?? null })
      if (!res.model) throw new RegistryError(400, `신 기기 ${newNs.serialNo}: ${res.error}`)
      newModel = res.model
      for (const w of res.warnings) warnings.push(`신 기기 ${newNs.serialNo}: ${w}`)
    } else if (newDev.status === 'ACTIVE' && newDev.hospitalCode === here) {
      newCase = 'active_here'
      warnings.push(`신 기기 ${newDev.serialNo}는 이미 이 병원에 등록된 기기 — 회수만 기록하고 병동을 맞춥니다`)
    } else if (newDev.status === 'ACTIVE') {
      if (input.newConflict !== 'TRANSFER') {
        throw new RegistryError(409, '타 병원에서 운용 중인 시리얼이 있습니다.', { conflicts: await buildConflicts(tx, [newDev]) })
      }
      newCase = 'transfer'
      const otherName = (await hospitalNames(tx, [newDev.hospitalCode])).get(newDev.hospitalCode!) ?? newDev.hospitalCode!
      transferFromWard = assertTransferConsistent(newDev, newEvents, p.occurredOn, otherName).wardId
    } else {
      newCase = 'reregister'
      assertReregisterConsistent(newDev, p.occurredOn)
      assertTransition(stateAt(newEvents, p.occurredOn), 'REGISTER', here, { serial: newDev.serialNo })
      warnings.push(`신 기기 ${newDev.serialNo}는 회수 이력이 있어 재등록으로 이력을 연결합니다`)
    }

    // ── 개체 행 생성 (이벤트가 아닌 행) — 이벤트 related_device_id에 id가 필요
    try {
      if (oldCase === 'backfill') {
        old = await tx.hospitalDevice.create({
          data: newDeviceData({ model: oldModel!, serialNo: oldKey, serialRaw: oldRaw, hospitalCode: here, wardId: oldWardAtTime, occurredOn: p.occurredOn }),
        })
      }
      if (newCase === 'create') {
        newDev = await tx.hospitalDevice.create({
          data: newDeviceData({ model: newModel!, serialNo: newNs.serialNo, serialRaw: newNs.serialRaw, hospitalCode: here, wardId: targetWardId, occurredOn: p.occurredOn }),
        })
      }
    } catch (e) {
      throw mapDbError(e)
    }
    const oldRow = old!
    const newRow = newDev!
    const oldSnapshot = oldCase === 'backfill' ? null : guardOf(oldRow)
    const newSnapshot = newCase === 'create' ? null : guardOf(newRow)

    // ── 이벤트 순서: REGISTER(구 소급) → RECOVER(구) → RECOVER TRANSFER(신) → REGISTER(신) | MOVE_WARD(신)
    const base = { occurredOn: p.occurredOn, ref: p.ref, actionGroup: p.actionGroup, source: p.source, actor: p.actor } as const
    const eventIds: number[] = []
    let backfillEvent: EventRow | null = null
    let recoverEvent: EventRow | null = null
    let transferRecoverEvent: EventRow | null = null
    let registerEvent: EventRow | null = null
    let movedNewEvent: EventRow | null = null
    let linkedRecoverEventId: number | null = null

    if (oldCase === 'backfill') {
      backfillEvent = await insertEvent(tx, { ...base, deviceId: oldRow.id, eventType: 'REGISTER', hospitalCode: here, toWardId: oldWardAtTime, memo: '교체 시 소급 등록' })
      eventIds.push(backfillEvent!.id)
    }
    if (oldCase !== 'recovered_here') {
      recoverEvent = await insertEvent(tx, {
        ...base,
        deviceId: oldRow.id,
        eventType: 'RECOVER',
        hospitalCode: here,
        fromWardId: oldWardAtTime,
        reasonCodeId: reason.id,
        relatedDeviceId: newRow.id,
        memo: p.memo,
      })
      eventIds.push(recoverEvent!.id)
    } else if (linkedRecover) {
      await tx.hospitalDeviceEvent.update({ where: { id: linkedRecover.id }, data: { relatedDeviceId: newRow.id } })
      linkedRecoverEventId = linkedRecover.id
    }
    if (newCase === 'transfer') {
      const transferReason = await reasonByValue(tx, 'TRANSFER')
      transferRecoverEvent = await insertEvent(tx, {
        ...base,
        deviceId: newRow.id,
        eventType: 'RECOVER',
        hospitalCode: newRow.hospitalCode,
        fromWardId: transferFromWard,
        reasonCodeId: transferReason.id,
        memo: p.memo,
      })
      eventIds.push(transferRecoverEvent!.id)
    }
    if (newCase === 'active_here') {
      if (targetWardId != null && newRow.wardId !== targetWardId) {
        const st = stateAt(newEvents, p.occurredOn)
        assertTransition(st, 'MOVE_WARD', here, { serial: newRow.serialNo })
        movedNewEvent = await insertEvent(tx, { ...base, deviceId: newRow.id, eventType: 'MOVE_WARD', hospitalCode: here, fromWardId: st.wardId, toWardId: targetWardId, memo: p.memo })
        eventIds.push(movedNewEvent!.id)
      }
    } else {
      registerEvent = await insertEvent(tx, { ...base, deviceId: newRow.id, eventType: 'REGISTER', hospitalCode: here, toWardId: targetWardId, relatedDeviceId: oldRow.id, memo: p.memo })
      eventIds.push(registerEvent!.id)
    }

    // ── 프로젝션 재계산 (기존 행은 가드, 새 행은 fold 그대로)
    await rebuildUnitProjection(tx, oldRow.id, { guard: oldSnapshot ?? undefined, illegal: retroIllegal })
    await rebuildUnitProjection(tx, newRow.id, { guard: newSnapshot ?? undefined, illegal: retroIllegal })

    // ── WMS 조인 키
    const wmsMap = await matchInventoryUnits(tx, [toWmsInput(newRow, models), ...(oldCase === 'backfill' ? [toWmsInput(oldRow, models)] : [])], { persist: true })

    return {
      actionGroup: p.actionGroup,
      backfillEvent,
      recoverEvent,
      transferRecoverEvent,
      registerEvent,
      movedNewEvent,
      linkedRecoverEventId,
      oldDevice: await getDeviceOr404(tx, oldRow.id),
      newDevice: await getDeviceOr404(tx, newRow.id),
      eventIds,
      warnings,
      wms: Object.fromEntries(Array.from(wmsMap.entries())),
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// bulkDeviceAction — 일괄 이동/회수 (§7.1 bulk 행: 같은 병원 ACTIVE만, 단일 tx)
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkInput {
  action: 'MOVE_WARD' | 'RECOVER'
  deviceIds: number[]
  toWardId?: number | null
  toWardName?: string | null
  reasonCodeId?: number | null
}

export interface BulkResult {
  actionGroup: string
  events: EventRow[]
  eventIds: number[]
  skipped: SkippedItem[]
  affectedDeviceIds: number[]
  warnings: string[]
}

export const BULK_MAX = 2000

export async function bulkDeviceAction(ctx: RegistryCtx, input: BulkInput, opts?: RegistryOpts): Promise<BulkResult> {
  return withRegistryTx(opts, async (tx) => {
    if (input.action !== 'MOVE_WARD' && input.action !== 'RECOVER') throw new RegistryError(400, '일괄 액션은 MOVE_WARD 또는 RECOVER만 가능합니다')
    const p = await prepareCtx(tx, ctx, { requireHospital: true })
    const here = p.hospitalCode!
    const ids = uniqInts(input.deviceIds ?? [])
    if (ids.length === 0) throw new RegistryError(400, '대상 기기를 선택하세요')
    if (ids.length > BULK_MAX) throw new RegistryError(400, `일괄 처리는 최대 ${BULK_MAX}대까지 가능합니다`)

    const devices = await tx.hospitalDevice.findMany({ where: { id: { in: ids } } })
    if (devices.length !== ids.length) throw new RegistryError(404, `기기 ${ids.length - devices.length}건을 찾을 수 없습니다`)
    const notHere = devices.filter((d) => !(d.status === 'ACTIVE' && d.hospitalCode === here))
    if (notHere.length > 0) {
      const sample = notHere.slice(0, 5).map((d) => d.serialNo).join(', ')
      throw new RegistryError(409, `선택에 이 병원 배치 중이 아닌 기기 ${notHere.length}대가 있습니다 — ${sample}${notHere.length > 5 ? ' 외' : ''}`)
    }

    let toWard: WardRef | null = null
    let reasonId: number | null = null
    let targets = devices
    const skipped: SkippedItem[] = []
    if (input.action === 'MOVE_WARD') {
      toWard = await resolveWardInput(tx, here, { wardId: input.toWardId, wardName: input.toWardName }, { autoCreate: opts?.autoCreateWard ?? true })
      if (!toWard) throw new RegistryError(400, '이동할 병동을 지정하세요')
      for (const d of devices) if (d.wardId === toWard.id) skipped.push({ deviceId: d.id, serialNo: d.serialNo, reason: '이미 해당 병동에 배치 중' })
      targets = devices.filter((d) => d.wardId !== toWard!.id)
      if (targets.length === 0) throw new RegistryError(409, '선택한 기기가 모두 이미 해당 병동에 있습니다', { skipped })
    } else {
      reasonId = (await requireRecoveryReason(tx, input.reasonCodeId == null ? null : Number(input.reasonCodeId))).id
    }

    const eventsMap = await loadDeviceEvents(tx, targets.map((d) => d.id))
    const inputs: EventInput[] = []
    const applied: DeviceRow[] = []
    for (const d of targets) {
      const st = stateAt(eventsMap.get(d.id) ?? [], p.occurredOn)
      assertTransition(st, input.action as DeviceEventType, here, { serial: d.serialNo })
      // 소급 입력: 업무일자 시점에 이미 대상 병동이면 skip (현재 프로젝션 기준 skip과 동일 규약)
      if (input.action === 'MOVE_WARD' && st.wardId === toWard!.id) {
        skipped.push({ deviceId: d.id, serialNo: d.serialNo, reason: `업무일자(${p.occurredOn}) 시점에 이미 해당 병동에 배치 중` })
        continue
      }
      applied.push(d)
      inputs.push({
        deviceId: d.id,
        eventType: input.action,
        hospitalCode: here,
        fromWardId: st.wardId,
        toWardId: input.action === 'MOVE_WARD' ? toWard!.id : null,
        reasonCodeId: reasonId,
        occurredOn: p.occurredOn,
        memo: p.memo,
        ref: p.ref,
        actionGroup: p.actionGroup,
        source: p.source,
        actor: p.actor,
      })
    }
    if (applied.length === 0) throw new RegistryError(409, '선택한 기기가 모두 이미 해당 병동에 있습니다', { skipped })
    const events = await insertEvents(tx, inputs)
    for (const d of applied) {
      await rebuildUnitProjection(tx, d.id, {
        guard: guardOf(d),
        illegal: (ev) => new RegistryError(409, `${d.serialNo}: 이 일자에 기록하면 이후 이벤트(${eventLabel(ev)})가 성립하지 않습니다`),
      })
    }
    return { actionGroup: p.actionGroup, events, eventIds: events.map((e) => e.id), skipped, affectedDeviceIds: applied.map((d) => d.id), warnings: p.warnings }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// correctDevice — 식별 속성 정정 → CORRECT 이벤트 (§8.2)
// ─────────────────────────────────────────────────────────────────────────────

export interface CorrectChanges {
  deviceInfoId?: number | null
  serialNo?: string | null
  macAddress?: string | null
  extDeviceCode?: string | null
}

export type ChangeSet = Record<string, { before: unknown; after: unknown }>

export interface CorrectResult {
  event: EventRow
  device: DeviceRow
  changes: ChangeSet
  wms: WmsMatch | null
}

export async function correctDevice(ctx: RegistryCtx, input: { deviceId: number; changes: CorrectChanges }, opts?: RegistryOpts): Promise<CorrectResult> {
  return withRegistryTx(opts, async (tx) => {
    const device = await getDeviceOr404(tx, input.deviceId)
    const p = await prepareCtx(tx, { ...ctx, hospitalCode: ctx.hospitalCode ?? device.hospitalCode }, { requireHospital: false })
    const models = await loadTrackedModels(tx)
    const ch = input.changes ?? {}
    const changes: ChangeSet = {}
    const data: Prisma.HospitalDeviceUncheckedUpdateInput = {}
    let serialChanged = false

    if (ch.serialNo !== undefined) {
      const ns = normalizeSerial(ch.serialNo)
      if (!ns.serialNo) throw new RegistryError(400, '시리얼이 비어 있습니다')
      if (ns.serialNo !== device.serialNo || (ns.serialRaw ?? null) !== (device.serialRaw ?? null)) {
        const events = (await loadDeviceEvents(tx, [device.id])).get(device.id) ?? []
        const stateEvents = events.filter((e) => e.eventType !== 'CORRECT')
        const sole = stateEvents.length === 1 && stateEvents[0].eventType === 'REGISTER' && device.status === 'ACTIVE' && stateEvents[0].hospitalCode === device.hospitalCode
        if (!sole) throw new RegistryError(409, '이력이 있는 개체 — 오입력이면 이벤트 취소를 사용하세요')
        if (ns.serialNo !== device.serialNo) {
          const dup = await tx.hospitalDevice.findUnique({ where: { serialNo: ns.serialNo }, select: { id: true } })
          if (dup) throw new RegistryError(409, '이미 등록된 시리얼입니다')
          changes.serialNo = { before: device.serialNo, after: ns.serialNo }
          data.serialNo = ns.serialNo
        }
        if ((ns.serialRaw ?? null) !== (device.serialRaw ?? null)) {
          changes.serialRaw = { before: device.serialRaw, after: ns.serialRaw }
          data.serialRaw = ns.serialRaw
        }
        serialChanged = true
        data.inventoryUnitId = null
      }
    }
    if (ch.deviceInfoId !== undefined && ch.deviceInfoId !== null) {
      const id = Number(ch.deviceInfoId)
      if (!models.some((m) => m.id === id)) throw new RegistryError(400, '원장 대상 모델이 아닙니다 (serial_tracked)')
      if (id !== device.deviceInfoId) {
        changes.deviceInfoId = { before: device.deviceInfoId, after: id }
        data.deviceInfoId = id
      }
    }
    if (ch.macAddress !== undefined) {
      const v = ch.macAddress?.trim() || null
      if (v !== (device.macAddress ?? null)) {
        changes.macAddress = { before: device.macAddress, after: v }
        data.macAddress = v
      }
    }
    if (ch.extDeviceCode !== undefined) {
      const v = ch.extDeviceCode?.trim() || null
      if (v !== (device.extDeviceCode ?? null)) {
        changes.extDeviceCode = { before: device.extDeviceCode, after: v }
        data.extDeviceCode = v
      }
    }
    if (Object.keys(changes).length === 0) throw new RegistryError(400, '변경 사항이 없습니다')

    try {
      await tx.hospitalDevice.update({ where: { id: device.id }, data })
    } catch (e) {
      throw mapDbError(e)
    }
    const event = await insertEvent(tx, {
      deviceId: device.id,
      eventType: 'CORRECT',
      hospitalCode: device.hospitalCode,
      occurredOn: p.occurredOn,
      memo: p.memo,
      ref: p.ref,
      actionGroup: p.actionGroup,
      source: p.source,
      changes: changes as unknown as Prisma.InputJsonValue,
      actor: p.actor,
    })
    const updated = await getDeviceOr404(tx, device.id)
    let wms: WmsMatch | null = null
    if (serialChanged || updated.inventoryUnitId == null) {
      const m = await matchInventoryUnits(tx, [toWmsInput(updated, models)], { persist: true })
      wms = m.get(updated.id) ?? null
    }
    return { event: event!, device: await getDeviceOr404(tx, device.id), changes, wms }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// updateDeviceMemo — 개체 속성(이벤트 아님)
// ─────────────────────────────────────────────────────────────────────────────

export async function updateDeviceMemo(
  ctx: RegistryCtx,
  input: { deviceId: number; memo: string | null },
  opts?: RegistryOpts
): Promise<{ device: DeviceRow; before: string | null; after: string | null }> {
  void ctx
  return withRegistryTx(opts, async (tx) => {
    const device = await getDeviceOr404(tx, input.deviceId)
    const after = input.memo != null && String(input.memo).trim() ? String(input.memo).trim() : null
    if (after && after.length > 500) throw new RegistryError(400, '메모는 500자 이내로 입력하세요')
    const updated = await tx.hospitalDevice.update({ where: { id: device.id }, data: { memo: after } })
    return { device: updated, before: device.memo, after }
  })
}

