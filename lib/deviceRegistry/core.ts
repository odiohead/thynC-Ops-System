/**
 * 디바이스 원장 서비스 — 공통 코어 (projects/hospital_device_registry_design.md §4 · §7.0 · §7.3)
 *
 * 이 폴더(`lib/deviceRegistry/*`)가 `device_units`·`hospital_devices`·`hospital_device_events`·`hospital_wards`·
 * `hospital_device_import_batches`의 **유일한 쓰기자**다. 라우트는 얇게(파싱·권한·logAudit) 유지한다.
 *
 * 3층 구조(B-20, 2026-09-01): `device_info`(모델) → `device_units`(시리얼 정체성, **공개 device id**) → `hospital_devices`(병원 배치 프로젝션, 유닛당 0..1행).
 * 서비스 내부·API가 다루는 `DeviceRow`는 유닛 + 배치 프로젝션을 평탄화한 형상이며 `id`는 항상 `device_units.id`다.
 *
 * - 불변식 1: 이벤트가 단일 소스, 프로젝션은 `rebuildUnitProjection`의 (occurred_on ASC, id ASC) fold 파생값
 * - 불변식 3: 소급 입력 허용 — 삽입 시점 상태로 전이 검증(`assertTransition`) + 삽입 후 전체 재-fold(불성립 409)
 * - 동시성: 프로젝션 UPDATE는 이전 (status, hospital_code, ward_id) 가드 updateMany, count≠1 → 409
 * - 유닛은 자동 삭제하지 않는다 — 이벤트 0건이면 배치 행만 지우고 유닛(시리얼 정체성)은 남는다(고아 유닛 = 원장 밖 식별자)
 * - 서비스는 logAudit·Slack을 호출하지 않는다(라우트 책임). inventory_* 테이블에 쓰지 않는다(D9)
 */
import { Prisma, type DeviceUnit, type HospitalDevice, type HospitalDeviceEvent, type PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import {
  DEAL_STATUS_CATEGORY,
  DEAL_STATUS_CONTRACTED,
  DEVICE_EVENT_TYPE_LABELS,
  DEVICE_TRANSITIONS,
  DEVICE_USAGE_TYPE_CATEGORY,
  IDEMPOTENT_SOURCES,
  PRODUCT_TYPE_INVALID_MESSAGE,
  PRODUCT_TYPES,
  RECOVERY_REASON_CATEGORY,
  USAGE_TYPE_INVALID_MESSAGE,
  isProductType,
  matchProductType,
  matchUsageType,
  resolveProductTypeDefault,
  type ProductType,
  type ProductTypeContext,
  type ProductTypeResolution,
  type UsageTypeRef,
  REGISTRY_REF_TYPES,
  REGISTRY_SOURCES,
  guessDeviceClassByPrefix,
  isFutureYmd,
  isYmd,
  matchesSerialPattern,
  normalizeSerial,
  normalizeWardName,
  resolveTransitionFrom,
  todayKst,
  toYmd,
  transitionMessage,
  type DeviceEventType,
  type DeviceStatus,
  type RegistryRefType,
  type RegistrySource,
  type TransitionOutcome,
} from '@/lib/deviceRegistryShared'

// ─────────────────────────────────────────────────────────────────────────────
// 타입 · 오류 (§7.0)
// ─────────────────────────────────────────────────────────────────────────────

/** 트랜잭션 클라이언트 — `prisma` 자체도 구조적으로 호환된다(읽기 전용 경로) */
export type DbClient = Prisma.TransactionClient

export type RegistryActor = { userId: string | null; name: string | null }
export type RegistryRef = { type: RegistryRefType; code: string }

export interface RegistryCtx {
  /** 병원 문맥. 개체 라우트(이동·회수·정정·메모)는 생략 가능 — 서비스가 `device.hospital_code`에서 유도(§4.2) */
  hospitalCode?: string | null
  actor: RegistryActor
  /** 업무일자 YYYY-MM-DD (기본 todayKst, 미래 400 — D7) */
  occurredOn?: string | null
  ref?: RegistryRef | null
  /** 기본 MANUAL */
  source?: RegistrySource
  memo?: string | null
  /** 지정 시 UUID. 생략하면 호출당 1개 생성 */
  actionGroup?: string | null
}

export interface RegistryOpts {
  client?: DbClient
  /** 병동명 입력 시 없는 병동을 자동 생성 (기본 true — D4) */
  autoCreateWard?: boolean
}

export interface Conflict {
  serial: string
  deviceId: number
  hospitalCode: string
  hospitalName: string | null
  wardName: string | null
  placedOn: string | null
}

export interface SkippedItem {
  deviceId: number
  serialNo: string
  reason: string
}

export interface RegistryErrorRow {
  row: number
  serial: string
  message: string
}

export class RegistryError extends Error {
  status: 400 | 404 | 409
  conflicts?: Conflict[]
  rows?: RegistryErrorRow[]
  skipped?: SkippedItem[]
  /** 임포트가 행 번호로 되돌릴 수 있도록 실패 시리얼을 함께 싣는다 */
  serial?: string

  constructor(
    status: 400 | 404 | 409,
    message: string,
    extra?: { conflicts?: Conflict[]; rows?: RegistryErrorRow[]; skipped?: SkippedItem[]; serial?: string }
  ) {
    super(message)
    this.name = 'RegistryError'
    this.status = status
    if (extra?.conflicts) this.conflicts = extra.conflicts
    if (extra?.rows) this.rows = extra.rows
    if (extra?.skipped) this.skipped = extra.skipped
    if (extra?.serial) this.serial = extra.serial
  }

  /** 라우트 응답 본문 — `{ error, conflicts?, rows?, skipped? }` */
  toJSON() {
    return {
      error: this.message,
      ...(this.conflicts ? { conflicts: this.conflicts } : {}),
      ...(this.rows ? { rows: this.rows } : {}),
      ...(this.skipped ? { skipped: this.skipped } : {}),
    }
  }
}

export function isRegistryError(e: unknown): e is RegistryError {
  return e instanceof RegistryError
}

/**
 * DB 예외 → RegistryError 매핑 (§7.0·§5.6·§7.3)
 * - P2002 serial_no → 409 '이미 등록된 시리얼' / device_id(유닛당 배치 1행) → 409 / CHECK 23514(시리얼 미정규화 등) → 409
 * - P2003 또는 커밋 시 복합 FK(23503) → 409 '병동이 이 병원에 속하지 않습니다'
 * - P2034(데드락·직렬화 실패, 40P01) → 409 '동시 임포트 충돌 — 다시 실행하세요'
 */
export function mapDbError(e: unknown): unknown {
  if (e instanceof RegistryError) return e
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    const target = String((e.meta as { target?: unknown } | undefined)?.target ?? '')
    if (e.code === 'P2002') {
      if (target.includes('name_norm')) return new RegistryError(409, '같은 이름의 병동이 이미 있습니다')
      if (target.includes('ext_ward_code')) return new RegistryError(409, '같은 온프렘 병동 코드가 이미 있습니다')
      if (target.includes('device_id')) return new RegistryError(409, '다른 사용자가 이 기기를 먼저 등록했습니다 — 새로고침 후 다시 시도하세요')
      return new RegistryError(409, '이미 등록된 시리얼입니다')
    }
    if (e.code === 'P2003') {
      const field = String((e.meta as { field_name?: unknown } | undefined)?.field_name ?? '')
      if (field.includes('ward')) return new RegistryError(409, '병동이 이 병원에 속하지 않습니다')
      return new RegistryError(409, `참조 무결성 위반 — ${field || '연결된 데이터'}를 확인하세요`)
    }
    if (e.code === 'P2034') return new RegistryError(409, '동시 임포트 충돌 — 다시 실행하세요')
    if (e.code === 'P2025') return new RegistryError(404, '대상을 찾을 수 없습니다')
  }
  if (e instanceof Prisma.PrismaClientUnknownRequestError) {
    if (e.message.includes('23503') && e.message.includes('ward')) return new RegistryError(409, '병동이 이 병원에 속하지 않습니다')
    if (e.message.includes('23514') && e.message.includes('serial_no_normalized')) return new RegistryError(409, '시리얼이 정규화되지 않았습니다 (대문자·공백 제거 키만 저장)')
    if (e.message.includes('23514')) return new RegistryError(409, '데이터 무결성 제약 위반 — 입력을 확인하세요')
    if (e.message.includes('40P01')) return new RegistryError(409, '동시 임포트 충돌 — 다시 실행하세요')
    if (e.message.includes('23505')) return new RegistryError(409, '이미 존재하는 값입니다 (유니크 충돌)')
  }
  return e
}

/** 트랜잭션 헬퍼 — `opts.client`가 있으면 재사용(중첩 $transaction 금지), 없으면 자체 tx(bulk-serial 선례 timeout) */
export async function withRegistryTx<T>(opts: RegistryOpts | undefined, fn: (tx: DbClient) => Promise<T>): Promise<T> {
  try {
    if (opts?.client) return await fn(opts.client)
    return await (prisma as PrismaClient).$transaction((tx) => fn(tx), { timeout: 120_000, maxWait: 10_000 })
  } catch (e) {
    throw mapDbError(e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 날짜 헬퍼 (업무일자는 UTC 자정 인스턴트로 저장 — §7.3)
// ─────────────────────────────────────────────────────────────────────────────

export function ymdToDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`)
}

export function ymd(v: Date | string | null | undefined): string | null {
  return toYmd(v)
}

/** 'YYYY-MM-DD' → 'MM-DD' (오류 문구용) */
export function fmtMd(v: Date | string | null | undefined): string {
  const s = toYmd(v)
  return s ? s.slice(5) : '?'
}

/** YYYY-MM-DD n일 전 (KST 문자열 연산) */
export function ymdMinusDays(base: string, days: number): string {
  const d = ymdToDate(base)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

// ─────────────────────────────────────────────────────────────────────────────
// 문맥 정규화 (§7.0 RegistryCtx 규약)
// ─────────────────────────────────────────────────────────────────────────────

export interface PreparedCtx {
  hospitalCode: string | null
  actor: RegistryActor
  occurredOn: string
  ref: RegistryRef | null
  source: RegistrySource
  memo: string | null
  actionGroup: string
  /** ref 병원 불일치 등 차단하지 않는 안내 */
  warnings: string[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 업무일자 검증 — 형식 400 · 미래 400 */
export function requireOccurredOn(v: string | null | undefined): string {
  const value = v == null || v === '' ? todayKst() : v
  if (!isYmd(value)) throw new RegistryError(400, '업무일자 형식이 올바르지 않습니다 (YYYY-MM-DD)')
  if (isFutureYmd(value)) throw new RegistryError(400, '업무일자는 미래일 수 없습니다')
  return value
}

/** 소프트 참조 검증 — 어휘·코드 존재(MAINTENANCE는 400), 병원 불일치는 경고만 (§7.3) */
export async function validateRef(
  client: DbClient,
  ref: RegistryRef | null | undefined,
  hospitalCode: string | null
): Promise<{ ref: RegistryRef | null; warnings: string[] }> {
  if (!ref) return { ref: null, warnings: [] }
  if (!REGISTRY_REF_TYPES.includes(ref.type)) throw new RegistryError(400, '연결 유형이 올바르지 않습니다')
  const code = String(ref.code ?? '').trim()
  if (!code) throw new RegistryError(400, '연결 코드가 비어 있습니다')
  const warnings: string[] = []
  if (ref.type === 'MAINTENANCE') {
    const m = await client.maintenance.findUnique({ where: { maintenanceCode: code }, select: { hospitalCode: true } })
    if (!m) throw new RegistryError(400, `유지보수 코드를 찾을 수 없습니다: ${code}`)
    if (hospitalCode && m.hospitalCode !== hospitalCode) warnings.push(`다른 병원으로 기록된 유지보수 건입니다 (${code})`)
  }
  return { ref: { type: ref.type, code }, warnings }
}

/**
 * ctx → PreparedCtx. `requireHospital`이면 병원 존재까지 확인(404).
 * 개체 라우트는 `deriveCtxHospital`로 hospitalCode를 채운 뒤 호출한다.
 */
export async function prepareCtx(
  client: DbClient,
  ctx: RegistryCtx,
  opts: { requireHospital: boolean }
): Promise<PreparedCtx> {
  const hospitalCode = ctx.hospitalCode ? String(ctx.hospitalCode) : null
  if (opts.requireHospital) {
    if (!hospitalCode) throw new RegistryError(400, '병원 코드가 필요합니다')
    const h = await client.hospital.findUnique({ where: { hospitalCode }, select: { hospitalCode: true } })
    if (!h) throw new RegistryError(404, '병원을 찾을 수 없습니다')
  }
  const occurredOn = requireOccurredOn(ctx.occurredOn)
  const source = ctx.source ?? 'MANUAL'
  if (!REGISTRY_SOURCES.includes(source)) throw new RegistryError(400, '출처(source)가 올바르지 않습니다')
  const { ref, warnings } = await validateRef(client, ctx.ref, hospitalCode)
  let actionGroup = ctx.actionGroup ?? null
  if (actionGroup && !UUID_RE.test(actionGroup)) throw new RegistryError(400, 'actionGroup은 UUID여야 합니다')
  if (!actionGroup) actionGroup = randomUUID()
  const memo = ctx.memo != null && String(ctx.memo).trim() ? String(ctx.memo).trim() : null
  return {
    hospitalCode,
    actor: { userId: ctx.actor?.userId ?? null, name: ctx.actor?.name ?? null },
    occurredOn,
    ref,
    source,
    memo,
    actionGroup,
    warnings,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// fold — 이벤트 → 프로젝션 (§4.2 fold 규칙)
// ─────────────────────────────────────────────────────────────────────────────

export interface FoldEvent {
  id: number
  eventType: string
  hospitalCode: string | null
  fromWardId: number | null
  toWardId: number | null
  reasonCodeId: number | null
  occurredOn: Date | string
  relatedDeviceId: number | null
  /** 이벤트 시점 상품유형 스냅샷 — REGISTER가 배치 값을 정한다(B-22) */
  productType?: string | null
  /** 이벤트 시점 계약건(딜 코드) 스냅샷 — REGISTER가 배치 값을 정한다(B-23) */
  dealCode?: string | null
  /** 소프트 참조 — AS_OPEN의 MAINTENANCE ref가 `as_ref_code`로 fold 된다(B-24) */
  refType?: string | null
  refCode?: string | null
  /** CORRECT changes — `productType.after`/`dealCode.after`가 있으면 fold가 배치 값을 갱신한다 */
  changes?: unknown
}

export interface FoldState {
  status: DeviceStatus | null
  hospitalCode: string | null
  wardId: number | null
  placedOn: string | null
  lastHospitalCode: string | null
  recoveredOn: string | null
  recoverReasonId: number | null
  replacedById: number | null
  /** 상품유형(일반/라이트) — REGISTER 이벤트 값, CORRECT(changes.productType)로 갱신, RECOVER는 마지막 값 유지(표시용) */
  productType: string | null
  /** 계약건(딜 코드, B-23) — REGISTER 이벤트 값, CORRECT(changes.dealCode)로 갱신, RECOVER는 마지막 값 유지(표시용) */
  dealCode: string | null
  /** AS진행중 플래그(B-24) — AS_OPEN이 set, AS_CLEAR가 clear, RECOVER·재REGISTER가 자동 clear */
  asStartedOn: string | null
  /** AS_OPEN 이벤트의 MAINTENANCE ref 코드 */
  asRefCode: string | null
  lastEventType: string | null
  lastEventOn: string | null
  /** CORRECT·AS_OPEN·AS_CLEAR 제외 상태 이벤트 수 */
  stateEventCount: number
}

export const EMPTY_STATE: FoldState = {
  status: null,
  hospitalCode: null,
  wardId: null,
  placedOn: null,
  lastHospitalCode: null,
  recoveredOn: null,
  recoverReasonId: null,
  replacedById: null,
  productType: null,
  dealCode: null,
  asStartedOn: null,
  asRefCode: null,
  lastEventType: null,
  lastEventOn: null,
  stateEventCount: 0,
}

/** CORRECT changes JSON에서 상품유형 변경 후 값을 꺼낸다(없으면 undefined) */
function productTypeAfterOf(changes: unknown): string | null | undefined {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return undefined
  const c = (changes as Record<string, unknown>).productType
  if (!c || typeof c !== 'object') return undefined
  const after = (c as { after?: unknown }).after
  return after == null ? null : isProductType(after) ? after : undefined
}

/** CORRECT changes JSON에서 계약건(딜 코드) 변경 후 값을 꺼낸다(없으면 undefined) */
function dealCodeAfterOf(changes: unknown): string | null | undefined {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return undefined
  const c = (changes as Record<string, unknown>).dealCode
  if (!c || typeof c !== 'object') return undefined
  const after = (c as { after?: unknown }).after
  return after == null ? null : typeof after === 'string' ? after : undefined
}

/** (occurred_on ASC, id ASC) — 같은 일자 순서는 id (불변식 3) */
export function sortEvents<T extends { id: number; occurredOn: Date | string }>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => {
    const da = toYmd(a.occurredOn) ?? ''
    const db = toYmd(b.occurredOn) ?? ''
    if (da !== db) return da < db ? -1 : 1
    return a.id - b.id
  })
}

export function eventLabel(ev: { eventType: string; occurredOn: Date | string }): string {
  return `${fmtMd(ev.occurredOn)} ${DEVICE_EVENT_TYPE_LABELS[ev.eventType as DeviceEventType] ?? ev.eventType}`
}

/** fold 중 불성립 이벤트에 대한 기본 409 문구 */
export function defaultIllegal(ev: FoldEvent): RegistryError {
  return new RegistryError(409, `이벤트 순서가 성립하지 않습니다 — ${eventLabel(ev)}`)
}

/** 소급 삽입 후 재-fold 불성립 문구 (§4.1-3) */
export function retroIllegal(ev: FoldEvent): RegistryError {
  return new RegistryError(409, `이 일자에 기록하면 이후 이벤트(${eventLabel(ev)})가 성립하지 않습니다`)
}

/**
 * fold 한 단계 — 전이가 성립하는지 판정만 (기록 시점의 병원 = ev.hospitalCode).
 * REGISTER: NONE·RECOVERED에서만 / MOVE_WARD·RECOVER·AS_OPEN·AS_CLEAR: 같은 병원 ACTIVE에서만 / CORRECT: 항상.
 */
function foldStepOk(state: FoldState, ev: FoldEvent): boolean {
  switch (ev.eventType) {
    case 'REGISTER':
      return state.status !== 'ACTIVE'
    case 'MOVE_WARD':
    case 'RECOVER':
    case 'AS_OPEN':
    case 'AS_CLEAR':
      return state.status === 'ACTIVE' && state.hospitalCode === ev.hospitalCode
    case 'CORRECT':
      return true
    default:
      return false
  }
}

/** 정렬된 이벤트 배열을 접어 프로젝션 상태를 만든다. 불성립 이벤트를 만나면 `illegal(ev, state)`가 만든 오류를 던진다. */
export function foldEvents(events: readonly FoldEvent[], illegal: (ev: FoldEvent, state: FoldState) => RegistryError = defaultIllegal): FoldState {
  let s: FoldState = { ...EMPTY_STATE }
  for (const ev of sortEvents(events)) {
    if (!foldStepOk(s, ev)) throw illegal(ev, s)
    const on = toYmd(ev.occurredOn)
    switch (ev.eventType) {
      case 'REGISTER':
        s = {
          ...s,
          status: 'ACTIVE',
          hospitalCode: ev.hospitalCode,
          wardId: ev.toWardId,
          placedOn: on,
          recoveredOn: null,
          recoverReasonId: null,
          lastHospitalCode: null,
          replacedById: null,
          productType: ev.productType ?? null, // 자리의 판매 조건은 새 REGISTER가 다시 정한다(회수 전 값 승계 없음)
          dealCode: ev.dealCode ?? null, // 계약건도 새 REGISTER가 다시 정한다(B-23)
          asStartedOn: null, // 재등록 시 AS 플래그 초기화(B-24)
          asRefCode: null,
        }
        break
      case 'MOVE_WARD':
        s = { ...s, wardId: ev.toWardId }
        break
      case 'RECOVER':
        s = {
          ...s,
          status: 'RECOVERED',
          lastHospitalCode: s.hospitalCode,
          hospitalCode: null,
          wardId: null,
          recoveredOn: on,
          recoverReasonId: ev.reasonCodeId,
          replacedById: ev.relatedDeviceId,
          asStartedOn: null, // 회수(교체 포함) 시 AS 플래그 자동 해제(B-24). dealCode는 마지막 값 보존(표시용)
          asRefCode: null,
        }
        break
      case 'AS_OPEN':
        // 비상태 표시 이벤트(B-24) — 플래그만 접고 last_event·stateEventCount 미반영(CORRECT 규약과 동일)
        s = { ...s, asStartedOn: on, asRefCode: ev.refType === 'MAINTENANCE' ? (ev.refCode ?? null) : null }
        continue
      case 'AS_CLEAR':
        s = { ...s, asStartedOn: null, asRefCode: null }
        continue
      case 'CORRECT': {
        const pt = productTypeAfterOf(ev.changes)
        if (pt !== undefined) s = { ...s, productType: pt }
        const dc = dealCodeAfterOf(ev.changes)
        if (dc !== undefined) s = { ...s, dealCode: dc }
        continue // 식별 컬럼만 — 프로젝션·last_event 미반영(상품유형·계약건 정정만 배치 값 갱신)
      }
    }
    s.lastEventType = ev.eventType
    s.lastEventOn = on
    s.stateEventCount += 1
  }
  return s
}

/** 업무일자 시점 상태 — `occurred_on <= ymd`인 이벤트만 접는다(새 이벤트의 id는 항상 더 크므로 같은 일자 뒤에 놓인다) */
export function stateAt(events: readonly FoldEvent[], atYmd: string): FoldState {
  return foldEvents(events.filter((e) => (toYmd(e.occurredOn) ?? '') <= atYmd))
}

/** 업무일자 이후의 상태 이벤트(CORRECT 제외) — 소급 정합 검사용 */
export function stateEventsAfter<T extends FoldEvent>(events: readonly T[], atYmd: string): T[] {
  return sortEvents(events.filter((e) => e.eventType !== 'CORRECT' && (toYmd(e.occurredOn) ?? '') > atYmd))
}

// ─────────────────────────────────────────────────────────────────────────────
// 전이 검증 단일 소스 (§4.2 표 → lib/deviceRegistryShared DEVICE_TRANSITIONS)
// ─────────────────────────────────────────────────────────────────────────────

/** 상태(+기록 병원) → 판정. CORRECT는 병원 무관. */
export function evalTransition(
  state: Pick<FoldState, 'status' | 'hospitalCode'>,
  eventType: DeviceEventType,
  hospitalCode: string | null
): TransitionOutcome {
  const same = state.hospitalCode != null && state.hospitalCode === hospitalCode
  return DEVICE_TRANSITIONS[resolveTransitionFrom(state.status, same)][eventType]
}

/**
 * 판정이 ok(또는 allow에 포함)가 아니면 RegistryError.
 * skip·conflict는 호출부 규약이 다르므로(등록 중복 규약 §7.0) 필요한 곳에서 allow로 받는다.
 */
export function assertTransition(
  state: Pick<FoldState, 'status' | 'hospitalCode'>,
  eventType: DeviceEventType,
  hospitalCode: string | null,
  opts?: { allow?: readonly TransitionOutcome[]; serial?: string }
): TransitionOutcome {
  const outcome = evalTransition(state, eventType, hospitalCode)
  if (outcome === 'ok' || opts?.allow?.includes(outcome)) return outcome
  const status = outcome === 'not_found' ? 404 : 409
  const msg = transitionMessage(resolveTransitionFrom(state.status, state.hospitalCode != null && state.hospitalCode === hospitalCode), eventType) ?? '전이 불가'
  throw new RegistryError(status, opts?.serial ? `${opts.serial}: ${msg}` : msg, opts?.serial ? { serial: opts.serial } : undefined)
}

// ─────────────────────────────────────────────────────────────────────────────
// 이벤트 적재 · 프로젝션 재계산 (불변식 1 · 동시성 가드)
// ─────────────────────────────────────────────────────────────────────────────

export type EventRow = HospitalDeviceEvent
/** `device_units` 원행(1층) — 용도 마스터 조인(`usageType`)은 `UNIT_USAGE_INCLUDE`로 읽은 경우에만 채워진다 */
export type UnitRow = DeviceUnit & { usageType?: UsageTypeRef | null }
/** `hospital_devices` 원행(2층 배치 프로젝션) */
export type PlacementRow = HospitalDevice

/** 유닛 조회 공용 include — 용도(DEVICE_USAGE_TYPE) 마스터 행 {id, name, value} */
export const UNIT_USAGE_INCLUDE = { usageType: { select: { id: true, name: true, value: true } } } satisfies Prisma.DeviceUnitInclude

/**
 * 공개 기기 형상 — 유닛(식별) + 배치 프로젝션(상태)을 평탄화. `id` = `device_units.id`(공개 device id), `placementId` = `hospital_devices.id`(내부).
 * 라우트 응답·audit 스냅샷·서비스 반환값이 모두 이 형상을 쓴다(구 단일 테이블 시절의 JSON 키 유지).
 */
export interface DeviceRow {
  id: number
  placementId: number
  deviceInfoId: number
  serialNo: string
  serialRaw: string | null
  macAddress: string | null
  memo: string | null
  /** 유닛이 처음 생긴 경로 */
  source: string
  /** 용도(판매용 SALE / 평가용 EVAL) — 유닛 속성, null=미지정 */
  usageTypeId: number | null
  usageType: UsageTypeRef | null
  extDeviceCode: string | null
  extLastSeenAt: Date | null
  extSyncedAt: Date | null
  status: string
  hospitalCode: string | null
  wardId: number | null
  placedOn: Date | null
  lastHospitalCode: string | null
  recoveredOn: Date | null
  recoverReasonId: number | null
  lastEventType: string | null
  lastEventOn: Date | null
  /** 교체기 유닛 id */
  replacedById: number | null
  /** 상품유형(일반/라이트) — 배치 속성(B-22), null=미지정. RECOVERED 행은 회수 전 마지막 값 */
  productType: string | null
  /** 계약건(딜 코드) 소프트 참조 — 배치 속성(B-23), null=미지정. RECOVERED 행은 회수 전 마지막 값 */
  dealCode: string | null
  /** AS진행중 플래그 시작일(B-24) — ACTIVE에서만 값이 있다 */
  asStartedOn: Date | null
  /** AS 연결 유지보수 코드(MNT-…) */
  asRefCode: string | null
  createdAt: Date
  updatedAt: Date
  unitCreatedAt: Date
  unitUpdatedAt: Date
}

/** 유닛 + 배치 → DeviceRow */
export function flattenDevice(unit: UnitRow, placement: PlacementRow): DeviceRow {
  return {
    id: unit.id,
    placementId: placement.id,
    deviceInfoId: unit.deviceInfoId,
    serialNo: unit.serialNo,
    serialRaw: unit.serialRaw,
    macAddress: unit.macAddress,
    memo: unit.memo,
    source: unit.source,
    usageTypeId: unit.usageTypeId,
    usageType: unit.usageType ?? null,
    extDeviceCode: placement.extDeviceCode,
    extLastSeenAt: placement.extLastSeenAt,
    extSyncedAt: placement.extSyncedAt,
    status: placement.status,
    hospitalCode: placement.hospitalCode,
    wardId: placement.wardId,
    placedOn: placement.placedOn,
    lastHospitalCode: placement.lastHospitalCode,
    recoveredOn: placement.recoveredOn,
    recoverReasonId: placement.recoverReasonId,
    lastEventType: placement.lastEventType,
    lastEventOn: placement.lastEventOn,
    replacedById: placement.replacedById,
    productType: placement.productType,
    dealCode: placement.dealCode,
    asStartedOn: placement.asStartedOn,
    asRefCode: placement.asRefCode,
    createdAt: placement.createdAt,
    updatedAt: placement.updatedAt,
    unitCreatedAt: unit.createdAt,
    unitUpdatedAt: unit.updatedAt,
  }
}

export interface EventInput {
  deviceId: number
  eventType: DeviceEventType
  hospitalCode: string | null
  fromWardId?: number | null
  toWardId?: number | null
  reasonCodeId?: number | null
  occurredOn: string
  memo?: string | null
  ref?: RegistryRef | null
  relatedDeviceId?: number | null
  actionGroup: string | null
  source: RegistrySource
  importBatchId?: number | null
  changes?: Prisma.InputJsonValue | null
  /** 이벤트 시점 상품유형 스냅샷(REGISTER=지정값·MOVE/RECOVER=당시 배치 값·CORRECT=변경 후 값) */
  productType?: string | null
  /** 이벤트 시점 계약건(딜 코드) 스냅샷(REGISTER=새 배치 값·그 외=당시 배치 값·CORRECT=변경 후 값 — B-23) */
  dealCode?: string | null
  actor: RegistryActor
}

function toEventData(input: EventInput): Prisma.HospitalDeviceEventUncheckedCreateInput {
  return {
    deviceId: input.deviceId,
    eventType: input.eventType,
    hospitalCode: input.hospitalCode,
    fromWardId: input.fromWardId ?? null,
    toWardId: input.toWardId ?? null,
    reasonCodeId: input.reasonCodeId ?? null,
    occurredOn: ymdToDate(input.occurredOn),
    memo: input.memo ?? null,
    refType: input.ref?.type ?? null,
    refCode: input.ref?.code ?? null,
    relatedDeviceId: input.relatedDeviceId ?? null,
    actionGroup: input.actionGroup,
    source: input.source,
    importBatchId: input.importBatchId ?? null,
    changes: input.changes ?? undefined,
    productType: input.productType ?? null,
    dealCode: input.dealCode ?? null,
    actorId: input.actor.userId,
    actorName: input.actor.name,
  }
}

/**
 * 이벤트 1건 INSERT. 자동 출처(WMS·ONPREM)+ref의 멱등 부분 UNIQUE 충돌(P2002)은 no-op(null 반환) — 불변식 8.
 * 그 외 P2002는 그대로 던진다(호출부 mapDbError).
 */
export async function insertEvent(client: DbClient, input: EventInput): Promise<EventRow | null> {
  const idempotent = !!input.ref && IDEMPOTENT_SOURCES.includes(input.source)
  try {
    return await client.hospitalDeviceEvent.create({ data: toEventData(input) })
  } catch (e) {
    if (idempotent && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null
    throw e
  }
}

/** 여러 이벤트를 한 번에 INSERT(같은 액션의 묶음). 반환 순서는 입력 순서(id 오름차순). */
export async function insertEvents(client: DbClient, inputs: EventInput[]): Promise<EventRow[]> {
  if (inputs.length === 0) return []
  const rows = await client.hospitalDeviceEvent.createManyAndReturn({ data: inputs.map(toEventData) })
  return rows.sort((a, b) => a.id - b.id)
}

/** 기기별 이벤트 전체(정렬) — 한 쿼리 */
export async function loadDeviceEvents(client: DbClient, deviceIds: number[]): Promise<Map<number, EventRow[]>> {
  const map = new Map<number, EventRow[]>()
  if (deviceIds.length === 0) return map
  const rows = await client.hospitalDeviceEvent.findMany({
    where: { deviceId: { in: deviceIds } },
    orderBy: [{ occurredOn: 'asc' }, { id: 'asc' }],
  })
  for (const r of rows) {
    const list = map.get(r.deviceId)
    if (list) list.push(r)
    else map.set(r.deviceId, [r])
  }
  for (const id of Array.from(deviceIds)) if (!map.has(id)) map.set(id, [])
  return map
}

export interface ProjectionGuard {
  status: string
  hospitalCode: string | null
  wardId: number | null
}

export function guardOf(d: Pick<DeviceRow, 'status' | 'hospitalCode' | 'wardId'>): ProjectionGuard {
  return { status: d.status, hospitalCode: d.hospitalCode, wardId: d.wardId }
}

/** fold 상태 → hospital_devices 프로젝션 컬럼(스칼라만 — create·update 입력 양쪽에 그대로 쓴다) */
export interface ProjectionColumns {
  status: string
  hospitalCode: string | null
  wardId: number | null
  placedOn: Date | null
  lastHospitalCode: string | null
  recoveredOn: Date | null
  recoverReasonId: number | null
  lastEventType: string | null
  lastEventOn: Date | null
  replacedById: number | null
  productType: string | null
  dealCode: string | null
  asStartedOn: Date | null
  asRefCode: string | null
}

export function projectionData(s: FoldState): ProjectionColumns {
  return {
    status: s.status ?? 'ACTIVE',
    hospitalCode: s.hospitalCode,
    wardId: s.wardId,
    placedOn: s.placedOn ? ymdToDate(s.placedOn) : null,
    lastHospitalCode: s.lastHospitalCode,
    recoveredOn: s.recoveredOn ? ymdToDate(s.recoveredOn) : null,
    recoverReasonId: s.recoverReasonId,
    lastEventType: s.lastEventType,
    lastEventOn: s.lastEventOn ? ymdToDate(s.lastEventOn) : null,
    replacedById: s.replacedById,
    productType: s.productType,
    dealCode: s.dealCode,
    asStartedOn: s.asStartedOn ? ymdToDate(s.asStartedOn) : null,
    asRefCode: s.asRefCode,
  }
}

/**
 * 프로젝션 재계산 — 유닛의 이벤트를 다시 접어 배치 행(`hospital_devices.device_id = unitId`)을 UPDATE 한다(불변식 1).
 * - 이벤트 0건이면 쓰지 않고 EMPTY 상태 반환(호출부가 배치 행을 삭제 — `rebuildOrDelete`)
 * - 배치 행이 없는데 이벤트가 있으면 생성(첫 REGISTER 직후 경로) — `device_id` UNIQUE 충돌은 mapDbError → 409
 * - `guard`가 있으면 이전 (status, hospital_code, ward_id) 조건 updateMany, count≠1 → 409 (§7.0 동시성)
 * - fold 불성립은 `illegal`이 만든 409 (기본 문구 / 소급 삽입은 retroIllegal)
 */
export async function rebuildUnitProjection(
  client: DbClient,
  unitId: number,
  opts?: { guard?: ProjectionGuard; illegal?: (ev: FoldEvent, state: FoldState) => RegistryError }
): Promise<{ state: FoldState; events: EventRow[] }> {
  const events = await client.hospitalDeviceEvent.findMany({
    where: { deviceId: unitId },
    orderBy: [{ occurredOn: 'asc' }, { id: 'asc' }],
  })
  if (events.length === 0) return { state: { ...EMPTY_STATE }, events }
  const state = foldEvents(events, opts?.illegal)
  const data = projectionData(state)
  if (opts?.guard) {
    const res = await client.hospitalDevice.updateMany({
      where: { deviceId: unitId, status: opts.guard.status, hospitalCode: opts.guard.hospitalCode, wardId: opts.guard.wardId },
      data,
    })
    if (res.count !== 1) {
      throw new RegistryError(409, '다른 사용자가 이 기기를 먼저 변경했습니다 — 새로고침 후 다시 시도하세요')
    }
  } else {
    await client.hospitalDevice.upsert({ where: { deviceId: unitId }, update: data, create: { deviceId: unitId, ...data } })
  }
  return { state, events }
}

/** 이벤트 0건이면 배치 행 삭제(유닛은 남김), 아니면 재계산. 삭제 여부 반환. */
export async function rebuildOrDelete(
  client: DbClient,
  unitId: number,
  opts?: { illegal?: (ev: FoldEvent, state: FoldState) => RegistryError }
): Promise<{ deleted: boolean; state: FoldState }> {
  const { state, events } = await rebuildUnitProjection(client, unitId, opts)
  if (events.length === 0) {
    await client.hospitalDevice.deleteMany({ where: { deviceId: unitId } })
    return { deleted: true, state }
  }
  return { deleted: false, state }
}

// ─────────────────────────────────────────────────────────────────────────────
// 유닛(시리얼 정체성) — 조회·생성 (§5.2b)
// ─────────────────────────────────────────────────────────────────────────────

export interface UnitUpsertInput {
  /** 원문 입력(정규화는 여기서) — `serialNo`가 이미 정규화 키면 그대로 */
  serialInput?: string | null
  serialNo?: string | null
  serialRaw?: string | null
  deviceInfoId: number
  macAddress?: string | null
  source: RegistrySource
  /** 용도(검증 완료 id) — 생성 시 부여, 기존 유닛은 비어 있을 때만 채운다(다른 값이면 유지 — 호출부가 경고) */
  usageTypeId?: number | null
}

/**
 * 시리얼 → 유닛 찾기/만들기. 정규화 키(`normalizeSerial`)로 조회하고 없으면 생성한다.
 * - 같은 시리얼이 **다른 모델**로 이미 등록돼 있으면 409(시리얼은 전역 정체성 — 모델 정정은 CORRECT로)
 * - 기존 유닛의 mac/serialRaw/usageType이 비어 있으면 입력값으로 채운다(덮어쓰지 않음 — 용도 변경은 CORRECT로)
 * 반환 `created`는 이번 호출에서 새로 만들었는지. 반환 유닛에는 `usageType` 조인이 포함된다.
 */
export async function getOrCreateUnit(client: DbClient, input: UnitUpsertInput): Promise<{ unit: UnitRow; created: boolean }> {
  let serialNo: string
  let serialRaw: string | null
  if (input.serialNo) {
    const ns = normalizeSerial(input.serialNo)
    serialNo = ns.serialNo
    serialRaw = input.serialRaw ?? ns.serialRaw
  } else {
    const ns = normalizeSerial(input.serialInput)
    serialNo = ns.serialNo
    serialRaw = ns.serialRaw
  }
  if (!serialNo) throw new RegistryError(400, '시리얼이 비어 있습니다')
  const mac = input.macAddress?.trim() || null
  const usageTypeId = input.usageTypeId ?? null
  const existing = await client.deviceUnit.findUnique({ where: { serialNo }, include: UNIT_USAGE_INCLUDE })
  if (existing) {
    if (existing.deviceInfoId !== input.deviceInfoId) {
      const models = await client.deviceInfo.findMany({ where: { id: { in: [existing.deviceInfoId, input.deviceInfoId] } }, select: { id: true, deviceModel: true } })
      const name = (id: number) => models.find((m) => m.id === id)?.deviceModel ?? `#${id}`
      throw new RegistryError(409, `이미 다른 모델로 등록된 시리얼입니다 (${serialNo}: ${name(existing.deviceInfoId)} ≠ ${name(input.deviceInfoId)})`, { serial: serialNo })
    }
    const fill: Prisma.DeviceUnitUncheckedUpdateInput = {}
    if (mac && !existing.macAddress) fill.macAddress = mac
    if (serialRaw && !existing.serialRaw) fill.serialRaw = serialRaw
    if (usageTypeId != null && existing.usageTypeId == null) fill.usageTypeId = usageTypeId
    if (Object.keys(fill).length === 0) return { unit: existing, created: false }
    return { unit: await client.deviceUnit.update({ where: { id: existing.id }, data: fill, include: UNIT_USAGE_INCLUDE }), created: false }
  }
  try {
    const unit = await client.deviceUnit.create({
      data: { serialNo, serialRaw, deviceInfoId: input.deviceInfoId, macAddress: mac, source: input.source, usageTypeId },
      include: UNIT_USAGE_INCLUDE,
    })
    return { unit, created: true }
  } catch (e) {
    throw mapDbError(e)
  }
}

/** 유닛 id → 유닛 원행(배치 무관) */
export async function loadUnits(client: DbClient, unitIds: readonly number[]): Promise<Map<number, UnitRow>> {
  const ids = Array.from(new Set(unitIds))
  if (ids.length === 0) return new Map()
  const rows = await client.deviceUnit.findMany({ where: { id: { in: ids } }, include: UNIT_USAGE_INCLUDE })
  return new Map(rows.map((u) => [u.id, u]))
}

/** 유닛 id → DeviceRow(배치 행이 있는 유닛만) */
export async function loadDevices(client: DbClient, unitIds: readonly number[]): Promise<Map<number, DeviceRow>> {
  const ids = Array.from(new Set(unitIds))
  if (ids.length === 0) return new Map()
  const rows = await client.hospitalDevice.findMany({ where: { deviceId: { in: ids } }, include: { unit: { include: UNIT_USAGE_INCLUDE } } })
  return new Map(rows.map((p) => [p.deviceId, flattenDevice(p.unit, p)]))
}

/** 정규화 시리얼 → 유닛(+배치). 배치 없는 고아 유닛은 `device: null` */
export async function findUnitsBySerial(
  client: DbClient,
  serials: readonly string[]
): Promise<Map<string, { unit: UnitRow; device: DeviceRow | null }>> {
  const keys = Array.from(new Set(serials.filter(Boolean)))
  if (keys.length === 0) return new Map()
  const rows = await client.deviceUnit.findMany({ where: { serialNo: { in: keys } }, include: { placement: true, ...UNIT_USAGE_INCLUDE } })
  return new Map(rows.map((u) => [u.serialNo, { unit: u, device: u.placement ? flattenDevice(u, u.placement) : null }]))
}

// ─────────────────────────────────────────────────────────────────────────────
// 개체 조회 · 병원 유도
// ─────────────────────────────────────────────────────────────────────────────

/** 공개 device id(유닛 id) → DeviceRow. 유닛이 없거나 배치 행(이벤트)이 없으면 404 '원장에 없는 기기' */
export async function getDeviceOr404(client: DbClient, deviceId: number): Promise<DeviceRow> {
  if (!Number.isInteger(deviceId) || deviceId <= 0) throw new RegistryError(400, '기기 id가 올바르지 않습니다')
  const p = await client.hospitalDevice.findUnique({ where: { deviceId }, include: { unit: { include: UNIT_USAGE_INCLUDE } } })
  if (!p) throw new RegistryError(404, '원장에 없는 기기입니다')
  return flattenDevice(p.unit, p)
}

/**
 * 개체 라우트의 병원 문맥 유도(§4.2) — ACTIVE면 현재 병원, RECOVERED면 null(호출부 전이 검증이 409를 낸다).
 * ctx.hospitalCode가 이미 있으면 그대로 두고 개체만 반환한다.
 */
export async function deriveCtxHospital(
  deviceId: number,
  client: DbClient = prisma
): Promise<{ device: DeviceRow; hospitalCode: string | null }> {
  const device = await getDeviceOr404(client, deviceId)
  return { device, hospitalCode: device.hospitalCode ?? null }
}

// ─────────────────────────────────────────────────────────────────────────────
// 모델(device_info serial_tracked) 판별 (부록 B-2)
// ─────────────────────────────────────────────────────────────────────────────

export interface TrackedModel {
  id: number
  deviceModel: string
  deviceName: string
  deviceClass: string
  onpremDeviceType: number | null
  serialPattern: string | null
  isActive: boolean
  sortOrder: number
}

/** 원장 대상 모델 = `device_info.serial_tracked` (D2 단일 소스). 비활성 행도 포함(기존 개체 표시용) */
export async function loadTrackedModels(client: DbClient): Promise<TrackedModel[]> {
  return client.deviceInfo.findMany({
    where: { serialTracked: true },
    select: { id: true, deviceModel: true, deviceName: true, deviceClass: true, onpremDeviceType: true, serialPattern: true, isActive: true, sortOrder: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })
}

export interface ModelResolution {
  model: TrackedModel | null
  /** 판별 실패 사유(error) */
  error: string | null
  /** 형식 불일치·접두/모델 불일치 등 경고 */
  warnings: string[]
}

/**
 * 모델 판별 우선순위: deviceInfoId(고정) → onpremDeviceType(초안 모드 deviceType 열) → modelInput(Excel B열) → 접두 추정.
 * 시리얼 형식 불일치는 경고만(B-9).
 */
export function resolveModel(
  models: readonly TrackedModel[],
  input: { serialNo: string; deviceInfoId?: number | null; modelInput?: string | null; onpremDeviceType?: number | null }
): ModelResolution {
  const warnings: string[] = []
  const guess = guessDeviceClassByPrefix(input.serialNo)
  const byGuess = (): TrackedModel | null => {
    if (guess.onpremDeviceType != null) {
      const m = models.find((x) => x.onpremDeviceType === guess.onpremDeviceType && x.isActive) ?? models.find((x) => x.onpremDeviceType === guess.onpremDeviceType)
      if (m) return m
    } else if (guess.deviceClass === 'GATEWAY') {
      const m = models.find((x) => x.deviceClass === 'GATEWAY' && x.isActive) ?? models.find((x) => x.deviceClass === 'GATEWAY')
      if (m) return m
    }
    return null
  }

  let model: TrackedModel | null = null
  if (input.deviceInfoId != null) {
    model = models.find((m) => m.id === input.deviceInfoId) ?? null
    if (!model) return { model: null, error: '원장 대상 모델이 아닙니다 (serial_tracked)', warnings }
  } else if (input.onpremDeviceType != null) {
    model = models.find((m) => m.onpremDeviceType === input.onpremDeviceType && m.isActive) ?? models.find((m) => m.onpremDeviceType === input.onpremDeviceType) ?? null
    if (!model) {
      const hint = guess.onpremDeviceType === input.onpremDeviceType ? guess.hintModel : null
      return { model: null, error: hint ? `${hint} 모델이 등록되어 있지 않습니다` : `온프렘 기기유형 ${input.onpremDeviceType}에 해당하는 모델이 없습니다`, warnings }
    }
  } else if (input.modelInput && input.modelInput.trim()) {
    const key = input.modelInput.trim().toUpperCase()
    model =
      models.find((m) => m.deviceModel.toUpperCase() === key) ??
      models.find((m) => m.deviceName.toUpperCase() === key) ??
      models.find((m) => m.deviceModel.toUpperCase().startsWith(key) || m.deviceName.toUpperCase().startsWith(key)) ??
      null
    if (!model) return { model: null, error: `모델 '${input.modelInput.trim()}'을(를) 찾을 수 없습니다`, warnings }
  } else {
    model = byGuess()
    if (!model) {
      return {
        model: null,
        error: guess.hintModel ? `${guess.hintModel} 모델이 등록되어 있지 않습니다` : '모델 판별 불가 — 모델을 지정하세요',
        warnings,
      }
    }
  }

  // 지정 모델 vs 접두 추정 불일치 경고 (지정 경로에서만)
  if (input.deviceInfoId != null || input.modelInput || input.onpremDeviceType != null) {
    const g = byGuess()
    if (g && g.id !== model.id) warnings.push(`접두 추정 모델(${g.deviceModel})과 지정 모델(${model.deviceModel})이 다릅니다`)
  }
  const patternOk = matchesSerialPattern(input.serialNo, model.serialPattern)
  if (patternOk === false) warnings.push(`시리얼 형식 불일치 (${model.deviceModel} ${model.serialPattern})`)
  return { model, error: null, warnings }
}

// ─────────────────────────────────────────────────────────────────────────────
// 회수 사유 마스터 (D5 — StatusCode DEVICE_RECOVERY_REASON, value가 시스템 의미)
// ─────────────────────────────────────────────────────────────────────────────

export interface RecoveryReason {
  id: number
  name: string
  value: string | null
}

export async function loadRecoveryReasons(client: DbClient): Promise<RecoveryReason[]> {
  return client.statusCode.findMany({
    where: { category: RECOVERY_REASON_CATEGORY },
    select: { id: true, name: true, value: true },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
  })
}

export async function requireRecoveryReason(client: DbClient, reasonCodeId: number | null | undefined): Promise<RecoveryReason> {
  if (reasonCodeId == null || !Number.isInteger(reasonCodeId)) throw new RegistryError(400, '회수 사유를 선택하세요')
  const r = await client.statusCode.findFirst({
    where: { id: reasonCodeId, category: RECOVERY_REASON_CATEGORY },
    select: { id: true, name: true, value: true },
  })
  if (!r) throw new RegistryError(400, '회수 사유가 올바르지 않습니다')
  return r
}

export async function reasonByValue(client: DbClient, value: string): Promise<RecoveryReason> {
  const r = await client.statusCode.findFirst({
    where: { category: RECOVERY_REASON_CATEGORY, value },
    select: { id: true, name: true, value: true },
    orderBy: { order: 'asc' },
  })
  if (!r) throw new RegistryError(400, `회수 사유 마스터에 ${value} 값이 없습니다 — 설정에서 등록하세요`)
  return r
}

// ─────────────────────────────────────────────────────────────────────────────
// 용도 마스터 (StatusCode DEVICE_USAGE_TYPE — 2026-09-01 결정: SALE 판매용 / EVAL 평가용, NULL=미지정)
// ─────────────────────────────────────────────────────────────────────────────

export type UsageType = UsageTypeRef

export async function loadUsageTypes(client: DbClient): Promise<UsageType[]> {
  return client.statusCode.findMany({
    where: { category: DEVICE_USAGE_TYPE_CATEGORY },
    select: { id: true, name: true, value: true },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
  })
}

/** 용도 id 검증 — null/undefined는 미지정(null) 반환, 마스터에 없으면 400 */
export async function requireUsageType(client: DbClient, usageTypeId: number | null | undefined): Promise<UsageType | null> {
  if (usageTypeId == null) return null
  if (!Number.isInteger(usageTypeId) || usageTypeId <= 0) throw new RegistryError(400, USAGE_TYPE_INVALID_MESSAGE)
  const r = await client.statusCode.findFirst({
    where: { id: usageTypeId, category: DEVICE_USAGE_TYPE_CATEGORY },
    select: { id: true, name: true, value: true },
  })
  if (!r) throw new RegistryError(400, USAGE_TYPE_INVALID_MESSAGE)
  return r
}

/**
 * 행 단위 용도 해석 — `usageTypeId`(검증) > `usageTypeInput`(name/value 별칭 매칭) > 기본값(폼 공통). 미매칭 입력은 400.
 * 호출부가 마스터를 한 번 로드해 넘긴다(임포트 2,000행).
 */
export function resolveUsageTypeInput(
  types: readonly UsageType[],
  input: { usageTypeId?: number | null; usageTypeInput?: string | null },
  defaultId: number | null | undefined
): UsageType | null {
  if (input.usageTypeId != null) {
    const t = types.find((x) => x.id === Number(input.usageTypeId))
    if (!t) throw new RegistryError(400, USAGE_TYPE_INVALID_MESSAGE)
    return t
  }
  const matched = matchUsageType(types, input.usageTypeInput)
  if (matched === undefined) throw new RegistryError(400, USAGE_TYPE_INVALID_MESSAGE)
  if (matched) return matched
  if (defaultId != null) return types.find((x) => x.id === Number(defaultId)) ?? null
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// 상품유형(일반/라이트) — 배치 속성(B-22, 2026-09-01). 기본값은 병원 계약완료 딜의 상품유형 분포(§9.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 병원의 계약완료 딜을 `sales_deals.product_type`으로 묶어 상품유형 문맥을 만든다(§9.1 per-type expected 공용).
 * 어휘 밖의 값(NULL 등)은 types에서 제외하되 deals 수에는 포함한다.
 */
export async function getHospitalProductTypeContext(hospitalCode: string, client: DbClient = prisma): Promise<ProductTypeContext> {
  const rows = await client.$queryRaw<{ product_type: string | null; deals: number; devices: number | null }[]>`
    SELECT sd.product_type, count(*)::int AS deals, sum(coalesce(sd.daewoong_device_count, 0))::int AS devices
      FROM sales_deals sd JOIN status_codes sc ON sc.id = sd.status_id
     WHERE sd.hospital_code = ${hospitalCode} AND sc.category = ${DEAL_STATUS_CATEGORY} AND sc.name = ${DEAL_STATUS_CONTRACTED}
     GROUP BY 1`
  const byType = PRODUCT_TYPES.flatMap((t) => {
    const r = rows.find((x) => x.product_type === t)
    return r ? [{ type: t, deals: Number(r.deals), devices: Number(r.devices ?? 0) }] : []
  })
  const types = byType.map((b) => b.type)
  return {
    types,
    default: types.length === 1 ? types[0] : null,
    mixed: types.length >= 2,
    deals: rows.reduce((s, r) => s + Number(r.deals), 0),
    byType,
  }
}

/** 상품유형 입력(별칭 매칭) — 빈 값 null, 미매칭 400 */
export function parseProductTypeInput(input: string | null | undefined): ProductType | null {
  const m = matchProductType(input)
  if (m === undefined) throw new RegistryError(400, PRODUCT_TYPE_INVALID_MESSAGE)
  return m
}

/**
 * 행 단위 상품유형 해석 — `explicit`(입력 별칭, 미매칭 400) > 폼 기본값 > 병원 문맥 규칙(`resolveProductTypeDefault`).
 * 오류(혼합 병원 + 미지정)는 던지지 않고 결과에 실어 호출부가 400/판정 error로 바꾼다.
 */
export function resolveProductTypeInput(
  ctx: ProductTypeContext | null,
  input: { productTypeInput?: string | null; productType?: ProductType | null },
  formDefault: ProductType | null | undefined
): ProductTypeResolution {
  const explicit = input.productType ?? parseProductTypeInput(input.productTypeInput) ?? formDefault ?? null
  return resolveProductTypeDefault(ctx, explicit)
}

// ─────────────────────────────────────────────────────────────────────────────
// 계약건(딜) 소프트 참조 (B-23, 2026-09-02) — 배치가 속한 딜을 deal_code 문자열로만 가리킨다(FK 없음 — 딜 재적재·삭제 대비, 티켓 ref 선례)
// ─────────────────────────────────────────────────────────────────────────────

export const DEAL_NOT_OF_HOSPITAL_MESSAGE = '이 병원의 계약완료 딜이 아닙니다'
export const DEAL_PRODUCT_TYPE_CONFLICT_MESSAGE = '선택한 계약건의 상품유형과 다릅니다'

export interface HospitalDealRow {
  dealCode: string
  roundNo: number
  /** sales_deals.product_type — 일반/라이트(딜이 정하는 자리의 판매 조건) */
  productType: string | null
  /** Σ daewoong_device_count (도입 수량) */
  count: number
  contractDate: string | null
}

export interface HospitalDealContext {
  /** 계약완료 딜(차수 오름차순) */
  deals: HospitalDealRow[]
  /** 계약완료 딜이 정확히 1건이면 그 딜(미지정 입력의 자동 기본값) */
  single: HospitalDealRow | null
}

/** 병원의 계약완료 딜 목록 — §9.1과 같은 조인(SALES_DEAL_STATUS='계약완료'), 딜 코드·상품유형·도입 수량 */
export async function getHospitalDealContext(hospitalCode: string, client: DbClient = prisma): Promise<HospitalDealContext> {
  const rows = await client.$queryRaw<{ deal_code: string; round_no: number; product_type: string | null; contract_date: Date | null; cnt: number | null }[]>`
    SELECT sd.deal_code, sd.round_no, sd.product_type, sd.contract_date, sd.daewoong_device_count AS cnt
      FROM sales_deals sd JOIN status_codes sc ON sc.id = sd.status_id
     WHERE sd.hospital_code = ${hospitalCode} AND sc.category = ${DEAL_STATUS_CATEGORY} AND sc.name = ${DEAL_STATUS_CONTRACTED}
     ORDER BY sd.round_no`
  const deals = rows.map((r) => ({ dealCode: r.deal_code, roundNo: r.round_no, productType: r.product_type, count: Number(r.cnt ?? 0), contractDate: toYmd(r.contract_date) }))
  return { deals, single: deals.length === 1 ? deals[0] : null }
}

export interface DealResolution {
  deal: HospitalDealRow | null
  /** 딜에서 파생된 상품유형(명시 상품유형이 없고 딜이 정해졌을 때만 non-null) */
  productTypeFromDeal: ProductType | null
}

/**
 * 계약건 해석(B-23) — 선택 입력.
 * - 명시 코드: 이 병원 계약완료 딜에 있어야 한다(없으면 409). 명시 상품유형이 딜의 유형과 다르면 400.
 * - 미지정: 계약완료 딜이 정확히 1건이면 자동 기본값. 단, 명시 상품유형이 그 딜의 유형과 다르면 **자동 기본값을 버린다**
 *   (명시 유형이 "이 딜 소속이 아님"을 말하므로 — 400이 아니라 미지정. 400은 명시 선택에만).
 * - 딜이 정해지고 명시 상품유형이 없으면 상품유형은 딜의 유형에서 파생(유형 기본값 규칙보다 우선).
 */
export function resolveDealInput(
  ctx: HospitalDealContext | null | undefined,
  explicitDealCode: string | null | undefined,
  explicitProductType: ProductType | null
): DealResolution {
  const code = explicitDealCode != null && String(explicitDealCode).trim() ? String(explicitDealCode).trim() : null
  if (code) {
    const deal = ctx?.deals.find((d) => d.dealCode === code) ?? null
    if (!deal) throw new RegistryError(409, DEAL_NOT_OF_HOSPITAL_MESSAGE)
    if (explicitProductType && isProductType(deal.productType) && deal.productType !== explicitProductType) {
      throw new RegistryError(400, DEAL_PRODUCT_TYPE_CONFLICT_MESSAGE)
    }
    return { deal, productTypeFromDeal: explicitProductType == null && isProductType(deal.productType) ? deal.productType : null }
  }
  const auto = ctx?.single ?? null
  if (!auto) return { deal: null, productTypeFromDeal: null }
  if (explicitProductType && isProductType(auto.productType) && auto.productType !== explicitProductType) {
    return { deal: null, productTypeFromDeal: null } // 자동 기본값 폐기 — 명시 유형이 단일 딜과 다름
  }
  return { deal: auto, productTypeFromDeal: explicitProductType == null && isProductType(auto.productType) ? auto.productType : null }
}

// ─────────────────────────────────────────────────────────────────────────────
// 병동 해석 · 자동 생성 (§5.2 — name_norm 매칭, ON CONFLICT 업서트, name_norm 오름차순 생성)
// ─────────────────────────────────────────────────────────────────────────────

export interface WardRef {
  id: number
  hospitalCode: string
  name: string
  nameNorm: string
  extWardCode: string | null
  isActive: boolean
  /** 이번 호출에서 새로 생성됨 */
  isNew: boolean
}

export async function listHospitalWards(client: DbClient, hospitalCode: string): Promise<WardRef[]> {
  const rows = await client.hospitalWard.findMany({
    where: { hospitalCode },
    select: { id: true, hospitalCode: true, name: true, nameNorm: true, extWardCode: true, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
  return rows.map((r) => ({ ...r, isNew: false }))
}

/** id 지정 병동 — 병원 소속(404)·활성(409) 검사 */
export async function getWardById(client: DbClient, hospitalCode: string, wardId: number): Promise<WardRef> {
  if (!Number.isInteger(wardId) || wardId <= 0) throw new RegistryError(400, '병동 id가 올바르지 않습니다')
  const w = await client.hospitalWard.findFirst({
    where: { id: wardId, hospitalCode },
    select: { id: true, hospitalCode: true, name: true, nameNorm: true, extWardCode: true, isActive: true },
  })
  if (!w) throw new RegistryError(404, '병동을 찾을 수 없습니다 (이 병원 소속이 아님)')
  if (!w.isActive) throw new RegistryError(409, `폐쇄된 병동입니다: ${w.name}`)
  return { ...w, isNew: false }
}

interface UpsertWardRow {
  id: number
  name: string
  name_norm: string
  ext_ward_code: string | null
  is_active: boolean
  inserted: boolean
}

/**
 * 병동 자동 생성 — `INSERT … ON CONFLICT (hospital_code, name_norm) DO UPDATE SET name_norm=EXCLUDED.name_norm RETURNING …`
 * (동시 임포트 안전, 기존 행이면 그대로 반환). `is_active=false`면 폐쇄 병동 매칭 → 409.
 */
export async function createWardIfMissing(
  client: DbClient,
  hospitalCode: string,
  name: string,
  extWardCode: string | null = null
): Promise<WardRef> {
  const display = name.trim()
  const nameNorm = normalizeWardName(display)
  if (!nameNorm) throw new RegistryError(400, '병동명이 비어 있습니다')
  // created_at/updated_at은 Prisma가 쓰는 값과 같은 기준(UTC 인스턴트)으로 — 컬럼이 timestamp without time zone이라
  // 세션 timezone(Asia/Seoul)의 NOW()/DEFAULT CURRENT_TIMESTAMP를 그대로 넣으면 9시간 앞선 값이 저장된다
  const rows = await client.$queryRaw<UpsertWardRow[]>`
    INSERT INTO hospital_wards (hospital_code, name, name_norm, ext_ward_code, sort_order, created_at, updated_at)
    VALUES (${hospitalCode}, ${display}, ${nameNorm}, ${extWardCode},
            COALESCE((SELECT MAX(sort_order) FROM hospital_wards WHERE hospital_code = ${hospitalCode}), -1) + 1,
            timezone('utc', now()), timezone('utc', now()))
    ON CONFLICT (hospital_code, name_norm) DO UPDATE SET name_norm = EXCLUDED.name_norm
    RETURNING id, name, name_norm, ext_ward_code, is_active, (xmax = 0) AS inserted`
  const r = rows[0]
  if (!r.is_active) throw new RegistryError(409, `폐쇄된 병동입니다: ${r.name}`)
  return { id: r.id, hospitalCode, name: r.name, nameNorm: r.name_norm, extWardCode: r.ext_ward_code, isActive: r.is_active, isNew: r.inserted }
}

/**
 * 병동명 여러 개를 한 번에 해석 — 기존 병동은 name_norm 매칭, 없으면(autoCreate) name_norm 오름차순으로 순차 생성(락 순서 고정).
 * 반환 키는 name_norm. 폐쇄 병동 매칭 → 409, autoCreate=false인데 없음 → 404.
 */
export async function resolveWardsByName(
  client: DbClient,
  hospitalCode: string,
  names: readonly string[],
  opts: { autoCreate: boolean }
): Promise<Map<string, WardRef>> {
  const out = new Map<string, WardRef>()
  const wanted = new Map<string, string>() // nameNorm → 표시명(첫 입력)
  for (const raw of names) {
    const display = (raw ?? '').trim()
    const norm = normalizeWardName(display)
    if (!norm) continue
    if (!wanted.has(norm)) wanted.set(norm, display)
  }
  if (wanted.size === 0) return out
  const existing = await client.hospitalWard.findMany({
    where: { hospitalCode, nameNorm: { in: Array.from(wanted.keys()) } },
    select: { id: true, hospitalCode: true, name: true, nameNorm: true, extWardCode: true, isActive: true },
  })
  for (const w of existing) {
    if (!w.isActive) throw new RegistryError(409, `폐쇄된 병동입니다: ${w.name}`)
    out.set(w.nameNorm, { ...w, isNew: false })
  }
  const missing = Array.from(wanted.keys()).filter((k) => !out.has(k)).sort()
  if (missing.length > 0 && !opts.autoCreate) {
    throw new RegistryError(404, `병동을 찾을 수 없습니다: ${missing.map((k) => wanted.get(k)).join(', ')}`)
  }
  for (const norm of missing) {
    out.set(norm, await createWardIfMissing(client, hospitalCode, wanted.get(norm)!))
  }
  return out
}

/** `{ wardId } | { wardName }` 한 건 해석. 둘 다 없으면 null(미지정). */
export async function resolveWardInput(
  client: DbClient,
  hospitalCode: string,
  input: { wardId?: number | null; wardName?: string | null },
  opts: { autoCreate: boolean }
): Promise<WardRef | null> {
  if (input.wardId != null) return getWardById(client, hospitalCode, Number(input.wardId))
  const name = (input.wardName ?? '').trim()
  if (!name) return null
  const map = await resolveWardsByName(client, hospitalCode, [name], opts)
  return map.get(normalizeWardName(name)) ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// 기타 공용
// ─────────────────────────────────────────────────────────────────────────────

/** 병원명 조회(충돌 응답·문구용) — 없는 코드는 null */
export async function hospitalNames(client: DbClient, codes: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(codes.filter((c): c is string => !!c)))
  const map = new Map<string, string>()
  if (uniq.length === 0) return map
  const rows = await client.hospital.findMany({ where: { hospitalCode: { in: uniq } }, select: { hospitalCode: true, hospitalName: true } })
  for (const r of rows) map.set(r.hospitalCode, r.hospitalName)
  return map
}

/** 병동명 조회 — id → name */
export async function wardNames(client: DbClient, ids: readonly (number | null | undefined)[]): Promise<Map<number, string>> {
  const uniq = Array.from(new Set(ids.filter((i): i is number => i != null)))
  const map = new Map<number, string>()
  if (uniq.length === 0) return map
  const rows = await client.hospitalWard.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } })
  for (const r of rows) map.set(r.id, r.name)
  return map
}

export function uniqInts(values: readonly unknown[]): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  for (const v of values) {
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}
