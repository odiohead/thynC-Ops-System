/**
 * 유닛 상태(condition)·위치(location) 축 — projects/device_condition_location_design.md §4·§7.0·§8.2 (2026-09-17, B-26~B-37)
 *
 * 3축: ① 배치(hospital_devices — 이벤트 fold, 불변) / ② 상태 `device_units.condition` / ③ 위치 `device_units.location_hospital_code | location_site_id`.
 * ②③은 fold 파생값이 아니라 **유닛 속성**(B-26 — HDR 불변식 1·3 명시 예외): 직접 갱신(낙관 가드) + 스냅샷 이벤트(`changes.condition/location` before/after, 값이 같아도 기록 — B-28).
 *
 * 쓰기 순서 두 모드(§4.1 — 순서 변경 금지):
 *  1. 신규 4 서비스(intake·repair·scrap·move) `applyUnitState`: 유닛 조회 → 배치 축 판정(`assertTransition`, SAME/OTHER는 호출부 ctx.hospitalCode 기준) → condition 판정(§4.2 표)
 *     → prepareCtx·validateRef → 가드 updateMany(count≠1 → 409 RegistryError, **쓰기 없음** — AS 서비스가 경고로 흡수 가능) → insertEvent(스냅샷).
 *  2. 기존 함수에 얹는 암묵 전이(REGISTER·RECOVER·AS_OPEN·AS_CLEAR) `applyImplicitTransition`: 2-phase `{ changes, apply() }` —
 *     검증 통과 직후 changes 계산(이벤트 행에 실림) → 호출부 insert·rebuild(guard) → `apply()` 가드 UPDATE. 실패는 `RegistryTxAbort`(tx 전체 실패, 흡수 불가).
 *
 * 공통 규약(§7.0): 조회는 `getUnitOr404`(배치 무관 — 배치 없는 유닛 허용). 이벤트 hospital_code = 배치 병원 ?? last_hospital_code ?? null(B-31).
 * `validateRef`의 '다른 병원' 경고는 배치 RECOVERED/없음일 때 억제. 호출부는 `ctx.actionGroup`을 넘기지 않는다(REGISTER 그룹 합류 시 LIFO 취소 확장에 휘말림).
 * 취소·재도출(§8.2): `assertNoLaterSnapshot`(id 순 단일 정렬), `restoreUnitStateBefore`(신규 4종·상태 CORRECT 취소), `rederiveUnitState`(배치 축 이벤트 취소 후 ①②③).
 */
import { Prisma } from '@prisma/client'
import {
  DEVICE_CONDITION_LABELS,
  DEVICE_CONCURRENT_CHANGE_MESSAGE,
  DEVICE_LOCATION_NOTE_INTAKE_UNCONFIRMED,
  DEVICE_OPEN_INTAKE_LINE_MESSAGE,
  DEVICE_REPAIR_IN_USE_MESSAGE,
  DEVICE_SCRAP_ACTIVE_MESSAGE,
  DEVICE_SCRAPPED_REGISTER_MESSAGE,
  DEVICE_SITE_CATEGORY,
  DEVICE_SITE_VALUES,
  DEVICE_SNAPSHOT_EVENT_TYPES,
  RECOVERY_REASON_CONDITION,
  deviceConditionLabel,
  isDeviceSiteValue,
  isSnapshotEvent,
  unitStateChangesOf,
  type DeviceCondition,
  type DeviceLocationSnapshot,
  type DeviceSiteValue,
  type DeviceUnitStateChanges,
  type RecoveryReasonValue,
} from '@/lib/deviceRegistryShared'
import {
  RegistryError,
  RegistryTxAbort,
  assertTransition,
  eventLabel,
  getUnitOr404,
  insertEvent,
  prepareCtx,
  withRegistryTx,
  ymd,
  ymdToDate,
  type DbClient,
  type DeviceSiteRef,
  type EventInput,
  type EventRow,
  type PlacementRow,
  type PreparedCtx,
  type RegistryCtx,
  type RegistryOpts,
  type UnitRow,
} from './core'

// ─────────────────────────────────────────────────────────────────────────────
// 스냅샷 형상 · 거점 마스터 · 유닛 ↔ 스냅샷 변환
// ─────────────────────────────────────────────────────────────────────────────

/** 상태·위치 축 읽기 소스 — 유닛 원행(`UnitRow`) 또는 평탄화 `DeviceRow` 모두 만족(id는 유닛 id) */
export type UnitStateSource = Pick<UnitRow, 'id' | 'serialNo' | 'condition' | 'locationHospitalCode' | 'locationSiteId'> & { locationSite?: DeviceSiteRef | null }

/** 유닛의 상태·위치 한 시점 값 — 이벤트 `changes`의 before/after 단위 */
export interface UnitStateSnapshot {
  condition: DeviceCondition | null
  location: DeviceLocationSnapshot
}

export const NO_LOCATION: DeviceLocationSnapshot = { kind: null, code: null }

export function locationEquals(a: DeviceLocationSnapshot, b: DeviceLocationSnapshot): boolean {
  return (a.kind ?? null) === (b.kind ?? null) && (a.code ?? null) === (b.code ?? null)
}

export function unitStateEquals(a: UnitStateSnapshot, b: UnitStateSnapshot): boolean {
  return (a.condition ?? null) === (b.condition ?? null) && locationEquals(a.location, b.location)
}

/** `changes` 빌더(B-28) — 값이 같아도 before/after를 모두 싣는다. `note`는 A-4(a) '입고 미확인' */
export function buildUnitStateChanges(before: UnitStateSnapshot, after: UnitStateSnapshot, note?: string | null): DeviceUnitStateChanges {
  return {
    condition: { before: before.condition ?? null, after: after.condition ?? null },
    location: {
      before: { kind: before.location.kind ?? null, code: before.location.code ?? null },
      after: { kind: after.location.kind ?? null, code: after.location.code ?? null },
      ...(note ? { note } : {}),
    },
  }
}

export async function loadDeviceSites(client: DbClient): Promise<DeviceSiteRef[]> {
  return client.statusCode.findMany({ where: { category: DEVICE_SITE_CATEGORY }, select: { id: true, name: true, value: true }, orderBy: [{ order: 'asc' }, { id: 'asc' }] })
}

/** 거점 value(REFRESH_CENTER/HUB) → 마스터 행. 마스터에 없으면 400(설정 UI 없음 — seed·마이그 INSERT) */
export async function siteByValue(client: DbClient, value: string): Promise<DeviceSiteRef> {
  if (!isDeviceSiteValue(value)) throw new RegistryError(400, `거점 값이 올바르지 않습니다 (${DEVICE_SITE_VALUES.join('/')})`)
  const r = await client.statusCode.findFirst({ where: { category: DEVICE_SITE_CATEGORY, value }, select: { id: true, name: true, value: true }, orderBy: { order: 'asc' } })
  if (!r) throw new RegistryError(400, `거점 마스터에 ${value} 값이 없습니다 — seed-device-registry.sql을 실행하세요`)
  return r
}

export async function siteById(client: DbClient, id: number): Promise<DeviceSiteRef | null> {
  return client.statusCode.findFirst({ where: { id, category: DEVICE_SITE_CATEGORY }, select: { id: true, name: true, value: true } })
}

/** 유닛 원행 → 스냅샷(non-undefined — Prisma where에서 `undefined`는 생략되므로 반드시 이 값으로 가드한다) */
export async function unitStateOf(client: DbClient, unit: UnitStateSource): Promise<UnitStateSnapshot> {
  const condition = (unit.condition ?? null) as DeviceCondition | null
  if (unit.locationHospitalCode) return { condition, location: { kind: 'HOSPITAL', code: unit.locationHospitalCode } }
  if (unit.locationSiteId != null) {
    const site = unit.locationSite ?? (await siteById(client, unit.locationSiteId))
    return { condition, location: { kind: 'SITE', code: site?.value ?? null } }
  }
  return { condition, location: { ...NO_LOCATION } }
}

/** 위치 스냅샷 → 유닛 2컬럼(SITE는 value → id) */
export async function locationColumns(client: DbClient, loc: DeviceLocationSnapshot): Promise<{ locationHospitalCode: string | null; locationSiteId: number | null }> {
  if (loc.kind === 'HOSPITAL' && loc.code) return { locationHospitalCode: loc.code, locationSiteId: null }
  if (loc.kind === 'SITE' && loc.code) return { locationHospitalCode: null, locationSiteId: (await siteByValue(client, loc.code)).id }
  return { locationHospitalCode: null, locationSiteId: null }
}

// ─────────────────────────────────────────────────────────────────────────────
// condition × 이벤트 전이표 (§4.2) — 코드 표 1개 + 판정 함수 1개
// ─────────────────────────────────────────────────────────────────────────────

/** 판정 축의 이벤트 종류 — RECOVER는 사유 value별로 갈린다(§5.6 RECOVERY_REASON_CONDITION) */
export type UnitEventKind =
  | 'REGISTER'
  | 'AS_OPEN'
  | 'INTAKE'
  | 'REPAIR_DONE'
  | 'AS_CLEAR'
  | 'RECOVER_DEFECT'
  | 'RECOVER_LOST'
  | 'RECOVER_DISPOSE'
  | 'RECOVER_KEEP' // RETURN·데모 종료·기타(value NULL)
  | 'RECOVER_TRANSFER'
  | 'SCRAP'
  | 'SITE_MOVE'

export type ConditionRule = { kind: 'ok'; to: DeviceCondition } | { kind: 'keep' } | { kind: 'reject'; message: string }

const ok = (to: DeviceCondition): ConditionRule => ({ kind: 'ok', to })
const keep: ConditionRule = { kind: 'keep' }
const reject = (message: string): ConditionRule => ({ kind: 'reject', message })
const noRepair = (c: DeviceCondition) => reject(c === 'IN_USE' ? DEVICE_REPAIR_IN_USE_MESSAGE : `${DEVICE_CONDITION_LABELS[c]} 기기는 수리완료 처리할 수 없습니다`)
const scrapped = (what: string) => reject(`폐기된 기기입니다 — 정정 후 ${what}하세요`)
const lost = (what: string) => reject(`분실 기기는 ${what}할 수 없습니다 — 발견 시 재등록 또는 입고로 처리하세요`)

/**
 * §4.2 표 그대로. `—`(배치 축 ①에서 도달 불가) 셀은 배치 축 판정이 먼저 막으므로 여기서는 방어적으로 reject.
 * NULL(미확인) 행은 배포 창(백필 전)·재도출 유닛에서 도달한다.
 * PRE_SHIP × INTAKE는 표의 '—'와 달리 진입 열("INTAKE(IN_USE·NULL·LOST·PRE_SHIP…)")대로 ok→AS_WAITING(배치 NONE에서 INTAKE는 ①ok — 도달 가능).
 */
export const CONDITION_TRANSITIONS: Record<DeviceCondition | 'NULL', Record<UnitEventKind, ConditionRule>> = {
  IN_USE: {
    REGISTER: ok('IN_USE'), AS_OPEN: ok('AS_WAITING'), INTAKE: ok('AS_WAITING'), REPAIR_DONE: noRepair('IN_USE'), AS_CLEAR: keep,
    RECOVER_DEFECT: ok('AS_WAITING'), RECOVER_LOST: ok('LOST'), RECOVER_DISPOSE: ok('SCRAPPED'), RECOVER_KEEP: keep, RECOVER_TRANSFER: keep,
    SCRAP: ok('SCRAPPED'), SITE_MOVE: keep,
  },
  AS_WAITING: {
    REGISTER: ok('IN_USE'), AS_OPEN: keep, INTAKE: keep, REPAIR_DONE: ok('REPAIRED'), AS_CLEAR: ok('IN_USE'),
    RECOVER_DEFECT: keep, RECOVER_LOST: ok('LOST'), RECOVER_DISPOSE: ok('SCRAPPED'), RECOVER_KEEP: keep, RECOVER_TRANSFER: keep,
    SCRAP: ok('SCRAPPED'), SITE_MOVE: keep,
  },
  REPAIRED: {
    REGISTER: ok('IN_USE'), AS_OPEN: ok('AS_WAITING'), INTAKE: ok('AS_WAITING') /* 새 ref(재입고). 같은 ref는 judgeCondition이 keep */, REPAIR_DONE: keep, AS_CLEAR: ok('IN_USE'),
    RECOVER_DEFECT: keep, RECOVER_LOST: ok('LOST'), RECOVER_DISPOSE: ok('SCRAPPED'), RECOVER_KEEP: keep, RECOVER_TRANSFER: keep,
    SCRAP: ok('SCRAPPED'), SITE_MOVE: keep,
  },
  PRE_SHIP: {
    REGISTER: ok('IN_USE'), AS_OPEN: reject('출고 전 기기입니다'), INTAKE: ok('AS_WAITING'), REPAIR_DONE: noRepair('PRE_SHIP'), AS_CLEAR: reject('출고 전 기기입니다'),
    RECOVER_DEFECT: reject('출고 전 기기입니다'), RECOVER_LOST: reject('출고 전 기기입니다'), RECOVER_DISPOSE: reject('출고 전 기기입니다'), RECOVER_KEEP: reject('출고 전 기기입니다'), RECOVER_TRANSFER: reject('출고 전 기기입니다'),
    SCRAP: ok('SCRAPPED'), SITE_MOVE: keep,
  },
  LOST: {
    REGISTER: ok('IN_USE'), AS_OPEN: lost('AS 접수'), INTAKE: ok('AS_WAITING'), REPAIR_DONE: noRepair('LOST'), AS_CLEAR: lost('AS 해제'),
    RECOVER_DEFECT: lost('회수'), RECOVER_LOST: lost('회수'), RECOVER_DISPOSE: lost('회수'), RECOVER_KEEP: lost('회수'), RECOVER_TRANSFER: lost('회수'),
    SCRAP: lost('폐기'), SITE_MOVE: lost('위치 이동'),
  },
  SCRAPPED: {
    REGISTER: reject(DEVICE_SCRAPPED_REGISTER_MESSAGE), AS_OPEN: scrapped('처리'), INTAKE: scrapped('입고'), REPAIR_DONE: noRepair('SCRAPPED'), AS_CLEAR: scrapped('처리'),
    RECOVER_DEFECT: scrapped('처리'), RECOVER_LOST: scrapped('처리'), RECOVER_DISPOSE: scrapped('처리'), RECOVER_KEEP: scrapped('처리'), RECOVER_TRANSFER: scrapped('처리'),
    SCRAP: keep, SITE_MOVE: scrapped('위치 이동'),
  },
  NULL: {
    REGISTER: ok('IN_USE'), AS_OPEN: ok('AS_WAITING'), INTAKE: ok('AS_WAITING'), REPAIR_DONE: ok('REPAIRED'), AS_CLEAR: ok('IN_USE'),
    RECOVER_DEFECT: ok('AS_WAITING'), RECOVER_LOST: ok('LOST'), RECOVER_DISPOSE: ok('SCRAPPED'), RECOVER_KEEP: keep, RECOVER_TRANSFER: keep,
    SCRAP: ok('SCRAPPED'), SITE_MOVE: keep,
  },
}

/** 회수 사유 value → 판정 축 이벤트 종류(§5.6). RETURN·TRANSFER 외 value NULL(데모·기타)은 KEEP */
export function recoverKindOf(reasonValue: string | null | undefined): UnitEventKind {
  if (reasonValue === 'TRANSFER') return 'RECOVER_TRANSFER'
  const mapped = reasonValue && (reasonValue as RecoveryReasonValue) in RECOVERY_REASON_CONDITION ? RECOVERY_REASON_CONDITION[reasonValue as RecoveryReasonValue] : undefined
  if (mapped === 'AS_WAITING') return 'RECOVER_DEFECT'
  if (mapped === 'LOST') return 'RECOVER_LOST'
  if (mapped === 'SCRAPPED') return 'RECOVER_DISPOSE'
  return 'RECOVER_KEEP'
}

/**
 * condition 축 판정 — 표 1곳(§4.2). `sameRef`: INTAKE에서 같은 (ref, device, INTAKE)가 이미 있을 때(REPAIRED 행 '같은 ref: keep' — B-37).
 */
export function judgeCondition(current: DeviceCondition | null, kind: UnitEventKind, opts?: { sameRef?: boolean }): ConditionRule {
  if (kind === 'INTAKE' && current === 'REPAIRED' && opts?.sameRef) return keep
  return CONDITION_TRANSITIONS[current ?? 'NULL'][kind]
}

/** 판정 → 다음 condition (reject는 409) */
function nextCondition(current: DeviceCondition | null, kind: UnitEventKind, opts?: { sameRef?: boolean; serial?: string | null }): DeviceCondition | null {
  const rule = judgeCondition(current, kind, opts)
  if (rule.kind === 'reject') throw new RegistryError(409, opts?.serial ? `${opts.serial}: ${rule.message}` : rule.message, opts?.serial ? { serial: opts.serial } : undefined)
  return rule.kind === 'ok' ? rule.to : current
}

/**
 * 위치 규칙(§4.2 '위치 규칙' 열 + 각주 ⁴⁵) — condition 판정 뒤에 적용.
 * keep 계열에서 before 위치가 NULL이면 배치 병원(ACTIVE)으로 채운다(배포 창 location NULL 잔존 방지 — 각주 ⁵).
 * LOST/SCRAPPED로 가면 위치는 항상 NULL(I-1).
 */
function nextLocation(
  kind: UnitEventKind,
  before: DeviceLocationSnapshot,
  after: DeviceCondition | null,
  o: { placementHospital: string | null; site?: DeviceSiteValue; to?: DeviceLocationSnapshot; locationToHospital?: boolean }
): { location: DeviceLocationSnapshot; note?: string } {
  if (after === 'LOST' || after === 'SCRAPPED') return { location: { ...NO_LOCATION } }
  const hospital = (): DeviceLocationSnapshot => (o.placementHospital ? { kind: 'HOSPITAL', code: o.placementHospital } : { ...before })
  const keepLoc = (): DeviceLocationSnapshot => (before.kind == null && o.placementHospital ? { kind: 'HOSPITAL', code: o.placementHospital } : { ...before })
  switch (kind) {
    case 'REGISTER':
      return { location: hospital() }
    case 'INTAKE':
      return { location: { kind: 'SITE', code: o.site ?? 'REFRESH_CENTER' } }
    case 'RECOVER_DEFECT': {
      // A-4(a): D4 계승 — RECOVER 행 스냅샷에 위치 after=리프레시센터, before가 병원일 때만 note '입고 미확인'(이미 센터면 note 없음). INTAKE는 만들지 않는다
      const note = before.kind === 'HOSPITAL' ? DEVICE_LOCATION_NOTE_INTAKE_UNCONFIRMED : undefined
      return { location: { kind: 'SITE', code: 'REFRESH_CENTER' }, ...(note ? { note } : {}) }
    }
    case 'RECOVER_LOST':
    case 'RECOVER_DISPOSE':
    case 'SCRAP':
      return { location: { ...NO_LOCATION } }
    case 'AS_CLEAR':
      return { location: o.locationToHospital ? hospital() : keepLoc() }
    case 'SITE_MOVE':
      return { location: o.to ? { ...o.to } : keepLoc() }
    case 'AS_OPEN':
    case 'REPAIR_DONE':
    case 'RECOVER_KEEP':
    case 'RECOVER_TRANSFER':
    default:
      return { location: keepLoc() }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 배치 축 판정·문맥 (§7.0 공통 규약)
// ─────────────────────────────────────────────────────────────────────────────

export function placementStateOf(p: PlacementRow | null): { status: 'ACTIVE' | 'RECOVERED' | null; hospitalCode: string | null } {
  return { status: (p?.status as 'ACTIVE' | 'RECOVERED' | undefined) ?? null, hospitalCode: p?.hospitalCode ?? null }
}

/** 이벤트 hospital_code — ACTIVE면 배치 병원, RECOVERED면 last_hospital_code, 없으면 null(B-31) */
export function eventHospitalOf(p: PlacementRow | null): string | null {
  return p?.hospitalCode ?? p?.lastHospitalCode ?? null
}

/** 신규 4 서비스 공용 문맥 — hospitalCode는 배치 병원 ?? last_hospital_code(검증 없음), ref '다른 병원' 경고는 배치 RECOVERED/없음일 때 억제 */
async function prepareUnitCtx(tx: DbClient, ctx: RegistryCtx, placement: PlacementRow | null): Promise<PreparedCtx> {
  return prepareCtx(tx, { ...ctx, hospitalCode: eventHospitalOf(placement), actionGroup: null }, { requireHospital: false, suppressRefHospitalWarning: placement?.status !== 'ACTIVE' })
}

/** 배치 축 판정(①) — SAME/OTHER는 호출부 ctx.hospitalCode(접수 병원)와 배치 병원 비교, 없으면 배치 병원(=SAME) */
function assertPlacementAxis(ctx: RegistryCtx, placement: PlacementRow | null, eventType: 'INTAKE' | 'REPAIR_DONE' | 'SCRAP' | 'SITE_MOVE', serial: string) {
  assertTransition(placementStateOf(placement), eventType, ctx.hospitalCode ?? placement?.hospitalCode ?? null, { serial })
}

// ─────────────────────────────────────────────────────────────────────────────
// applyUnitState — 쓰기 순서 1 (가드 → 이벤트)
// ─────────────────────────────────────────────────────────────────────────────

export interface ApplyUnitStateInput {
  unit: UnitStateSource
  before: UnitStateSnapshot
  after: UnitStateSnapshot
  /** A-4(a) `changes.location.note` */
  note?: string | null
  /** 업무일자 — changed_on */
  occurredOn: string
  /** 변화가 없어도 이벤트를 남긴다(INTAKE B-37 첫 ref) */
  forceRecord?: boolean
  /** 이벤트 행(deviceId·changes·occurredOn 제외) */
  event: Omit<EventInput, 'deviceId' | 'changes' | 'occurredOn'>
}

export interface ApplyUnitStateResult {
  changed: boolean
  /** 기록된 이벤트(스킵이면 null) */
  event: EventRow | null
  before: UnitStateSnapshot
  after: UnitStateSnapshot
}

/**
 * §4.1 쓰기 순서 1 — 변화 없으면(`forceRecord` 아님) `{ changed:false }`·이벤트 없음(멱등).
 * 가드 `updateMany({ id, condition: before, location_hospital_code: before, location_site_id: before })` count≠1이면 **아무 쓰기 없이** 409 RegistryError.
 */
export async function applyUnitState(tx: DbClient, input: ApplyUnitStateInput): Promise<ApplyUnitStateResult> {
  const { unit, before, after } = input
  const changed = !unitStateEquals(before, after)
  if (!changed && !input.forceRecord) return { changed: false, event: null, before, after }
  const beforeCols = { locationHospitalCode: unit.locationHospitalCode ?? null, locationSiteId: unit.locationSiteId ?? null }
  const afterCols = await locationColumns(tx, after.location)
  const condChanged = (before.condition ?? null) !== (after.condition ?? null)
  const locChanged = !locationEquals(before.location, after.location)
  const res = await tx.deviceUnit.updateMany({
    where: { id: unit.id, condition: before.condition ?? null, locationHospitalCode: beforeCols.locationHospitalCode, locationSiteId: beforeCols.locationSiteId },
    data: {
      condition: after.condition ?? null,
      ...afterCols,
      ...(condChanged ? { conditionChangedOn: ymdToDate(input.occurredOn) } : {}),
      ...(locChanged ? { locationChangedOn: ymdToDate(input.occurredOn) } : {}),
    },
  })
  if (res.count !== 1) throw new RegistryError(409, DEVICE_CONCURRENT_CHANGE_MESSAGE, { serial: unit.serialNo })
  const event = await insertEvent(tx, {
    ...input.event,
    deviceId: unit.id,
    occurredOn: input.occurredOn,
    changes: buildUnitStateChanges(before, after, input.note) as unknown as Prisma.InputJsonValue,
  })
  // 유닛 가드 UPDATE 뒤의 실패는 tx 전체 실패(§4.1 '흡수되는 409는 유닛 쓰기 전에만' — 신규 4종은 MANUAL이라 현재 도달 불가, 규약 정합용)
  if (!event) throw new RegistryTxAbort(`${unit.serialNo}: 같은 연결 키의 이벤트가 이미 기록되어 있습니다`)
  return { changed, event, before, after }
}

// ─────────────────────────────────────────────────────────────────────────────
// applyImplicitTransition — 쓰기 순서 2 (2-phase: changes → 호출부 insert·rebuild → apply())
// ─────────────────────────────────────────────────────────────────────────────

export interface ImplicitTransitionInput {
  unit: UnitStateSource
  /** 체인(이관: RECOVER→REGISTER)의 두 번째 단계는 앞 단계의 after를 before로 넘긴다. 생략 시 유닛 원행 */
  before?: UnitStateSnapshot
  eventType: 'REGISTER' | 'RECOVER' | 'AS_OPEN' | 'AS_CLEAR'
  /** 이벤트 병원 — REGISTER는 새 배치 병원, RECOVER·AS_*는 배치 병원 */
  hospitalCode: string | null
  /** RECOVER 사유 value(DEFECT/LOST/DISPOSE/RETURN/TRANSFER/NULL) */
  reasonValue?: string | null
  occurredOn: string
  /** AS_CLEAR — AS 서비스 훅(`setUnitInUse`)만 true. /devices 수동 해제는 위치 유지 */
  locationToHospital?: boolean
  serial?: string | null
}

export interface ImplicitTransition {
  before: UnitStateSnapshot
  after: UnitStateSnapshot
  /** 이벤트 행 `changes`에 그대로 싣는다 */
  changes: DeviceUnitStateChanges
  changed: boolean
  warnings: string[]
  /** 호출부의 insertEvent(s)·rebuildUnitProjection(guard) **이후** 호출 — 가드 실패는 RegistryTxAbort */
  apply: () => Promise<void>
}

/**
 * 암묵 전이 phase 1 — 검증(condition 판정 409는 **이벤트 INSERT 전**이라 쓰기 없음)·changes 계산. phase 2 `apply()`는 가드 UPDATE.
 * 단건(recover/openAs/clearAs)·일괄(bulk)·교체(replace)·등록(registerDevicesIn — 임포트·WMS 출고 포함) 공용.
 */
export async function applyImplicitTransition(tx: DbClient, input: ImplicitTransitionInput): Promise<ImplicitTransition> {
  const { unit } = input
  const serial = input.serial ?? unit.serialNo
  const before = input.before ?? (await unitStateOf(tx, unit))
  const kind: UnitEventKind = input.eventType === 'RECOVER' ? recoverKindOf(input.reasonValue) : input.eventType
  const condition = nextCondition(before.condition, kind, { serial })
  const { location, note } = nextLocation(kind, before.location, condition, { placementHospital: input.hospitalCode, locationToHospital: input.locationToHospital })
  const after: UnitStateSnapshot = { condition, location }
  const warnings: string[] = []
  if (kind === 'RECOVER_KEEP' && condition === 'IN_USE' && after.location.kind === 'HOSPITAL') {
    warnings.push(`${serial}: 회수 후에도 기기 상태 사용중·위치 병원으로 남습니다 — 실물이 옮겨졌으면 [위치 이동]으로 위치를 이동하세요`)
  }
  const changes = buildUnitStateChanges(before, after, note)
  const changed = !unitStateEquals(before, after)
  const beforeCols = await locationColumns(tx, before.location)
  const afterCols = await locationColumns(tx, after.location)
  const condChanged = (before.condition ?? null) !== (after.condition ?? null)
  const locChanged = !locationEquals(before.location, after.location)
  const apply = async () => {
    const res = await tx.deviceUnit.updateMany({
      where: { id: unit.id, condition: before.condition ?? null, ...beforeCols },
      data: {
        condition: after.condition ?? null,
        ...afterCols,
        ...(condChanged ? { conditionChangedOn: ymdToDate(input.occurredOn) } : {}),
        ...(locChanged ? { locationChangedOn: ymdToDate(input.occurredOn) } : {}),
      },
    })
    if (res.count !== 1) throw new RegistryTxAbort(`${serial}: ${DEVICE_CONCURRENT_CHANGE_MESSAGE}`)
  }
  return { before, after, changes, changed, warnings, apply }
}

/**
 * 재사용 경고(§7.0) — 재등록·배치 없는 기존 유닛 condition ∉ {REPAIRED, IN_USE}(registerDevicesIn) / 교체기는 `strict`(REPAIRED 아니면) '수리완료 체크 없이 재사용'.
 * PRE_SHIP(출고 전 — A-6 신품)은 두 모드 모두 경고 대상이 아니다(재사용이 아닌 첫 출고 — 통합 2026-09-17, replaceDevice 고아 유닛 규칙과 동일).
 */
export function reuseWarning(serial: string, condition: string | null | undefined, opts?: { strict?: boolean }): string | null {
  const okSet: readonly string[] = opts?.strict ? ['REPAIRED', 'PRE_SHIP'] : ['REPAIRED', 'IN_USE', 'PRE_SHIP']
  if (condition && okSet.includes(condition)) return null
  return `${serial}: 기기 상태 ${deviceConditionLabel(condition)} — 수리완료 체크 없이 재사용`
}

// ─────────────────────────────────────────────────────────────────────────────
// 신규 4 서비스 — intakeDevice · markDeviceRepaired · undoDeviceRepaired · scrapDevice · moveDeviceLocation (§7.0 표)
// ─────────────────────────────────────────────────────────────────────────────

export interface UnitStateResult {
  changed: boolean
  event: EventRow | null
  before: UnitStateSnapshot
  after: UnitStateSnapshot
  /** 갱신 후 유닛 원행(배치 무관) */
  unit: UnitRow
  placement: PlacementRow | null
  warnings: string[]
}

function baseEvent(p: PreparedCtx, placement: PlacementRow | null, eventType: EventInput['eventType']): Omit<EventInput, 'deviceId' | 'changes' | 'occurredOn'> {
  return {
    eventType,
    hospitalCode: eventHospitalOf(placement),
    memo: p.memo,
    ref: p.ref,
    actionGroup: p.actionGroup,
    source: p.source,
    productType: placement?.productType ?? null,
    dealCode: placement?.dealCode ?? null,
    actor: p.actor,
  }
}

async function reloadUnit(tx: DbClient, id: number): Promise<UnitRow> {
  return (await getUnitOr404(tx, id)).unit
}

/**
 * 센터 입고(INTAKE) — §4.2 INTAKE 열. 위치 → 거점(기본 REFRESH_CENTER). hospital_code = 배치 병원 ?? last_hospital_code.
 * B-37: 변화가 없어도 **첫 ref면 기록**(접수 연결 이력); 같은 (ref, device, INTAKE)가 있고 변화도 없을 때만 스킵(BACKFILL 제외); 변화가 있으면 같은 ref가 있어도 기록.
 * 게이트: ① 배치 축(타 병원 ACTIVE → conflict 409 '원장 확정에서 이관 후 입고') ② condition(SCRAPPED 409).
 */
export async function intakeDevice(ctx: RegistryCtx, input: { deviceId: number; site?: DeviceSiteValue | null }, opts?: RegistryOpts): Promise<UnitStateResult> {
  return withRegistryTx(opts, async (tx) => {
    const { unit, placement } = await getUnitOr404(tx, input.deviceId)
    assertPlacementAxis(ctx, placement, 'INTAKE', unit.serialNo)
    const site: DeviceSiteValue = input.site ?? 'REFRESH_CENTER'
    if (!isDeviceSiteValue(site)) throw new RegistryError(400, `거점 값이 올바르지 않습니다 (${DEVICE_SITE_VALUES.join('/')})`)
    const before = await unitStateOf(tx, unit)
    const p = await prepareUnitCtx(tx, ctx, placement)
    const sameRef = await tx.hospitalDeviceEvent.findFirst({
      where: { deviceId: unit.id, eventType: 'INTAKE', refType: p.ref?.type ?? null, refCode: p.ref?.code ?? null, source: { not: 'BACKFILL' } },
      select: { id: true },
    })
    const condition = nextCondition(before.condition, 'INTAKE', { sameRef: !!sameRef, serial: unit.serialNo })
    const { location } = nextLocation('INTAKE', before.location, condition, { placementHospital: placement?.hospitalCode ?? null, site })
    const after: UnitStateSnapshot = { condition, location }
    const r = await applyUnitState(tx, { unit, before, after, occurredOn: p.occurredOn, forceRecord: !sameRef, event: baseEvent(p, placement, 'INTAKE') })
    return { ...r, unit: await reloadUnit(tx, unit.id), placement, warnings: p.warnings }
  })
}

/** 수리 완료(REPAIR_DONE) — AS_WAITING/NULL → REPAIRED. REPAIRED면 `{changed:false}`. IN_USE 409 '사용중…', PRE_SHIP/LOST/SCRAPPED 409. 위치 유지(센터) */
export async function markDeviceRepaired(ctx: RegistryCtx, input: { deviceId: number }, opts?: RegistryOpts): Promise<UnitStateResult> {
  return withRegistryTx(opts, async (tx) => {
    const { unit, placement } = await getUnitOr404(tx, input.deviceId)
    assertPlacementAxis(ctx, placement, 'REPAIR_DONE', unit.serialNo)
    const before = await unitStateOf(tx, unit)
    const condition = nextCondition(before.condition, 'REPAIR_DONE', { serial: unit.serialNo })
    const { location } = nextLocation('REPAIR_DONE', before.location, condition, { placementHospital: placement?.hospitalCode ?? null })
    const p = await prepareUnitCtx(tx, ctx, placement)
    const r = await applyUnitState(tx, { unit, before, after: { condition, location }, occurredOn: p.occurredOn, event: baseEvent(p, placement, 'REPAIR_DONE') })
    return { ...r, unit: await reloadUnit(tx, unit.id), placement, warnings: p.warnings }
  })
}

/** 수리완료 해제 — REPAIRED → AS_WAITING **CORRECT**(B-27, `correctDevice` 미경유, memo 기본 '수리완료 해제'). 그 외 409. 취소 판정은 §8.2(스냅샷 CORRECT) */
export async function undoDeviceRepaired(ctx: RegistryCtx, input: { deviceId: number }, opts?: RegistryOpts): Promise<UnitStateResult> {
  return withRegistryTx(opts, async (tx) => {
    const { unit, placement } = await getUnitOr404(tx, input.deviceId)
    const before = await unitStateOf(tx, unit)
    if (before.condition !== 'REPAIRED') throw new RegistryError(409, `${unit.serialNo}: 수리완료 상태가 아닙니다 (현재 ${deviceConditionLabel(before.condition)})`, { serial: unit.serialNo })
    const p = await prepareUnitCtx(tx, { ...ctx, memo: ctx.memo ?? '수리완료 해제' }, placement)
    const after: UnitStateSnapshot = { condition: 'AS_WAITING', location: { ...before.location } }
    const r = await applyUnitState(tx, { unit, before, after, occurredOn: p.occurredOn, event: baseEvent(p, placement, 'CORRECT') })
    return { ...r, unit: await reloadUnit(tx, unit.id), placement, warnings: p.warnings }
  })
}

/**
 * 폐기(SCRAP) — 배치 ACTIVE 409 '배치 중 기기는 먼저 회수하세요'(I-3, 전이표) · LOST 409 · SCRAPPED면 `{changed:false}` → SCRAPPED·위치 NULL.
 * memo 필수 여부(A-5 완화책)와 권한은 라우트가 검증한다.
 */
export async function scrapDevice(ctx: RegistryCtx, input: { deviceId: number; memo?: string | null }, opts?: RegistryOpts): Promise<UnitStateResult> {
  return withRegistryTx(opts, async (tx) => {
    const { unit, placement } = await getUnitOr404(tx, input.deviceId)
    if (placement?.status === 'ACTIVE') throw new RegistryError(409, `${unit.serialNo}: ${DEVICE_SCRAP_ACTIVE_MESSAGE}`, { serial: unit.serialNo })
    assertPlacementAxis(ctx, placement, 'SCRAP', unit.serialNo)
    const before = await unitStateOf(tx, unit)
    const condition = nextCondition(before.condition, 'SCRAP', { serial: unit.serialNo })
    const { location } = nextLocation('SCRAP', before.location, condition, { placementHospital: null })
    const p = await prepareUnitCtx(tx, { ...ctx, memo: input.memo ?? ctx.memo }, placement)
    const r = await applyUnitState(tx, { unit, before, after: { condition, location }, occurredOn: p.occurredOn, event: baseEvent(p, placement, 'SCRAP') })
    return { ...r, unit: await reloadUnit(tx, unit.id), placement, warnings: p.warnings }
  })
}

export type LocationTarget = DeviceSiteValue | 'HOSPITAL'

/**
 * 위치 이동(SITE_MOVE) — 배치 ACTIVE: `to='HOSPITAL'`(배치 병원)만·condition IN_USE만(§4.2 각주 ² — AS_WAITING/REPAIRED는 409 '미종결 입고 라인').
 * RECOVERED/없음: 현재 위치 무관, 목적지 거점만. LOST/SCRAPPED 409. 같은 위치면 `{changed:false}`.
 */
export async function moveDeviceLocation(ctx: RegistryCtx, input: { deviceId: number; to: LocationTarget }, opts?: RegistryOpts): Promise<UnitStateResult> {
  return withRegistryTx(opts, async (tx) => {
    const to = input.to
    if (to !== 'HOSPITAL' && !isDeviceSiteValue(to)) throw new RegistryError(400, `이동할 위치가 올바르지 않습니다 (${DEVICE_SITE_VALUES.join('/')}/HOSPITAL)`)
    const { unit, placement } = await getUnitOr404(tx, input.deviceId)
    assertPlacementAxis(ctx, placement, 'SITE_MOVE', unit.serialNo)
    const before = await unitStateOf(tx, unit)
    let target: DeviceLocationSnapshot
    if (placement?.status === 'ACTIVE') {
      if (to !== 'HOSPITAL') throw new RegistryError(409, `${unit.serialNo}: ${DEVICE_SCRAP_ACTIVE_MESSAGE}`, { serial: unit.serialNo })
      // NULL(미확인 — 배포 창·재도출 유닛)은 '미종결 입고 라인'이 원인이 아니므로 문구 분기(드로어는 IN_USE만 버튼 노출 — UI 영향 없음)
      if (before.condition == null) throw new RegistryError(409, `${unit.serialNo}: 기기 상태 미확인 — 관리 보정으로 상태를 지정한 뒤 반환하세요`, { serial: unit.serialNo })
      if (before.condition !== 'IN_USE') throw new RegistryError(409, `${unit.serialNo}: ${DEVICE_OPEN_INTAKE_LINE_MESSAGE}`, { serial: unit.serialNo })
      target = { kind: 'HOSPITAL', code: placement.hospitalCode! }
    } else {
      if (to === 'HOSPITAL') throw new RegistryError(409, `${unit.serialNo}: 회수된 기기는 병원 반환 대상이 아닙니다 — 등록·교체로 배치하세요`, { serial: unit.serialNo })
      target = { kind: 'SITE', code: to }
    }
    const condition = nextCondition(before.condition, 'SITE_MOVE', { serial: unit.serialNo })
    const { location } = nextLocation('SITE_MOVE', before.location, condition, { placementHospital: placement?.hospitalCode ?? null, to: target })
    const p = await prepareUnitCtx(tx, ctx, placement)
    const r = await applyUnitState(tx, { unit, before, after: { condition, location }, occurredOn: p.occurredOn, event: baseEvent(p, placement, 'SITE_MOVE') })
    return { ...r, unit: await reloadUnit(tx, unit.id), placement, warnings: p.warnings }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 취소·정정 규약 (§8.2) — 단일 정렬 기준 = id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 유닛의 스냅샷 이벤트(제외 집합 밖) — **id 내림차순**. 후보(스냅샷 타입 ∧ changes 보유)를 DB에서 거른 뒤 메모리에서 `isSnapshotEvent`(비스냅샷 CORRECT 제외).
 * 유닛당 이벤트 수가 작아 전량 적재가 무해하다 — 이벤트가 많이 쌓이는 유닛이 생기면 `changes ? 'condition'` raw 조건 + `take`로 전환(부록 B I-6 SQL과 같은 판정).
 */
async function loadSnapshotEvents(tx: DbClient, deviceId: number, excludeIds?: readonly number[]): Promise<EventRow[]> {
  const rows = await tx.hospitalDeviceEvent.findMany({
    where: {
      deviceId,
      eventType: { in: [...DEVICE_SNAPSHOT_EVENT_TYPES] },
      changes: { not: Prisma.DbNull },
      ...(excludeIds && excludeIds.length > 0 ? { id: { notIn: [...excludeIds] } } : {}),
    },
    orderBy: { id: 'desc' },
  })
  return rows.filter((e) => isSnapshotEvent(e))
}

/** id 순 마지막 스냅샷 이벤트(제외 집합 밖) — 없으면 null */
export async function latestSnapshotEvent(tx: DbClient, deviceId: number, opts?: { excludeIds?: readonly number[] }): Promise<EventRow | null> {
  return (await loadSnapshotEvents(tx, deviceId, opts?.excludeIds))[0] ?? null
}

/** 축별 진입일 */
interface AxisChangedOn {
  conditionOn: string | null
  locationOn: string | null
}

/**
 * 취소·재도출 후 축별 진입일(§8.2 2) — 남은 스냅샷 이벤트(id 내림차순) 중 **그 축을 마지막으로 바꾼**(before≠after) 이벤트의 업무일자.
 * 정방향 `applyUnitState`가 축별로 changed_on을 갱신하는 것과 대칭(한 축만 바꾼 이벤트를 취소해도 다른 축의 진입일은 유지 — P2 리뷰 2026-09-17).
 * 바꾼 이벤트가 없으면(백필·배포 전 값) id 최대 스냅샷의 일자로 근사, 스냅샷이 없으면 null.
 */
function axisChangedOnFrom(snapshots: readonly EventRow[]): AxisChangedOn {
  if (!snapshots.length) return { conditionOn: null, locationOn: null }
  const fallback = ymd(snapshots[0].occurredOn)
  const condHit = snapshots.find((e) => { const c = unitStateChangesOf(e.changes)!; return (c.condition.before ?? null) !== (c.condition.after ?? null) })
  const locHit = snapshots.find((e) => { const c = unitStateChangesOf(e.changes)!; return !locationEquals(c.location.before, c.location.after) })
  return { conditionOn: condHit ? ymd(condHit.occurredOn) : fallback, locationOn: locHit ? ymd(locHit.occurredOn) : fallback }
}

/**
 * 스냅샷 이벤트 취소 판정(§8.2 1) — 같은 유닛에 **id가 더 큰 스냅샷 이벤트**가 취소 집합 밖에 있으면 409.
 * 예: 소급 AS_CLEAR(id n+1) 뒤 REPAIR_DONE(id n) 취소 → 409(AS_CLEAR 먼저) / REGISTER(오늘, id n) + INTAKE(과거일, id n+1) → REGISTER 취소 409.
 */
export async function assertNoLaterSnapshot(tx: DbClient, deviceId: number, eventId: number, opts?: { cancelIds?: ReadonlySet<number> | readonly number[]; serial?: string }) {
  const exclude = opts?.cancelIds ? Array.from(opts.cancelIds) : []
  const rows = await tx.hospitalDeviceEvent.findMany({
    where: { deviceId, id: { gt: eventId, ...(exclude.length > 0 ? { notIn: exclude } : {}) }, eventType: { in: [...DEVICE_SNAPSHOT_EVENT_TYPES] }, changes: { not: Prisma.DbNull } },
    orderBy: { id: 'asc' },
  })
  const hit = rows.find((e) => isSnapshotEvent(e))
  if (hit) {
    throw new RegistryError(409, `${opts?.serial ? `${opts.serial}: ` : ''}이후 상태 스냅샷 이벤트(${eventLabel(hit)})가 있어 취소할 수 없습니다 — 최근 이벤트부터 취소하세요`)
  }
}

/**
 * `assertNoLaterSnapshot`의 메모리 판정판 — 유닛의 **전 이벤트**를 이미 적재한 호출부(`cancelImportBatch`)용, 기기당 쿼리 0.
 * 취소 집합 안 스냅샷 이벤트의 id 최소값보다 id가 큰 스냅샷 이벤트가 집합 밖에 있으면 그 첫 행(id 순), 없으면 null(집합에 스냅샷이 없어도 null).
 */
export function laterSnapshotOutside(events: readonly EventRow[], cancelIds: ReadonlySet<number>): EventRow | null {
  let minCancelled = Infinity
  for (const e of events) if (cancelIds.has(e.id) && isSnapshotEvent(e) && e.id < minCancelled) minCancelled = e.id
  if (!Number.isFinite(minCancelled)) return null
  return events.filter((e) => !cancelIds.has(e.id) && e.id > minCancelled && isSnapshotEvent(e)).sort((a, b) => a.id - b.id)[0] ?? null
}

/** I-3·I-4 점검 — 위반은 409가 아니라 warnings(§8.2 2) */
export function unitStateWarnings(serial: string, state: UnitStateSnapshot, placement: { status: string | null; hospitalCode: string | null } | null): string[] {
  const out: string[] = []
  if (placement?.status === 'ACTIVE') {
    if (state.condition === 'LOST' || state.condition === 'SCRAPPED' || state.condition === 'PRE_SHIP') {
      out.push(`${serial}: 배치 중인데 기기 상태가 ${deviceConditionLabel(state.condition)}입니다 (I-3) — 기기 상태 보정을 확인하세요`)
    }
    if (state.condition === 'IN_USE' && !(state.location.kind === 'HOSPITAL' && state.location.code === placement.hospitalCode)) {
      out.push(`${serial}: 사용중인데 위치가 배치 병원이 아닙니다 (I-4) — [병원 반환]으로 해소하세요`)
    }
  }
  return out
}

async function writeUnitState(tx: DbClient, unitId: number, state: UnitStateSnapshot, on: AxisChangedOn) {
  const cols = await locationColumns(tx, state.location)
  await tx.deviceUnit.update({
    where: { id: unitId },
    data: { condition: state.condition ?? null, ...cols, conditionChangedOn: on.conditionOn ? ymdToDate(on.conditionOn) : null, locationChangedOn: on.locationOn ? ymdToDate(on.locationOn) : null },
  })
}

/** LOST/SCRAPPED면 위치 NULL(I-1 — DB CHECK를 깨지 않게) */
function enforceTerminal(state: UnitStateSnapshot): UnitStateSnapshot {
  if (state.condition === 'LOST' || state.condition === 'SCRAPPED') return { condition: state.condition, location: { ...NO_LOCATION } }
  return state
}

/**
 * 신규 4종·상태 CORRECT 취소(단건, action_group 확장 없음) — `changes.before` 복원(location은 전용 매핑). 호출 전 `assertNoLaterSnapshot` 필수.
 * changed_on은 축별(`axisChangedOnFrom`) — 남은 스냅샷 중 그 축을 마지막으로 바꾼 이벤트의 업무일자, 없으면 NULL.
 */
export async function restoreUnitStateBefore(tx: DbClient, unit: UnitStateSource, ev: EventRow): Promise<{ restored: UnitStateSnapshot; before: UnitStateSnapshot }> {
  const ch = unitStateChangesOf(ev.changes)
  if (!ch) throw new RegistryError(409, `${unit.serialNo}: 상태 스냅샷이 없는 이벤트입니다 — 복원할 값이 없습니다`)
  const current = await unitStateOf(tx, unit)
  const restored = enforceTerminal({ condition: ch.condition.before, location: { ...ch.location.before } })
  await writeUnitState(tx, unit.id, restored, axisChangedOnFrom(await loadSnapshotEvents(tx, unit.id, [ev.id])))
  return { restored, before: current }
}

export interface RederiveResult {
  state: UnitStateSnapshot
  /** ① 남은 스냅샷 after / ② 취소 이벤트 before / ③ 배치 파생 */
  source: 'snapshot' | 'cancelled_before' | 'placement'
  warnings: string[]
}

/**
 * 배치 축 이벤트 취소·임포트 배치 취소 후 유닛 재도출(B-32, §8.2 2) — 우선순위:
 * ① 남은 이벤트 중 id 최대 스냅샷 이벤트의 after(I-6) → ② 취소된 이벤트(id 최소)의 `changes.before` → ③ 배치 rebuild 결과에서 파생:
 *    ACTIVE→IN_USE·배치 병원(플래그 켜져 있으면 AS_WAITING) / RECOVERED→NULL·센터 / 배치 행 삭제→NULL·NULL.
 * I-3·I-4 위반은 409가 아니라 warnings.
 */
export async function rederiveUnitState(
  tx: DbClient,
  unit: UnitStateSource,
  input: { cancelled: readonly EventRow[]; placement: { status: string | null; hospitalCode: string | null; asStartedOn?: Date | string | null; placedOn?: Date | string | null; recoveredOn?: Date | string | null } | null }
): Promise<RederiveResult> {
  const cancelledIds = input.cancelled.map((e) => e.id)
  let state: UnitStateSnapshot
  let source: RederiveResult['source']
  let on: AxisChangedOn
  const remaining = await loadSnapshotEvents(tx, unit.id, cancelledIds)
  const latest = remaining[0] ?? null
  if (latest) {
    const ch = unitStateChangesOf(latest.changes)!
    state = { condition: ch.condition.after, location: { ...ch.location.after } }
    source = 'snapshot'
    on = axisChangedOnFrom(remaining) // 축별 진입일(그 축을 마지막으로 바꾼 남은 스냅샷 일자)
  } else {
    const first = [...input.cancelled].filter((e) => e.deviceId === unit.id && isSnapshotEvent(e)).sort((a, b) => a.id - b.id)[0]
    if (first) {
      const ch = unitStateChangesOf(first.changes)!
      state = { condition: ch.condition.before, location: { ...ch.location.before } }
      source = 'cancelled_before'
      on = { conditionOn: null, locationOn: null }
    } else {
      const p = input.placement
      let changedOn: string | null
      if (p?.status === 'ACTIVE') {
        state = { condition: p.asStartedOn ? 'AS_WAITING' : 'IN_USE', location: { kind: 'HOSPITAL', code: p.hospitalCode } }
        changedOn = ymd(p.placedOn ?? null)
      } else if (p?.status === 'RECOVERED') {
        state = { condition: null, location: { kind: 'SITE', code: 'REFRESH_CENTER' } }
        changedOn = ymd(p.recoveredOn ?? null)
      } else {
        state = { condition: null, location: { ...NO_LOCATION } }
        changedOn = null
      }
      on = { conditionOn: changedOn, locationOn: changedOn }
      source = 'placement'
    }
  }
  state = enforceTerminal(state)
  await writeUnitState(tx, unit.id, state, on)
  return { state, source, warnings: unitStateWarnings(unit.serialNo, state, input.placement ? { status: input.placement.status, hospitalCode: input.placement.hospitalCode } : null) }
}
