/**
 * AS접수 ↔ 기기현황 연동 서비스 (as_work_design.md §5 — 1차 범위: 기기현황만, WMS 제외)
 *
 * - 접수 등록: 라인별 원장 매칭(같은 병원 ACTIVE) → openDeviceAs(ref 'AS') — 미등록·이미 AS중은 경고 수집 후 스킵
 * - 라인 결과 확정: 수리반환 clearDeviceAs / 교체 replaceDevice(fold 자동 해제) / 분실 recoverDevice(LOST) / 취소 clearDeviceAs
 * - 미등록 라인(deviceId NULL)은 이벤트 전부 스킵(경고) — 추후 백필(§12)
 * 이벤트는 전부 lib/deviceRegistry 서비스 함수 경유(§7.0 유일한 쓰기자), ctx.ref = { type:'AS', code }.
 *
 * 기기 상태·위치 축 연동 (2026-09-17 — projects/device_condition_location_design.md §7.2·§7.3):
 * - 입고처리·입고 확인(정상입고·편입·치환)은 `intakeDevice`(AS_WAITING·리프레시센터, ref별 1회 기록 B-37)
 * - 수리완료 체크 `setAsLineRepaired`(REPAIR_DONE / 해제는 CORRECT) · 폐기 `scrapAsLineDevice`(SCRAP) — outcome·헤더 전이·완료 판정에 개입하지 않는 제3축
 * - IN_USE 복귀(수리반환·라인 취소·미회수·라인 제거·접수 삭제·시리얼 보정)는 단일 소스 `setUnitInUse` — 되돌림 게이트 `ownsDeviceState` 통과 시에만,
 *   플래그 소유(as_ref_code === asCode)면 AS_CLEAR 행 / 아니면 CORRECT 폴백(ref AS·memo 표 §7.3)
 * - 라인 `repaired_at`은 접수 문맥의 기록, 유닛 `condition`은 실물 상태 — 어긋나는 경로(시리얼 보정·원장 확정·병원 변경)는 `reapplyLineState`로 재적용
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { DEVICE_CONCURRENT_CHANGE_MESSAGE, DEVICE_REPAIR_IN_USE_MESSAGE, deviceConditionLabel, normalizeSerial, todayKst } from '@/lib/deviceRegistryShared'
import {
  openDeviceAs, clearDeviceAs, replaceDevice, recoverDevice, registerDevicesIn, RegistryError,
  intakeDevice, markDeviceRepaired, undoDeviceRepaired, scrapDevice, applyUnitState, unitStateOf, latestSnapshotEvent, eventHospitalOf, getUnitOr404, prepareCtx,
  type RegistryCtx, type UnitStateSnapshot,
} from '@/lib/deviceRegistry'
import { syncAsReceiptToTicket, createTicketForAsReceipt } from '@/lib/ticket-domains/asReceipt'
import { AS_PICKUP_METHODS, defaultAsPickupMethod, AS_OUTCOMES, AS_RESOLVE_OUTCOMES, asResolveOutcomesFor, canMarkAsLineFound, AS_CATEGORIES, AS_DEST_TYPES, AS_OUTCOME_LABELS, AS_REPAIR_EXCLUDED_OUTCOMES, AS_REPAIR_RESULT_DESC, AS_REPAIR_RESULT_LABELS, type AsRepairResult, type AsSettableRepairResult, appendAsNote as appendNote, asDeviceKindFromSerial, canMarkAsLineRepaired, isValidAsSerial, asSerialFormatError, AS_SERIAL_RULE_TEXT, type AsOutcome } from '@/lib/asReceiptShared'
import { nextAsCode } from '@/lib/asReceipt'
import { editEvent } from '@/lib/deviceRegistry/admin' // 분할 — 이동 라인 유닛의 AS ref 정정 (2026-11-07)
import { reasonByValue } from '@/lib/deviceRegistry/core' // 되찾음 — 교체기기 회수 사유 RETURN (2026-11-10)
import { prepareStockOutCreate, createStockOutRequestIn, StockOutCreateError } from '@/lib/stockOutCreate' // 분실 AS [출고요청] (2026-11-10)
import { asDeviceGroupOf, isAsLineLockedByStockOut } from '@/lib/asReceiptShared'
import { AS_CATEGORY_LABELS, type AsCategory } from '@/lib/asReceiptShared'
import { addTicketEvent } from '@/lib/ticket'

type DbClient = Prisma.TransactionClient | typeof prisma

export class AsServiceError extends Error {
  status: 400 | 404 | 409
  constructor(status: 400 | 404 | 409, message: string) {
    super(message)
    this.name = 'AsServiceError'
    this.status = status
  }
}

/** 시리얼 형식 게이트 (2026-09-30) — 비정상 시리얼 라인은 [시리얼 보정] 전까지 이후 처리 불가(409). 판정 단일 소스 lib/asReceiptShared.isValidAsSerial */
function assertAsSerialOk(serialNo: string): void {
  const err = asSerialFormatError(serialNo)
  if (err) throw new AsServiceError(409, err)
}
/** 입력 시리얼(교체기·입고·보정) 형식 검증 — 400 */
function assertInputSerialOk(serialNo: string, what: string): void {
  if (!isValidAsSerial(serialNo)) throw new AsServiceError(400, `${what} 시리얼 형식 오류: ${serialNo} (${AS_SERIAL_RULE_TEXT})`)
}

const ymd = (d: Date | string | null | undefined): string | null =>
  d ? (typeof d === 'string' ? d : d.toISOString()).slice(0, 10) : null

// ── 시리얼 매칭 (등록 미리보기 + 생성 공용) ─────────────────────────────

export type MatchState = 'ACTIVE_HERE' | 'ACTIVE_OTHER' | 'RECOVERED' | 'NONE'

export interface SerialMatch {
  serialNo: string
  state: MatchState
  deviceId: number | null
  modelName: string | null
  wardName: string | null
  /** ACTIVE_OTHER일 때 배치 병원명 */
  hospitalName: string | null
  asOpen: boolean
  asRefCode: string | null
}

/** 정규화 시리얼 → 원장 매칭. NONE = 미등록(경고 후 허용 — 결정 7) */
export async function matchSerials(client: DbClient, hospitalCode: string, serials: readonly string[]): Promise<SerialMatch[]> {
  const keys = serials.map((s) => normalizeSerial(s).serialNo).filter(Boolean)
  const units = keys.length
    ? await client.deviceUnit.findMany({
        where: { serialNo: { in: Array.from(new Set(keys)) } },
        select: {
          id: true,
          serialNo: true,
          deviceInfo: { select: { deviceName: true } },
          placement: {
            select: {
              status: true, hospitalCode: true, asStartedOn: true, asRefCode: true,
              ward: { select: { name: true } },
              hospital: { select: { hospitalName: true } },
            },
          },
        },
      })
    : []
  const bySerial = new Map(units.map((u) => [u.serialNo, u]))
  return keys.map((key) => {
    const u = bySerial.get(key)
    if (!u || !u.placement) {
      return { serialNo: key, state: 'NONE' as const, deviceId: null, modelName: u?.deviceInfo.deviceName ?? null, wardName: null, hospitalName: null, asOpen: false, asRefCode: null }
    }
    const p = u.placement
    const base = {
      serialNo: key,
      deviceId: u.id,
      modelName: u.deviceInfo.deviceName,
      wardName: p.ward?.name ?? null,
      asOpen: !!p.asStartedOn,
      asRefCode: p.asRefCode,
    }
    if (p.status === 'ACTIVE' && p.hospitalCode === hospitalCode) return { ...base, state: 'ACTIVE_HERE' as const, hospitalName: null }
    if (p.status === 'ACTIVE') return { ...base, state: 'ACTIVE_OTHER' as const, hospitalName: p.hospital?.hospitalName ?? p.hospitalCode }
    return { ...base, state: 'RECOVERED' as const, hospitalName: null }
  })
}

/** 매칭 상태 → 등록 시 경고 문구 (없으면 null) */
export function matchWarning(m: SerialMatch): string | null {
  switch (m.state) {
    case 'NONE': return `${m.serialNo}: 기기 현황에 등록되지 않은 기기입니다 — 미등록 라인으로 접수(연동 스킵)`
    case 'ACTIVE_OTHER': return `${m.serialNo}: 타 병원(${m.hospitalName ?? '-'}) 배치 중 — AS 표시 스킵, 배치 확인 필요`
    case 'RECOVERED': return `${m.serialNo}: 회수 상태 기기 — AS 표시 스킵`
    default: return m.asOpen ? `${m.serialNo}: 이미 AS진행중(${m.asRefCode ?? '참조 없음'}) — 표시 유지` : null
  }
}

// ── AS 플래그 켜기 (생성·라인 추가 공용) ─────────────────────────────────

interface FlagTarget { serialNo: string; deviceId: number }

/** ACTIVE_HERE·미표시 라인에 openDeviceAs — 실패(409 등)는 경고로 수집, 호출부 트랜잭션은 계속 */
export async function openAsFlags(
  tx: Prisma.TransactionClient,
  receipt: { asCode: string; hospitalCode: string },
  targets: readonly FlagTarget[],
  actor: { userId: string | null; name: string | null },
  occurredOn: string
): Promise<string[]> {
  const warnings: string[] = []
  const ctx: RegistryCtx = {
    hospitalCode: receipt.hospitalCode,
    actor,
    occurredOn,
    source: 'MANUAL',
    ref: { type: 'AS', code: receipt.asCode },
  }
  for (const t of targets) {
    try {
      await openDeviceAs(ctx, { deviceId: t.deviceId }, { client: tx })
    } catch (e) {
      if (e instanceof RegistryError) warnings.push(`${t.serialNo}: AS 표시 실패 — ${e.message}`)
      else throw e
    }
  }
  return warnings
}

// ── 기기 상태·위치 축 훅 (2026-09-17 — device_condition_location_design.md §7.3) ─────────────
// 원장 함수는 tx 합류(`{ client: tx }`) — RegistryError(409 등)는 유닛 쓰기 전에만 발생하므로 경고로 흡수, RegistryTxAbort·그 외는 전파(tx 롤백).

/** AS 서비스 공용 원장 문맥 — ref { AS, asCode } 고정 */
function asCtx(receipt: { asCode: string; hospitalCode: string }, actor: { userId: string | null; name: string | null }, occurredOn: string, memo?: string | null): RegistryCtx {
  return { hospitalCode: receipt.hospitalCode, actor, occurredOn, source: 'MANUAL', ref: { type: 'AS', code: receipt.asCode }, ...(memo ? { memo } : {}) }
}

/**
 * 되돌림 게이트 — 그 유닛의 **id 순 마지막 스냅샷 이벤트**의 ref가 이 접수(AS)이거나 AS ref가 아니면(REGISTER·드로어 경유·WMS 출고 INVENTORY_TX 등) 통과,
 * 스냅샷 이벤트가 0건(배포 전 이벤트만 가진 유닛)이어도 통과. **타 접수**(ref_type AS ∧ ref_code ≠ asCode)만 불통과 — `by`에 그 접수 코드.
 * (P2 리뷰 2026-09-17: ref_type을 보지 않아 비AS ref를 '다른 접수'로 오판·오도하던 결함 수정 — §7.3 '타 접수 소유 판정'이 의도)
 */
export async function ownsDeviceState(tx: Prisma.TransactionClient, asCode: string, deviceId: number): Promise<{ owns: boolean; by: string | null }> {
  const latest = await latestSnapshotEvent(tx, deviceId)
  if (!latest || !latest.refCode || latest.refType !== 'AS') return { owns: true, by: null }
  return { owns: latest.refCode === asCode, by: latest.refCode }
}

export interface SetUnitInUseOpts {
  /** true = 위치를 배치 병원으로(수리반환·미회수·제거·삭제·시리얼 보정) / false = 위치 유지(라인 취소 — I-4 예외, [병원 반환]으로 해소) */
  locationToHospital: boolean
  /** CORRECT 폴백 memo(§7.3 표 — '수리반환 확정 AS-…' 등). AS_CLEAR 행에도 같은 memo */
  memo: string
}

/**
 * IN_USE 복귀 단일 소스 — 게이트(`ownsDeviceState`) 통과 시에만, 배치 **ACTIVE_SAME**(ctx.hospitalCode)에서만 실행. RECOVERED·타병원 ACTIVE는 경고만.
 * 스냅샷을 싣는 이벤트는 플래그 소유로 분기: `as_ref_code === asCode`면 `clearDeviceAs(locationToHospital)`의 AS_CLEAR 행 /
 * 플래그 없음·타 접수 플래그면 CORRECT(condition IN_USE, ref AS) + 플래그 유지 + 경고. 모든 RegistryError는 경고 흡수(유닛 쓰기 전 409만 발생).
 */
export async function setUnitInUse(tx: Prisma.TransactionClient, ctx: RegistryCtx, deviceId: number, opts: SetUnitInUseOpts): Promise<string[]> {
  const warnings: string[] = []
  const asCode = ctx.ref?.code ?? ''
  const ctxMemo: RegistryCtx = { ...ctx, memo: ctx.memo ?? opts.memo }
  let serial = `#${deviceId}`
  try {
    const { unit, placement } = await getUnitOr404(tx, deviceId)
    serial = unit.serialNo
    const gate = await ownsDeviceState(tx, asCode, deviceId)
    if (!gate.owns) {
      // 게이트 불통과면 경고·유지(§7.3). 이 접수가 켠 플래그는 그대로 남으므로 해소 방법을 함께 안내한다(P2 리뷰 2026-09-17 — 종결 접수를 가리키는 AS 표시 잔존 케이스)
      const orphanFlag = placement?.asStartedOn && placement.asRefCode === asCode ? ' · 이 접수의 AS 표시가 남아 있습니다 — 기기현황에서 해제하세요' : ''
      warnings.push(`${serial}: 다른 접수(${gate.by})가 최근 상태를 기록 — 기기 상태 유지${orphanFlag}`)
      return warnings
    }
    if (placement?.status !== 'ACTIVE' || placement.hospitalCode !== (ctx.hospitalCode ?? null)) {
      warnings.push(`${serial}: 배치가 ${placement?.status === 'ACTIVE' ? '타 병원' : '회수 상태'}라 기기 상태를 되돌리지 않았습니다`)
      return warnings
    }
    if (placement.asStartedOn && placement.asRefCode === asCode) {
      // 이 접수가 켠 플래그 — AS_CLEAR 행에 스냅샷(AS_WAITING/REPAIRED/NULL → IN_USE)
      // 처리일이 AS 표시 시작일보다 앞서면('미등록 라인 → 발송(D-1) → 원장 확정(AS_OPEN=오늘) → 최종확정(발송일)' 소급 흐름) 원장 fold가 해제를 접지 못하고
      // (2026-09-11 E2E) 소급 차단 `assertNoLaterSnapshotAxisEvent`도 409로 막아 기기가 AS_WAITING·센터·플래그로 남는다 → 업무일자를 표시 시작일로 **클램프**해 기록
      // (§7.3, P2 리뷰 2026-09-17 — 이전 경고 문구 '처리일을 표시 시작일 이후로 다시 처리'의 자동화). CORRECT 폴백은 배치 축이 아니라 소급 차단 대상이 아님
      const startedOn = ymd(placement.asStartedOn)!
      const requested = ctx.occurredOn ?? todayKst()
      const occurredOn = requested < startedOn ? startedOn : requested
      if (occurredOn !== requested) warnings.push(`${serial}: 처리일(${requested})이 AS 표시 시작일(${startedOn})보다 앞서 AS 해제를 ${startedOn}로 기록했습니다`)
      const r = await clearDeviceAs({ ...ctxMemo, occurredOn }, { deviceId, locationToHospital: opts.locationToHospital }, { client: tx })
      if (r.device.asStartedOn) warnings.push(`${serial}: AS진행중 표시가 남았습니다 — 기기현황에서 AS 해제 후 [병원 반환]으로 정리하세요`)
      warnings.push(...r.warnings)
      return warnings
    }
    // 플래그 없음 · 타 접수 플래그 — CORRECT 폴백(플래그 유지)
    if (placement.asStartedOn) warnings.push(`${serial}: 다른 접수(${placement.asRefCode ?? '참조 없음'})의 AS 표시가 남아 있습니다`)
    const before = await unitStateOf(tx, unit)
    if (before.condition === 'LOST' || before.condition === 'SCRAPPED' || before.condition === 'PRE_SHIP') {
      warnings.push(`${serial}: 기기 상태 ${deviceConditionLabel(before.condition)} — 사용중으로 되돌리지 않았습니다 (기기 상태 보정 필요)`)
      return warnings
    }
    const hospital = { kind: 'HOSPITAL' as const, code: placement.hospitalCode }
    const after: UnitStateSnapshot = { condition: 'IN_USE', location: opts.locationToHospital || before.location.kind == null ? hospital : { ...before.location } }
    const p = await prepareCtx(tx, { ...ctxMemo, hospitalCode: eventHospitalOf(placement), actionGroup: null }, { requireHospital: false })
    warnings.push(...p.warnings)
    await applyUnitState(tx, {
      unit, before, after, occurredOn: p.occurredOn,
      event: { eventType: 'CORRECT', hospitalCode: eventHospitalOf(placement), memo: p.memo, ref: p.ref, actionGroup: p.actionGroup, source: p.source, productType: placement.productType, dealCode: placement.dealCode, actor: p.actor },
    })
  } catch (e) {
    if (e instanceof RegistryError) warnings.push(`${e.message.startsWith(`${serial}:`) ? '' : `${serial}: `}기기 상태 복귀 실패 — ${e.message}`)
    else throw e
  }
  return warnings
}

/**
 * 라인의 입고·수리완료 기록을 (새) 기기에 재적용 — 시리얼 보정 신기기·원장 확정·병원 변경 재생성 라인(§7.3).
 * `intake_state='RECEIVED'`면 `intakeDevice(occurredOn=received_at)`, `repaired_at`이 있으면 `markDeviceRepaired(occurredOn=repaired_at)`까지. 실패는 경고.
 */
async function reapplyLineState(
  tx: Prisma.TransactionClient,
  receipt: { asCode: string; hospitalCode: string },
  actor: { userId: string | null; name: string | null },
  line: { serialNo: string; deviceId: number | null; intakeState: string; receivedAt: Date | string | null; repairedAt: Date | string | null; repairResult?: string | null; outcome?: string | null }
): Promise<string[]> {
  const warnings: string[] = []
  if (!line.deviceId || line.intakeState !== 'RECEIVED') return warnings
  if (line.outcome && line.outcome !== 'REPLACE') return warnings // 수리반환·취소·분실·미회수 확정 라인은 원장 스킵(입고 훅과 동일 규칙)
  const today = todayKst()
  try {
    await intakeDevice(asCtx(receipt, actor, ymd(line.receivedAt) ?? today), { deviceId: line.deviceId }, { client: tx })
  } catch (e) {
    if (e instanceof RegistryError) { warnings.push(`${line.serialNo}: 입고 재적용 실패 — ${e.message}`); return warnings }
    throw e
  }
  if (line.repairedAt && line.repairResult !== 'SCRAPPED') { // 폐기 라인은 기기 수리완료로 재적용하지 않는다(2026-11-02) — repairResult 없는 구 호출부는 수리로 본다
    try {
      await markDeviceRepaired(asCtx(receipt, actor, ymd(line.repairedAt) ?? today, line.repairResult === 'NO_FAULT' ? '문제없음 (회수기기 이상 없음)' : null), { deviceId: line.deviceId }, { client: tx })
    } catch (e) {
      if (e instanceof RegistryError) warnings.push(`${line.serialNo}: 수리완료 재적용 실패 — ${e.message}`)
      else throw e
    }
  }
  return warnings
}

/** 입고 훅 — deviceId 있고 `outcome ∈ {NULL, REPLACE}`만 원장 기록(그 외 종결 라인은 원장 스킵+경고). RegistryError(타병원 conflict 등)는 경고 */
async function intakeLineDevice(
  tx: Prisma.TransactionClient,
  receipt: { asCode: string; hospitalCode: string },
  actor: { userId: string | null; name: string | null },
  line: { serialNo: string; deviceId: number | null; outcome: string | null },
  receivedAt: string
): Promise<string[]> {
  if (!line.deviceId) return []
  if (line.outcome && line.outcome !== 'REPLACE') return [`${line.serialNo}: ${AS_OUTCOME_LABELS[line.outcome as AsOutcome] ?? line.outcome} 확정 라인 — 기기 상태·위치는 바꾸지 않았습니다(라인 입고 상태만 기록)`]
  try {
    await intakeDevice(asCtx(receipt, actor, receivedAt), { deviceId: line.deviceId }, { client: tx })
    return []
  } catch (e) {
    if (e instanceof RegistryError) return [`${line.serialNo}: 기기 입고 기록 실패 — ${e.message}`]
    throw e
  }
}

// ── 라인 편집 반영 (PUT — 추가/제거/텍스트 갱신) ─────────────────────────

export interface LineInput {
  serial: string
  symptom?: string | null
  wardName?: string | null
  deviceKind?: string | null
  processNote?: string | null
}

/**
 * 라인 전체 교체 반영 — 종결 라인은 제거 불가(400), 제거 라인은 이 접수가 켠 플래그만 해제(오늘 일자),
 * 추가 라인은 매칭 + AS 표시(접수일 기준). 반환: 경고 목록.
 */
export async function applyItemChanges(
  tx: Prisma.TransactionClient,
  receipt: { id: number; asCode: string; hospitalCode: string; receiptDate: Date },
  lines: readonly LineInput[],
  actor: { userId: string | null; name: string | null },
  /** 병원 변경 수정(2026-09-10) — 직전 병원 코드. 지정되고 현재와 다르면 미종결 라인 전부를 제거→재추가로 새 병원 기준 재매칭 */
  opts?: { previousHospitalCode?: string; allowInvalidSerial?: boolean }
): Promise<string[]> {
  if (!lines.length) throw new AsServiceError(400, '기기 라인을 1개 이상 입력하세요.')
  const warnings: string[] = []
  const hospitalChanged = !!opts?.previousHospitalCode && opts.previousHospitalCode !== receipt.hospitalCode
  const allExisting = await tx.asReceiptItem.findMany({ where: { receiptId: receipt.id } })
  // 병원 변경 시 미종결 기존 라인은 '없던 것'으로 취급(아래 제거 루프에서 플래그 해제·삭제 → 추가 루프에서 재매칭 생성)
  const existing = allExisting
  const byKey = new Map(allExisting.filter((i) => !(hospitalChanged && !i.outcome)).map((i) => [i.serialNo, i]))

  const nextKeys: string[] = []
  const seen = new Set<string>()
  const inputByKey = new Map<string, LineInput>()
  for (const line of lines) {
    const key = normalizeSerial(line.serial).serialNo
    if (!key) throw new AsServiceError(400, '시리얼이 비어 있습니다.')
    if (seen.has(key)) throw new AsServiceError(400, `같은 시리얼이 중복 입력되었습니다: ${key}`)
    seen.add(key)
    nextKeys.push(key)
    inputByKey.set(key, line)
    if (!byKey.has(key) && !opts?.allowInvalidSerial) assertInputSerialOk(key, '기기') // 신규 추가 라인만 — 기존 비정상 라인은 유지(보정은 correct-serial) (2026-09-30)
  }

  // 종결 라인 제거 금지
  for (const item of existing) {
    if (item.outcome && !seen.has(item.serialNo)) {
      throw new AsServiceError(400, `종결된 라인은 제거할 수 없습니다: ${item.serialNo}`)
    }
  }

  const today = todayKst()
  const clearCtx: RegistryCtx = {
    hospitalCode: opts?.previousHospitalCode ?? receipt.hospitalCode, // 해제 이벤트는 플래그를 켠 당시 병원 기준
    actor,
    occurredOn: today,
    source: 'MANUAL',
    ref: { type: 'AS', code: receipt.asCode },
  }

  // 활성 출고요청 잠금 (2026-11-10) — 묶인 미종결 라인은 제거·병원 변경 재생성 불가
  {
    const locked = await tx.asReceiptItem.findMany({
      where: { receiptId: receipt.id, outcome: null, stockOutRequestId: { not: null }, stockOutRequest: ACTIVE_STOCK_OUT_WHERE },
      select: { serialNo: true, stockOutRequest: { select: { sorCode: true } } },
    })
    const blocked = locked.filter((i) => hospitalChanged || !nextKeys.includes(i.serialNo))
    if (blocked.length) throw new AsServiceError(409, `출고요청 ${blocked[0].stockOutRequest?.sorCode ?? ''} 처리 대기 중인 라인은 제거·변경할 수 없습니다: ${blocked.map((i) => i.serialNo).join(', ')} — 먼저 출고요청을 취소하세요`)
  }
  // 제거 (미종결) — IN_USE 복귀(실물 이동 근거 없음 → 병원, 게이트·플래그 소유 판정은 setUnitInUse). 병원 변경 시 미종결 라인 전부 대상(재추가 전제)
  // 병원 변경 재생성 라인은 입고·수리완료 기록을 보존해 새 매칭 기기에 재적용한다(§7.3 — 기존 유실 결함 동반 수정)
  const carried = new Map<string, { intakeState: string; receivedAt: Date | null; receiptSerialNo: string | null; intakeSource: string; repairResult: string | null; repairedAt: Date | null; repairedById: string | null }>()
  for (const item of existing) {
    if (seen.has(item.serialNo) && !(hospitalChanged && !item.outcome)) continue
    if (hospitalChanged && !item.outcome && seen.has(item.serialNo)) {
      carried.set(item.serialNo, { intakeState: item.intakeState, receivedAt: item.receivedAt, receiptSerialNo: item.receiptSerialNo, intakeSource: item.intakeSource, repairResult: item.repairResult, repairedAt: item.repairedAt, repairedById: item.repairedById })
    }
    if (item.deviceId) {
      warnings.push(...(await setUnitInUse(tx, clearCtx, item.deviceId, { locationToHospital: true, memo: `라인 제거 ${receipt.asCode}` })))
    }
    await tx.asReceiptItem.delete({ where: { id: item.id } })
  }

  // 추가 + 텍스트 갱신
  const addedKeys = nextKeys.filter((k) => !byKey.has(k))
  const matches = addedKeys.length ? await matchSerials(tx, receipt.hospitalCode, addedKeys) : []
  const flagTargets: FlagTarget[] = []
  const reapply: { serialNo: string; deviceId: number | null; intakeState: string; receivedAt: Date | null; repairedAt: Date | null; repairResult: string | null }[] = []
  for (const m of matches) {
    const line = inputByKey.get(m.serialNo)!
    const w = matchWarning(m)
    if (w) warnings.push(w)
    const keep = carried.get(m.serialNo)
    await tx.asReceiptItem.create({
      data: {
        receiptId: receipt.id,
        serialNo: m.serialNo,
        deviceId: m.deviceId,
        deviceKind: m.deviceId ? null : line.deviceKind?.trim() || null,
        wardName: line.wardName?.trim() || m.wardName,
        symptom: line.symptom?.trim() || null,
        processNote: line.processNote?.trim() || null,
        ...(keep ? { intakeState: keep.intakeState, receivedAt: keep.receivedAt, receiptSerialNo: keep.receiptSerialNo, intakeSource: keep.intakeSource, repairResult: keep.repairResult, repairedAt: keep.repairedAt, repairedById: keep.repairedById } : {}),
      },
    })
    if (m.state === 'ACTIVE_HERE' && !m.asOpen) flagTargets.push({ serialNo: m.serialNo, deviceId: m.deviceId! })
    if (keep) reapply.push({ serialNo: m.serialNo, deviceId: m.deviceId, intakeState: keep.intakeState, receivedAt: keep.receivedAt, repairedAt: keep.repairedAt, repairResult: keep.repairResult })
  }
  warnings.push(...(await openAsFlags(tx, receipt, flagTargets, actor, ymd(receipt.receiptDate) ?? today)))
  for (const r of reapply) warnings.push(...(await reapplyLineState(tx, receipt, actor, r)))

  for (const key of nextKeys) {
    const item = byKey.get(key)
    if (!item) continue
    const line = inputByKey.get(key)!
    await tx.asReceiptItem.update({
      where: { id: item.id },
      data: {
        symptom: line.symptom !== undefined ? line.symptom?.trim() || null : undefined,
        wardName: line.wardName !== undefined ? line.wardName?.trim() || null : undefined,
        deviceKind: line.deviceKind !== undefined ? (item.deviceId ? null : line.deviceKind?.trim() || null) : undefined,
        processNote: line.processNote !== undefined ? line.processNote?.trim() || null : undefined,
      },
    })
  }
  return warnings
}

// ── 라인 결과 확정 (수리반환·교체·분실종결·라인취소 + 부분 발송) ─────────

export interface ResolveLineInput {
  itemId: number
  outcome: AsOutcome
  /** REPLACE 필수 — 교체 발송기기 시리얼 */
  newSerial?: string | null
  /** 라인별 처리내용 (2026-09-11 — 기기군 카드에서 라인마다 입력). 미지정 시 공통 processNote */
  processNote?: string | null
  /** 라인별 기준일 (2026-09-14 최종확정 — 발송 라인은 초안 단계에 입력한 발송일). 미지정 시 공통 effectiveDate */
  effectiveDate?: string | null
}

export interface ResolveInput {
  lines: ResolveLineInput[]
  /** 이벤트·발송 기준일 (기본 오늘) — 수리반환/교체는 발송일, 분실/취소는 처리일 */
  effectiveDate?: string | null
  shipMethod?: 'PARCEL' | 'VISIT' | null
  shipTrackingNo?: string | null
  /** 처리내용 (시트 Q열 대응, CX #18 — 선택 라인 전체에 기록) */
  processNote?: string | null
}

export interface ResolveResult {
  warnings: string[]
  /** 전 라인 종결 → 헤더 '완료' 자동 전이 여부 (§13-4) */
  autoCompleted: boolean
}

export async function resolveAsLines(
  receiptId: number,
  actor: { userId: string; name: string | null },
  input: ResolveInput
): Promise<ResolveResult> {
  validateResolveInput(input)
  return prisma.$transaction((tx) => resolveAsLinesIn(tx, receiptId, actor, input), { timeout: 120000, maxWait: 10000 })
}

function validateResolveInput(input: ResolveInput): void {
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new AsServiceError(400, '처리할 라인을 선택하세요.')
  for (const l of input.lines) {
    if (!Number.isInteger(l.itemId)) throw new AsServiceError(400, '라인이 올바르지 않습니다.')
    if (!AS_OUTCOMES.includes(l.outcome)) throw new AsServiceError(400, '처리 결과가 올바르지 않습니다.')
    if (l.outcome === 'NOT_RECEIVED') throw new AsServiceError(400, "'미회수'는 입고 대조의 접수자 확인에서만 확정할 수 있습니다.")
    if (l.outcome === 'REPLACE' && !normalizeSerial(l.newSerial ?? '').serialNo) {
      throw new AsServiceError(400, '교체 처리에는 발송기기 시리얼이 필요합니다.')
    }
    if (l.outcome === 'REPLACE') assertInputSerialOk(normalizeSerial(l.newSerial ?? '').serialNo, '교체 발송기기')
  }
  const effectiveDate = input.effectiveDate?.trim() || todayKst()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new AsServiceError(400, '처리일이 올바르지 않습니다 (YYYY-MM-DD).')
  for (const l of input.lines) {
    if (l.effectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(l.effectiveDate)) throw new AsServiceError(400, '라인 처리일이 올바르지 않습니다 (YYYY-MM-DD).')
  }
  const shipMethod = input.shipMethod ?? null
  if (shipMethod && shipMethod !== 'PARCEL' && shipMethod !== 'VISIT') throw new AsServiceError(400, '발송방법이 올바르지 않습니다.')
}

/**
 * 라인 결과 확정 코어 — 호출부 트랜잭션 주입형 (2026-11-10: 출고 실행이 WMS 전표와 같은 트랜잭션에서 분실 라인을 교체 확정하기 위해 분리).
 * `opts.viaStockOutRequestId` = 그 출고요청이 호출한 경우 — 그 요청에 묶여 잠긴 라인만 확정 허용. 그 외 호출은 활성 출고요청 라인 409.
 */
export async function resolveAsLinesIn(
  tx: Prisma.TransactionClient,
  receiptId: number,
  actor: { userId: string; name: string | null },
  input: ResolveInput,
  opts: { viaStockOutRequestId?: number | null } = {}
): Promise<ResolveResult> {
  validateResolveInput(input)
  const effectiveDate = input.effectiveDate?.trim() || todayKst()
  const shipMethod = input.shipMethod ?? null
  {
      const receipt = await tx.asReceipt.findUnique({
        where: { id: receiptId },
        select: {
          id: true, asCode: true, hospitalCode: true, category: true, note: true,
          status: { select: { ticketStatus: true } },
          items: { select: { id: true, serialNo: true, deviceId: true, outcome: true, intakeState: true, repairedAt: true, stockOutRequestId: true, stockOutRequest: { select: { sorCode: true, status: { select: { ticketStatus: true } } } } } },
        },
      })
      if (!receipt) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
      if (receipt.status?.ticketStatus === 'RESOLVED' || receipt.status?.ticketStatus === 'CLOSED') {
        throw new AsServiceError(409, '완료·취소된 접수는 처리할 수 없습니다.')
      }
      for (const l of input.lines) {
        if (l.outcome !== 'NOT_RECEIVED' && !asResolveOutcomesFor(receipt.category).includes(l.outcome)) {
          throw new AsServiceError(400, `${AS_OUTCOME_LABELS[l.outcome]}은(는) ${receipt.category === 'LOST' ? '분실' : '이'} 접수에서 선택할 수 없는 처리방법입니다.`) // 2026-10-30 분실 접수 수리반환 금지
        }
      }
      const byId = new Map(receipt.items.map((i) => [i.id, i]))
      const warnings: string[] = []
      const today = todayKst()
      const history: string[] = [] // 비고 이력 — 체크된 라인이 분실·취소로 확정될 때 수리완료 해제(§7.3)

      const ctxFor = (occurredOn: string): RegistryCtx => ({
        hospitalCode: receipt.hospitalCode,
        actor: { userId: actor.userId, name: actor.name },
        occurredOn,
        source: 'MANUAL',
        ref: { type: 'AS', code: receipt.asCode },
      })
      /** 분실 회수 사유 (DEVICE_RECOVERY_REASON value=LOST) — 필요 시에만 조회 */
      let lostReasonId: number | null | undefined
      const requireLostReason = async () => {
        if (lostReasonId === undefined) {
          const row = await tx.statusCode.findFirst({ where: { category: 'DEVICE_RECOVERY_REASON', value: 'LOST' }, select: { id: true } })
          lostReasonId = row?.id ?? null
        }
        if (lostReasonId == null) throw new AsServiceError(400, "기기 회수 사유 마스터에 '분실(LOST)'이 없습니다.")
        return lostReasonId
      }

      for (const l of input.lines) {
        const item = byId.get(l.itemId)
        if (!item) throw new AsServiceError(400, '이 접수의 라인이 아닙니다.')
        if (item.outcome) throw new AsServiceError(409, `이미 종결된 라인입니다: ${item.serialNo}`)
        // 활성 출고요청 잠금 (2026-11-10) — 그 출고요청의 출고 실행만 이 라인을 확정할 수 있다
        if (isAsLineLockedByStockOut(item) && item.stockOutRequestId !== (opts.viaStockOutRequestId ?? -1)) {
          throw new AsServiceError(409, `${item.serialNo}: 출고요청 ${item.stockOutRequest?.sorCode ?? ''} 처리 대기 중인 라인입니다 — 먼저 출고요청을 취소하세요`)
        }
        assertAsSerialOk(item.serialNo) // 시리얼 형식 게이트 (2026-09-30)
        // 입고 대조 게이트 (2026-09-11): 미입고·미식별입고 라인은 접수자 확인 전까지 처리 불가. 대기(PENDING)는 허용 — 방문교체·선교체는 입고 없이 처리됨
        if (item.intakeState === 'MISMATCH' || item.intakeState === 'EXTRA') {
          throw new AsServiceError(409, `${item.serialNo}: 입고 대조 확인이 필요한 라인입니다 — 접수자 확인(치환·정상입고 확정·미회수) 후 처리하세요`)
        }

        const shipped = l.outcome === 'REPAIR_RETURN' || l.outcome === 'REPLACE'
        const lineDate = l.effectiveDate?.trim() || effectiveDate
        const ctx = ctxFor(lineDate)
        const data: Prisma.AsReceiptItemUncheckedUpdateInput = {
          outcome: l.outcome,
          draftOutcome: null, // 초안 → 확정 이관 (2026-09-14)
          draftNewSerialNo: null,
          shippedAt: shipped ? new Date(lineDate) : undefined,
          // 발송방법·송장은 지정된 경우에만 덮어씀 — 초안 단계에서 라인에 먼저 기입한 값 보존 (2026-09-14)
          shipMethod: shipped && shipMethod ? shipMethod : undefined,
          shipTrackingNo: shipped && input.shipTrackingNo?.trim() ? input.shipTrackingNo.trim() : undefined,
          processNote: (l.processNote ?? input.processNote)?.trim() ? (l.processNote ?? input.processNote)!.trim() : undefined, // CX #18 — 미입력 시 기존 값 보존 (라인별 우선)
        }

        // 체크된 라인이 분실·취소로 확정되면 수리완료 해제 — n/m의 n이 m 집합 밖에 남지 않게(§7.3). 기기 condition은 아래 분기가 정한다
        if (item.repairedAt && (l.outcome === 'LOST' || l.outcome === 'CANCELED')) {
          data.repairResult = null
          data.repairedAt = null
          data.repairedById = null
          history.push(`${item.serialNo} 회수처리 해제 (${AS_OUTCOME_LABELS[l.outcome]} 확정)`)
        }

        let lineWritten = false
        if (!item.deviceId) {
          // 미등록 라인 — 기기현황 이벤트 스킵 (결정 7), 기록만
          warnings.push(`${item.serialNo}: 미등록 라인 — 기기현황에 기록되지 않았습니다`)
          if (l.outcome === 'REPLACE') data.newSerialNo = normalizeSerial(l.newSerial!).serialNo
        } else if (l.outcome === 'REPAIR_RETURN' || l.outcome === 'CANCELED') {
          // IN_USE 복귀 — 수리반환은 위치 병원, 라인 취소는 위치 유지(센터면 센터 — [병원 반환] 안내). 게이트·플래그 소유 판정은 setUnitInUse(§7.3)
          // 라인을 먼저 닫아 AS_CLEAR의 '미종결 입고 라인 있음' 경고가 이 라인 자신을 세지 않게 한다
          await tx.asReceiptItem.update({ where: { id: item.id }, data })
          lineWritten = true
          const memo = l.outcome === 'REPAIR_RETURN' ? `수리반환 확정 ${receipt.asCode}` : `라인 취소 ${receipt.asCode}`
          warnings.push(...(await setUnitInUse(tx, ctx, item.deviceId, { locationToHospital: l.outcome === 'REPAIR_RETURN', memo })))
        } else if (l.outcome === 'REPLACE') {
          const newSerial = normalizeSerial(l.newSerial!).serialNo
          try {
            const result = await replaceDevice(
              ctx,
              {
                oldDeviceId: item.deviceId,
                newSerial,
                reasonCodeId: receipt.category === 'LOST' ? await requireLostReason() : null, // 생략 시 DEFECT
              },
              { client: tx }
            )
            warnings.push(...result.warnings.map((w) => `${item.serialNo}: ${w}`))
            data.newSerialNo = newSerial
            data.newDeviceId = result.newDevice.id
          } catch (e) {
            // 교체 실패(신 시리얼 타 병원 ACTIVE 등)는 부분 성공을 남기지 않도록 전체 중단
            if (e instanceof RegistryError) throw new AsServiceError(e.status, `${item.serialNo} 교체 실패 — ${e.message}`)
            throw e
          }
        } else if (l.outcome === 'LOST') {
          try {
            await recoverDevice(ctx, { deviceId: item.deviceId, reasonCodeId: await requireLostReason() }, { client: tx })
          } catch (e) {
            if (e instanceof RegistryError) warnings.push(`${item.serialNo}: 분실 회수 기록 실패 — ${e.message}`)
            else throw e
          }
        }

        if (!lineWritten) await tx.asReceiptItem.update({ where: { id: item.id }, data })
      }
      if (history.length) {
        await tx.asReceipt.update({ where: { id: receipt.id }, data: { note: appendNote(receipt.note, `[라인 처리 ${today} ${actor.name ?? ''}] ${history.join(' · ')}`) } })
      }

      // 전 라인 종결 → 헤더 '발송완료' 자동 전이 (2026-09-11 개정 — 최종 '완료'는 4. 기기등록 카드의 [완료]로만) + 티켓 IN_PROGRESS 유지
      const autoCompleted = await advanceToShippedDone(tx, receipt.id, actor, warnings)
      return { warnings, autoCompleted }
  }
}

// ── 라인 처리방법 초안 / 최종확정 (2026-09-14) ─────────────────────────
// 담당자가 라인별 처리방법(+교체 시리얼)을 초안으로 저장해 두고 최종확정 전까지 자유롭게 변경한다.
// 초안은 기기현황·티켓·시트 역기입에 영향을 주지 않는다(outcome이 아님). 최종확정이 초안 전체를 resolveAsLines로 한 번에 확정.

export interface DraftLineInput {
  itemId: number
  outcome: AsOutcome | null // null = 초안 해제
  newSerial?: string | null
}

export async function draftAsLines(receiptId: number, input: { lines: DraftLineInput[] }): Promise<{ updated: number }> {
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new AsServiceError(400, '처리방법을 지정할 라인을 선택하세요.')
  for (const l of input.lines) {
    if (!Number.isInteger(l.itemId)) throw new AsServiceError(400, '라인이 올바르지 않습니다.')
    if (l.outcome != null && !(AS_RESOLVE_OUTCOMES as readonly string[]).includes(l.outcome)) throw new AsServiceError(400, '처리방법이 올바르지 않습니다.')
    if (l.outcome === 'REPLACE' && !normalizeSerial(l.newSerial ?? '').serialNo) throw new AsServiceError(400, '교체 초안에는 발송기기 시리얼이 필요합니다.')
    if (l.outcome === 'REPLACE') assertInputSerialOk(normalizeSerial(l.newSerial ?? '').serialNo, '교체 발송기기')
  }
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.asReceipt.findUnique({
      where: { id: receiptId },
      select: { category: true, status: { select: { ticketStatus: true } }, items: { select: { id: true, serialNo: true, outcome: true, intakeState: true, stockOutRequest: { select: { sorCode: true, status: { select: { ticketStatus: true } } } } } } },
    })
    if (!receipt) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
    if (receipt.status?.ticketStatus === 'RESOLVED' || receipt.status?.ticketStatus === 'CLOSED') throw new AsServiceError(409, '완료·취소된 접수는 처리할 수 없습니다.')
    for (const l of input.lines) {
      if (l.outcome && !asResolveOutcomesFor(receipt.category).includes(l.outcome)) {
        throw new AsServiceError(400, `${AS_OUTCOME_LABELS[l.outcome]}은(는) ${receipt.category === 'LOST' ? '분실' : '이'} 접수에서 선택할 수 없는 처리방법입니다.`) // 2026-10-30 분실 접수 수리반환 금지
      }
    }
    const byId = new Map(receipt.items.map((i) => [i.id, i]))
    let updated = 0
    for (const l of input.lines) {
      const item = byId.get(l.itemId)
      if (!item) throw new AsServiceError(400, '이 접수의 라인이 아닙니다.')
      if (item.outcome) throw new AsServiceError(409, `이미 확정된 라인은 변경할 수 없습니다: ${item.serialNo}`)
      if (l.outcome && isAsLineLockedByStockOut(item)) throw new AsServiceError(409, `${item.serialNo}: 출고요청 ${item.stockOutRequest?.sorCode ?? ''} 처리 대기 중인 라인입니다 — 먼저 출고요청을 취소하세요`) // 2026-11-10
      if (l.outcome) assertAsSerialOk(item.serialNo) // 시리얼 형식 게이트 (2026-09-30) — 초안 해제는 허용
      if (l.outcome && (item.intakeState === 'MISMATCH' || item.intakeState === 'EXTRA')) {
        throw new AsServiceError(409, `${item.serialNo}: 입고 대조 확인이 필요한 라인입니다 — 접수자 확인 후 처리방법을 지정하세요`)
      }
      await tx.asReceiptItem.update({
        where: { id: item.id },
        data: {
          draftOutcome: l.outcome,
          draftNewSerialNo: l.outcome === 'REPLACE' ? normalizeSerial(l.newSerial!).serialNo : null,
        },
      })
      updated++
    }
    return { updated }
  })
}

/** 3. AS상세내역 [최종확정] — 초안이 있는 전 라인을 한 번에 확정 (발송 라인은 라인에 기입된 발송일, 없으면 effectiveDate) */
export async function confirmAsDrafts(
  receiptId: number,
  actor: { userId: string; name: string | null },
  input: { effectiveDate?: string | null }
): Promise<ResolveResult & { confirmed: number }> {
  const drafts = await prisma.asReceiptItem.findMany({
    where: { receiptId, outcome: null, draftOutcome: { not: null } },
    select: { id: true, draftOutcome: true, draftNewSerialNo: true, shippedAt: true },
    orderBy: { id: 'asc' },
  })
  if (!drafts.length) throw new AsServiceError(400, '확정할 초안 라인이 없습니다. 라인별 처리방법을 먼저 지정하세요.')
  const lines: ResolveLineInput[] = drafts.map((d) => {
    const shipped = d.draftOutcome === 'REPAIR_RETURN' || d.draftOutcome === 'REPLACE'
    return {
      itemId: d.id,
      outcome: d.draftOutcome as AsOutcome,
      newSerial: d.draftNewSerialNo,
      effectiveDate: shipped && d.shippedAt ? ymd(d.shippedAt) : null,
    }
  })
  const r = await resolveAsLines(receiptId, actor, { lines, effectiveDate: input.effectiveDate ?? null })
  return { ...r, confirmed: lines.length }
}

// ── 입고 대조 (2026-09-11 — as_work_design.md §14) ─────────────────────────
// 입고처리: AS담당자가 실물 시리얼을 입력 → 접수 라인과 대조. 일치 → RECEIVED, 접수됐으나 없음 → MISMATCH,
// 입고됐으나 접수에 없음 → EXTRA 라인 생성(원장 매칭만, AS 표시는 편입 확정 시). 누적 실행 가능(부분 입고).
// 접수자 확인: MISMATCH → 치환(EXTRA와 매핑)·정상입고 확정·미회수 / EXTRA → 신규 편입·삭제.

export interface IntakeInput {
  serials: string[]
  receivedAt?: string | null // 입고일 (N열) — 기본 오늘
  checkedAt?: string | null // 확인일 (O열) — 기본 입고일
}
export interface IntakeResult {
  received: string[]
  mismatch: string[]
  extra: string[]
  warnings: string[]
  statusChanged: boolean
}

export async function intakeAsLines(receiptId: number, actor: { userId: string; name: string | null }, input: IntakeInput): Promise<IntakeResult> {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const raw of input.serials ?? []) {
    const k = normalizeSerial(String(raw ?? '')).serialNo
    if (!k || seen.has(k)) continue
    seen.add(k); keys.push(k)
  }
  if (!keys.length) throw new AsServiceError(400, '입고 시리얼을 1개 이상 입력하세요.')
  const badKeys = keys.filter((k) => !isValidAsSerial(k))
  if (badKeys.length) throw new AsServiceError(400, `입고 시리얼 형식 오류: ${badKeys.join(', ')} (${AS_SERIAL_RULE_TEXT})`) // 비정상 시리얼로 미식별입고 라인이 생기지 않게 (2026-09-30)
  const receivedAt = input.receivedAt?.trim() || todayKst()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedAt)) throw new AsServiceError(400, '입고일이 올바르지 않습니다 (YYYY-MM-DD).')
  const checkedAt = input.checkedAt?.trim() || receivedAt
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedAt)) throw new AsServiceError(400, '확인일이 올바르지 않습니다 (YYYY-MM-DD).')

  return prisma.$transaction(async (tx) => {
    const receipt = await tx.asReceipt.findUnique({
      where: { id: receiptId },
      select: { id: true, asCode: true, hospitalCode: true, receivedAt: true, note: true, statusId: true, status: { select: { ticketStatus: true, order: true } }, items: true },
    })
    if (!receipt) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
    // 종결 접수 사후 입고 조건부 완화 (2026-09-17 §7.3 — 선교체 구기기 수리 근거): (i) 입력 시리얼 전부가 `outcome='REPLACE' ∧ intake_state='PENDING'` 라인과
    // 일치할 때만(이미 RECEIVED인 REPLACE 라인은 무변경 통과 — 전환 0건이면 비고도 무기록, 멱등), 불일치 1건이라도 있으면 400·EXTRA 생성 금지 (ii) 입력에 없는 라인 MISMATCH 전환 없음
    // (iii) 헤더 status/received_at/checked_at 갱신 없음·비고 이력만 (iv) advanceToShippedDone 미호출(이 함수는 원래 호출하지 않음)
    const terminal = receipt.status?.ticketStatus === 'RESOLVED' || receipt.status?.ticketStatus === 'CLOSED'
    if (terminal) {
      const bad = keys.filter((k) => { const it = receipt.items.find((i) => i.serialNo === k); return !it || it.outcome !== 'REPLACE' || (it.intakeState !== 'PENDING' && it.intakeState !== 'RECEIVED') })
      if (bad.length) throw new AsServiceError(400, `완료·취소된 접수는 교체 확정 후 미입고(선교체) 라인만 사후 입고할 수 있습니다: ${bad.join(', ')}`)
    }
    const warnings: string[] = []
    const result: IntakeResult = { received: [], mismatch: [], extra: [], warnings, statusChanged: false }
    const bySerial = new Map(receipt.items.map((i) => [i.serialNo, i]))
    const matched = new Set<string>()
    const rcpt = { asCode: receipt.asCode, hospitalCode: receipt.hospitalCode }
    let transitions = 0 // 이번 호출에서 RECEIVED로 실제 전환된 라인 수

    for (const k of keys) {
      const item = bySerial.get(k)
      if (item) {
        matched.add(k)
        if (item.intakeState === 'RECEIVED') { result.received.push(k); continue } // 이미 정상입고 — 입고일 유지
        // 종결 라인의 사후 입고 (2026-09-15): 선교체·방문교체는 처리(발송)가 입고보다 앞서므로, 종결됐어도 대기(PENDING)면 정상입고로 기록한다.
        // 미회수(NOT_RECEIVED)로 종결된 미입고(MISMATCH) 라인은 접수자 확인을 거친 판단이라 자동으로 뒤집지 않는다.
        if (item.outcome && item.intakeState !== 'PENDING') { warnings.push(`${k}: 이미 종결된 라인 — 입고 상태를 바꾸지 않았습니다`); continue }
        await tx.asReceiptItem.update({ where: { id: item.id }, data: { intakeState: 'RECEIVED', receivedAt: new Date(receivedAt) } })
        transitions++
        if (item.outcome) warnings.push(`${k}: 처리 완료된 라인의 사후 입고로 기록했습니다 (${AS_OUTCOME_LABELS[item.outcome as AsOutcome] ?? item.outcome})`)
        // 기기 상태·위치 축 — 센터 입고(INTAKE: AS_WAITING·리프레시센터). outcome NULL/REPLACE만, 그 외 종결 라인은 원장 스킵+경고 (§7.3)
        warnings.push(...(await intakeLineDevice(tx, rcpt, actor, item, receivedAt)))
        result.received.push(k)
      } else {
        // 접수 외 입고 — EXTRA 라인 생성 (원장 매칭만, AS 표시·기기종류는 편입 확정 시)
        const [m] = await matchSerials(tx, receipt.hospitalCode, [k])
        const w = matchWarning(m)
        if (w) warnings.push(w)
        await tx.asReceiptItem.create({
          data: {
            receiptId: receipt.id, serialNo: k, deviceId: m.deviceId, wardName: m.wardName,
            deviceKind: m.deviceId ? null : asDeviceKindFromSerial(k), // 미등록이면 시리얼 접두로 기기종류 추정 (A 심전계 / P 산소포화도)
            intakeState: 'EXTRA', intakeSource: 'INTAKE', receivedAt: new Date(receivedAt),
          },
        })
        result.extra.push(k)
      }
    }
    // 접수 라인 중 이번 입력에 없고 아직 대기인 라인 → 미입고 (이미 정상입고·종결은 유지). 종결 접수 사후 입고는 전환 없음 (ii)
    for (const item of receipt.items) {
      if (terminal || matched.has(item.serialNo) || item.outcome) continue
      if (item.intakeState === 'PENDING') {
        await tx.asReceiptItem.update({ where: { id: item.id }, data: { intakeState: 'MISMATCH' } })
      }
      if (item.intakeState === 'PENDING' || item.intakeState === 'MISMATCH') result.mismatch.push(item.serialNo)
    }

    // 비고 이력 (사용자 요청 2026-09-11 — 입고 대조·확인 흔적을 비고에 남긴다)
    const noteLine = `[입고처리 ${receivedAt} ${actor.name ?? ''}] 입력 ${keys.length} → 정상입고 ${result.received.length}${result.mismatch.length ? ` · 미입고 ${result.mismatch.length}(${result.mismatch.join(', ')})` : ''}${result.extra.length ? ` · 미식별입고 ${result.extra.length}(${result.extra.join(', ')})` : ''}${terminal ? ' (종결 접수 사후 입고)' : ''}`
    if (terminal) {
      // (iii) 헤더 상태·입고일·확인일 무변경 — 비고 이력만. 이미 RECEIVED인 라인만 입력돼 전환 0건이면 비고도 남기지 않는다(호출마다 줄 누적 방지 — P2 리뷰 2026-09-17)
      if (!transitions) { warnings.push('이미 입고된 라인만 입력되어 변경 사항이 없습니다 (종결 접수 사후 입고)'); return result }
      await tx.asReceipt.update({ where: { id: receipt.id }, data: { note: appendNote(receipt.note, noteLine) } })
      return result
    }
    // 헤더: 입고일(최초만)·확인일 갱신, 상태가 '입고' 이전 단계면 '입고'로
    const data: Prisma.AsReceiptUncheckedUpdateInput = { checkedAt: new Date(checkedAt), note: appendNote(receipt.note, noteLine) }
    if (!receipt.receivedAt) data.receivedAt = new Date(receivedAt)
    const inbound = await tx.statusCode.findFirst({ where: { category: 'AS_STATUS', name: '입고' }, select: { id: true, order: true } })
    if (inbound && receipt.statusId !== inbound.id && (receipt.status?.order ?? 0) < inbound.order) {
      data.statusId = inbound.id
      data.statusChangedAt = new Date()
      result.statusChanged = true
    }
    await tx.asReceipt.update({ where: { id: receipt.id }, data })
    if (result.statusChanged) await syncAsReceiptToTicket(tx, receipt.id, actor.userId)
    return result
  }, { timeout: 60000, maxWait: 10000 })
}

export type IntakeConfirmAction =
  | { type: 'REMAP'; itemId: number; extraItemId: number } // 미입고 라인의 시리얼을 미식별입고 라인 시리얼로 치환 (오타 보정)
  | { type: 'MARK_RECEIVED'; itemId: number } // 미입고 → 정상입고 (입고 입력 누락 등 수동 확정)
  | { type: 'NOT_RECEIVED'; itemId: number; comment: string } // 미입고 → 미회수 종결 (코멘트 필수)
  | { type: 'ACCEPT_EXTRA'; itemId: number; deviceKind?: string | null } // 미식별입고 → 신규 라인 편입 (정상입고, AS 표시)
  | { type: 'DISCARD_EXTRA'; itemId: number } // 미식별입고 라인 삭제 (입고 입력 오타)

export async function confirmAsIntake(receiptId: number, actor: { userId: string; name: string | null }, action: IntakeConfirmAction): Promise<{ warnings: string[]; autoCompleted: boolean }> {
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.asReceipt.findUnique({
      where: { id: receiptId },
      select: { id: true, asCode: true, hospitalCode: true, receiptDate: true, note: true, status: { select: { ticketStatus: true } } },
    })
    if (!receipt) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
    if (receipt.status?.ticketStatus === 'RESOLVED' || receipt.status?.ticketStatus === 'CLOSED') throw new AsServiceError(409, '완료·취소된 접수입니다.')
    const warnings: string[] = []
    const today = todayKst()
    let history = '' // 비고 이력 한 줄
    const ctx: RegistryCtx = { hospitalCode: receipt.hospitalCode, actor, occurredOn: today, source: 'MANUAL', ref: { type: 'AS', code: receipt.asCode } }
    const rcpt = { asCode: receipt.asCode, hospitalCode: receipt.hospitalCode }
    const getItem = async (id: number) => {
      const it = await tx.asReceiptItem.findFirst({ where: { id, receiptId } })
      if (!it) throw new AsServiceError(400, '이 접수의 라인이 아닙니다.')
      if (it.outcome) throw new AsServiceError(409, `이미 종결된 라인입니다: ${it.serialNo}`)
      return it
    }
    /** 기기 상태·위치 축 — 센터 입고(INTAKE). occurredOn = 라인 입고일 ?? 오늘. 실패는 경고 (§7.3) */
    const intakeUnit = async (deviceId: number | null, serialNo: string, receivedAt: Date | string | null) =>
      warnings.push(...(await intakeLineDevice(tx, rcpt, actor, { serialNo, deviceId, outcome: null }, ymd(receivedAt) ?? today)))

    switch (action.type) {
      case 'REMAP': {
        const item = await getItem(action.itemId)
        const extra = await getItem(action.extraItemId)
        if (item.intakeState !== 'MISMATCH') throw new AsServiceError(400, `미입고 라인이 아닙니다: ${item.serialNo}`)
        if (extra.intakeState !== 'EXTRA') throw new AsServiceError(400, `미식별입고 라인이 아닙니다: ${extra.serialNo}`)
        assertAsSerialOk(extra.serialNo) // 치환 결과 시리얼은 정상이어야 함 (2026-09-30)
        // 치환 전 기기(실제로는 안 들어온 기기) — 시리얼 보정과 동일하게 IN_USE·병원 복귀(게이트·플래그 소유 판정은 setUnitInUse)
        if (item.deviceId) warnings.push(...(await setUnitInUse(tx, ctx, item.deviceId, { locationToHospital: true, memo: `시리얼 치환 ${receipt.asCode} (${item.serialNo} → ${extra.serialNo})` })))
        await tx.asReceiptItem.delete({ where: { id: extra.id } })
        await tx.asReceiptItem.update({
          where: { id: item.id },
          data: {
            serialNo: extra.serialNo, receiptSerialNo: item.receiptSerialNo ?? item.serialNo,
            deviceId: extra.deviceId, deviceKind: extra.deviceId ? null : item.deviceKind,
            wardName: item.wardName ?? extra.wardName,
            intakeState: 'RECEIVED', receivedAt: extra.receivedAt,
          },
        })
        if (extra.deviceId) {
          const [m] = await matchSerials(tx, receipt.hospitalCode, [extra.serialNo])
          if (m.state === 'ACTIVE_HERE' && !m.asOpen) warnings.push(...(await openAsFlags(tx, receipt, [{ serialNo: m.serialNo, deviceId: m.deviceId! }], actor, ymd(receipt.receiptDate) ?? today)))
          else { const w = matchWarning(m); if (w) warnings.push(w) }
          await intakeUnit(extra.deviceId, extra.serialNo, extra.receivedAt) // 치환된 기기 기준 INTAKE(occurredOn = extra.receivedAt)
        } else warnings.push(`${extra.serialNo}: 기기 현황에 등록되지 않은 기기입니다 — 미등록 라인으로 유지`)
        history = `시리얼 치환 ${item.serialNo} → ${extra.serialNo}`
        break
      }
      case 'MARK_RECEIVED': {
        const item = await getItem(action.itemId)
        if (item.intakeState !== 'MISMATCH') throw new AsServiceError(400, `미입고 라인이 아닙니다: ${item.serialNo}`)
        assertAsSerialOk(item.serialNo) // 시리얼 형식 게이트 (2026-09-30) — 비정상 시리얼은 REMAP(치환)이나 [시리얼 보정]으로만
        const receivedAt = item.receivedAt ?? new Date(today)
        await tx.asReceiptItem.update({ where: { id: item.id }, data: { intakeState: 'RECEIVED', receivedAt } })
        await intakeUnit(item.deviceId, item.serialNo, receivedAt)
        history = `${item.serialNo} 정상입고 수동 확정`
        break
      }
      case 'NOT_RECEIVED': {
        const item = await getItem(action.itemId)
        if (item.intakeState !== 'MISMATCH') throw new AsServiceError(400, `미입고 라인이 아닙니다: ${item.serialNo}`)
        assertAsSerialOk(item.serialNo) // 시리얼 형식 게이트 (2026-09-30)
        const comment = action.comment?.trim()
        if (!comment) throw new AsServiceError(400, '미회수 처리에는 코멘트가 필요합니다.')
        // 실물 이동 근거 없음 → IN_USE·병원(게이트 통과 시 — 플래그 소유면 AS_CLEAR, 아니면 CORRECT 폴백)
        if (item.deviceId) warnings.push(...(await setUnitInUse(tx, ctx, item.deviceId, { locationToHospital: true, memo: `미회수 확정 ${receipt.asCode}` })))
        // 미입고 라인은 수리완료 체크 불가(D5)지만 방어적으로 해제 — n/m 정합
        await tx.asReceiptItem.update({ where: { id: item.id }, data: { outcome: 'NOT_RECEIVED', processNote: comment, ...(item.repairedAt ? { repairResult: null, repairedAt: null, repairedById: null } : {}) } })
        history = `${item.serialNo} 미회수 종결 — ${comment}${item.repairedAt ? ' (회수처리 해제)' : ''}`
        break
      }
      case 'ACCEPT_EXTRA': {
        const item = await getItem(action.itemId)
        if (item.intakeState !== 'EXTRA') throw new AsServiceError(400, `미식별입고 라인이 아닙니다: ${item.serialNo}`)
        assertAsSerialOk(item.serialNo) // 시리얼 형식 게이트 (2026-09-30)
        const [m] = await matchSerials(tx, receipt.hospitalCode, [item.serialNo])
        await tx.asReceiptItem.update({
          where: { id: item.id },
          data: { intakeState: 'RECEIVED', deviceId: m.deviceId, deviceKind: m.deviceId ? null : action.deviceKind?.trim() || item.deviceKind, wardName: item.wardName ?? m.wardName },
        })
        if (m.state === 'ACTIVE_HERE' && !m.asOpen) warnings.push(...(await openAsFlags(tx, receipt, [{ serialNo: m.serialNo, deviceId: m.deviceId! }], actor, today)))
        else { const w = matchWarning(m); if (w) warnings.push(w) }
        await intakeUnit(m.deviceId, m.serialNo, item.receivedAt) // 편입 확정 시점에 INTAKE(occurredOn = 라인 receivedAt ?? today)
        history = `${item.serialNo} 미식별입고 → 신규 라인 편입`
        break
      }
      case 'DISCARD_EXTRA': {
        const item = await getItem(action.itemId)
        if (item.intakeState !== 'EXTRA') throw new AsServiceError(400, `미식별입고 라인이 아닙니다: ${item.serialNo}`)
        await tx.asReceiptItem.delete({ where: { id: item.id } })
        history = `${item.serialNo} 미식별입고 라인 삭제`
        break
      }
      default:
        throw new AsServiceError(400, '확인 동작이 올바르지 않습니다.')
    }
    if (history) await tx.asReceipt.update({ where: { id: receipt.id }, data: { note: appendNote(receipt.note, `[입고확인 ${today} ${actor.name ?? ''}] ${history}`) } })

    // 미회수 종결로 전 라인이 끝나면 '발송완료' 자동 전이 (라인 처리와 동일 규칙)
    const autoCompleted = await advanceToShippedDone(tx, receipt.id, actor, warnings)
    return { warnings, autoCompleted }
  }, { timeout: 60000, maxWait: 10000 })
}

// ── 원장 정합 확정 (2026-09-11 — 접수 시리얼이 미등록·미배치·회수·타병원일 때 접수 병원 배치로 보정) ─────────
// registerDevicesIn 한 번으로 신규 등록 / 재등록(회수·미배치) / 타병원 이관(TRANSFER opt-in)을 처리하고
// 라인 deviceId를 연결 + AS 표시. 이력은 비고에 남긴다. 권한: USER 이상(접수자 확인과 동일).

export interface RegistryConfirmInput {
  itemId: number
  /** 미등록 시리얼의 모델(device_name/device_model) — 접두로 판별 불가할 때 필수 */
  modelInput?: string | null
  /** 상품유형(일반/라이트) — 병원이 혼합 딜이면 필수(원장 규칙) */
  productType?: string | null
  wardName?: string | null
}

export async function confirmAsRegistry(receiptId: number, actor: { userId: string; name: string | null }, input: RegistryConfirmInput): Promise<{ warnings: string[]; kind: 'created' | 'reregistered' | 'transferred' }> {
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.asReceipt.findUnique({
      where: { id: receiptId },
      select: { id: true, asCode: true, hospitalCode: true, receiptDate: true, note: true, status: { select: { ticketStatus: true } }, hospital: { select: { hospitalName: true } } },
    })
    if (!receipt) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
    if (receipt.status?.ticketStatus === 'RESOLVED' || receipt.status?.ticketStatus === 'CLOSED') throw new AsServiceError(409, '완료·취소된 접수입니다.')
    const item = await tx.asReceiptItem.findFirst({ where: { id: input.itemId, receiptId } })
    if (!item) throw new AsServiceError(400, '이 접수의 라인이 아닙니다.')
    if (item.outcome) throw new AsServiceError(409, `이미 종결된 라인입니다: ${item.serialNo}`)
    assertAsSerialOk(item.serialNo) // 시리얼 형식 게이트 (2026-09-30) — 비정상 시리얼로 원장 신규 등록 금지 (AS-202609-0159 가짜 기기 6대 사례)
    const [m] = await matchSerials(tx, receipt.hospitalCode, [item.serialNo])
    if (m.state === 'ACTIVE_HERE') throw new AsServiceError(409, `${item.serialNo}: 이미 이 병원에 배치된 기기입니다 (정상)`)

    const today = todayKst()
    const ctx: RegistryCtx = { hospitalCode: receipt.hospitalCode, actor, occurredOn: today, source: 'MANUAL', ref: { type: 'AS', code: receipt.asCode }, memo: `AS접수 원장 확정 (${receipt.asCode})` }
    const ward = input.wardName?.trim() || item.wardName || null
    const r = await registerDevicesIn(tx, ctx, [{
      serialInput: item.serialNo,
      modelInput: input.modelInput?.trim() || null,
      wardName: ward,
      productType: input.productType?.trim() || undefined,
    }], { client: tx, conflicts: m.state === 'ACTIVE_OTHER' ? { [item.serialNo]: 'TRANSFER' } : null })
    const ref = r.created[0] ?? r.reregistered[0] ?? r.transferred[0]
    if (!ref) throw new AsServiceError(409, `${item.serialNo}: 원장 배치가 만들어지지 않았습니다${r.skipped[0]?.reason ? ` — ${r.skipped[0].reason}` : ''}`)
    const kind: 'created' | 'reregistered' | 'transferred' = r.created[0] ? 'created' : r.reregistered[0] ? 'reregistered' : 'transferred'
    const warnings = [...r.warnings]

    await tx.asReceiptItem.update({ where: { id: item.id }, data: { deviceId: ref.id, deviceKind: null, wardName: ward ?? undefined } })
    warnings.push(...(await openAsFlags(tx, receipt, [{ serialNo: item.serialNo, deviceId: ref.id }], actor, today)))
    // 이미 입고·수리완료 체크된 라인이면 새 기기에 INTAKE(received_at)·REPAIR_DONE(repaired_at) 재적용 (§7.3)
    warnings.push(...(await reapplyLineState(tx, receipt, actor, { ...item, deviceId: ref.id })))

    const kindLabel = kind === 'created' ? '원장 신규 등록' : kind === 'reregistered' ? '재등록' : `타병원(${m.hospitalName ?? '-'})에서 이관`
    await tx.asReceipt.update({ where: { id: receipt.id }, data: { note: appendNote(receipt.note, `[원장확정 ${today} ${actor.name ?? ''}] ${item.serialNo} → ${receipt.hospital?.hospitalName ?? receipt.hospitalCode} 배치 (${kindLabel}${ward ? `, ${ward}` : ''})`) } })
    return { warnings, kind }
  }, { timeout: 60000, maxWait: 10000 })
}

// ── 라인 시리얼 보정 (2026-09-15) ─────────────────────────────────────
// 채널톡·시트 인입 시리얼 오타("P018330사용중/삭제X" 등)를 담당자가 라인 단위로 고친다. 미종결 라인만.
// 원 시리얼은 receipt_serial_no에 보존(입고 대조 치환과 같은 칸 — 최초 1회만 기록), 새 시리얼로 원장 재매칭·AS 표시,
// 이전 라인이 켠 AS 표시는 해제. 기기현황 이벤트는 재매칭 결과에 따라서만 발생.

export interface CorrectSerialResult { serialNo: string; previousSerialNo: string; state: MatchState; modelName: string | null; warnings: string[] }

export async function correctAsLineSerial(receiptId: number, actor: { userId: string; name: string | null }, input: { itemId: number; serial: string }): Promise<CorrectSerialResult> {
  const key = normalizeSerial(input.serial ?? '').serialNo
  if (!key) throw new AsServiceError(400, '보정할 시리얼을 입력하세요.')
  assertInputSerialOk(key, '보정') // 보정 결과는 반드시 정상 시리얼 (2026-09-30)
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.asReceipt.findUnique({
      where: { id: receiptId },
      select: { id: true, asCode: true, hospitalCode: true, receiptDate: true, note: true, status: { select: { ticketStatus: true } }, items: { select: { id: true, serialNo: true } } },
    })
    if (!receipt) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
    if (receipt.status?.ticketStatus === 'RESOLVED' || receipt.status?.ticketStatus === 'CLOSED') throw new AsServiceError(409, '완료·취소된 접수입니다.')
    const item = await tx.asReceiptItem.findFirst({ where: { id: input.itemId, receiptId }, include: { stockOutRequest: { select: { sorCode: true, status: { select: { ticketStatus: true } } } } } })
    if (!item) throw new AsServiceError(400, '이 접수의 라인이 아닙니다.')
    if (item.outcome) throw new AsServiceError(409, `이미 종결된 라인입니다: ${item.serialNo}`)
    if (isAsLineLockedByStockOut(item)) throw new AsServiceError(409, `${item.serialNo}: 출고요청 ${item.stockOutRequest?.sorCode ?? ''} 처리 대기 중인 라인입니다 — 먼저 출고요청을 취소하세요`) // 2026-11-10
    if (key === item.serialNo) throw new AsServiceError(400, '같은 시리얼입니다.')
    if (receipt.items.some((i) => i.id !== item.id && i.serialNo === key)) throw new AsServiceError(400, `같은 시리얼이 이 접수에 이미 있습니다: ${key}`)

    const warnings: string[] = []
    const today = todayKst()
    // 이전 시리얼 기기 — 실물 이동 근거 없음 → IN_USE·병원 복귀(이 접수가 켠 플래그면 AS_CLEAR, 아니면 CORRECT 폴백 — 게이트는 setUnitInUse)
    if (item.deviceId) {
      warnings.push(...(await setUnitInUse(tx, asCtx(receipt, actor, today), item.deviceId, { locationToHospital: true, memo: `시리얼 보정 ${receipt.asCode} (${item.serialNo} → ${key})` })))
    }
    const [m] = await matchSerials(tx, receipt.hospitalCode, [key])
    const w = matchWarning(m)
    if (w) warnings.push(w)
    await tx.asReceiptItem.update({
      where: { id: item.id },
      data: {
        serialNo: m.serialNo,
        receiptSerialNo: item.receiptSerialNo ?? item.serialNo, // 최초 접수 시리얼 보존
        deviceId: m.deviceId,
        deviceKind: m.deviceId ? null : item.deviceKind ?? asDeviceKindFromSerial(m.serialNo),
        wardName: item.wardName ?? m.wardName,
      },
    })
    if (m.state === 'ACTIVE_HERE' && !m.asOpen) {
      warnings.push(...(await openAsFlags(tx, receipt, [{ serialNo: m.serialNo, deviceId: m.deviceId! }], actor, ymd(receipt.receiptDate) ?? today)))
    }
    // 새 기기에 라인의 입고(received_at)·수리완료(repaired_at) 재적용 (§7.3)
    warnings.push(...(await reapplyLineState(tx, receipt, actor, { ...item, serialNo: m.serialNo, deviceId: m.deviceId })))
    await tx.asReceipt.update({ where: { id: receipt.id }, data: { note: appendNote(receipt.note, `[시리얼 보정 ${today} ${actor.name ?? ''}] ${item.serialNo} → ${m.serialNo}${m.modelName ? ` (${m.modelName})` : m.state === 'NONE' ? ' (미등록)' : ''}`) } })
    return { serialNo: m.serialNo, previousSerialNo: item.serialNo, state: m.state, modelName: m.modelName, warnings }
  }, { timeout: 60000, maxWait: 10000 })
}

// ── 회수기기 처리: 수리 · 문제없음 · 폐기 (2026-09-17 수리완료 체크 → 2026-11-02 3택, device_condition_location_design.md §7.1·§7.2) ─────────
// 라인 repair_result(REPAIRED/NO_FAULT/SCRAPPED) + repaired_at/by(처리일·처리자, DB CHECK로 짝 강제). 수리·문제없음은 기기 REPAIRED, 폐기는 SCRAPPED(scrapAsLineDevice).
// 수리완료는 outcome·헤더 전이·완료 판정에 개입하지 않는 제3축(라인 repaired_at + 기기 condition REPAIRED). 게이트는 라인 단위 — 접수 상태 무관(종결 접수 허용, A-2).
// 이 함수들은 outcome·draft_*·헤더 상태·advanceToShippedDone·completeAsReceipt·reopen을 절대 건드리지 않는다.

export interface RepairDoneResult {
  itemId: number
  serialNo: string
  /** 처리 결과(수리·문제없음) 여부 — 호환 필드(= repairResult != null) */
  repaired: boolean
  repairResult: AsSettableRepairResult | null
  repairedAt: string | null
  repairedBy: { id: string; name: string | null } | null
  /** 기기 상태(원장 연결 라인만) */
  condition: string | null
  warnings: string[]
}

/** 수리완료 게이트(§7.2) — 소속 400 · 미입고 400 · 분실·취소·미회수 400. 통과한 라인만 반환 */
async function requireRepairableLine(tx: Prisma.TransactionClient, receiptId: number, itemId: number, what: string) {
  const item = await tx.asReceiptItem.findFirst({ where: { id: itemId, receiptId } })
  if (!item) throw new AsServiceError(400, '이 접수의 라인이 아닙니다.')
  assertAsSerialOk(item.serialNo) // 시리얼 형식 게이트 (2026-09-30)
  if (item.intakeState !== 'RECEIVED') throw new AsServiceError(400, `입고된 라인만 ${what} 처리할 수 있습니다`)
  if (AS_REPAIR_EXCLUDED_OUTCOMES.includes(item.outcome ?? '')) throw new AsServiceError(400, `분실·취소·미회수 라인은 ${what} 대상이 아닙니다`)
  if (!canMarkAsLineRepaired(item)) throw new AsServiceError(400, `${what} 대상이 아닌 라인입니다`) // 판정 단일 소스(lib/asReceiptShared) 방어
  return item
}

/**
 * 회수기기 처리(수리·문제없음) 지정/변경/해제 (2026-11-02 — 수리완료 체크/해제 확장).
 * - `result` 지정: repair_result + repaired_at(오늘 KST, B-34)/by 기록(같은 값 재지정은 일자·사용자 유지 — 멱등, 수리↔문제없음 변경은 새 결정이라 오늘·현재 사용자) +
 *   `markDeviceRepaired`(AS_WAITING/NULL → REPAIRED, IN_USE는 경고 '이미 사용중'). 문제없음은 기기 이벤트 메모 '문제없음'으로 구분(기기 상태 신설 없음).
 * - `result=null` 해제: repair_result·repaired_at/by NULL + 기기 REPAIRED면 `undoDeviceRepaired`(CORRECT → AS_WAITING), 아니면 경고.
 * - 폐기된 라인(SCRAPPED)은 이 함수로 바꿀 수 없다(400) — 되돌리기는 기기현황 관리자 보정. 미등록 라인은 라인만 기록 + 경고(원장 확정 시 재적용).
 * 원장 RegistryError는 경고 흡수(유닛 쓰기 전 409만) — 단 **낙관 가드 409(동시 변경)는 전파**(tx 롤백 → 라우트 409 '다시 시도', §7.4).
 * 비고 이력은 라인 또는 기기가 실제로 바뀐 호출에만(재지정 멱등 — 줄 누적 방지).
 */
export async function setAsLineRepairResult(receiptId: number, actor: { userId: string; name: string | null }, input: { itemId: number; result: AsSettableRepairResult | null }): Promise<RepairDoneResult> {
  if (!Number.isInteger(input.itemId)) throw new AsServiceError(400, '라인이 올바르지 않습니다.')
  if (input.result !== null && input.result !== 'REPAIRED' && input.result !== 'NO_FAULT') throw new AsServiceError(400, '회수기기 처리 값이 올바르지 않습니다 (수리/문제없음 — 폐기는 [폐기] 경로)')
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.asReceipt.findUnique({ where: { id: receiptId }, select: { id: true, asCode: true, hospitalCode: true, note: true } })
    if (!receipt) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
    const item = await requireRepairableLine(tx, receiptId, input.itemId, '회수기기 처리')
    if (item.repairResult === 'SCRAPPED') {
      // 폐기 잠금 — 기기가 아직 폐기 상태면 변경 불가. 기기현황 관리자 보정으로 폐기를 해제한 뒤에는 라인도 다시 처리할 수 있다
      const unit = item.deviceId ? await tx.deviceUnit.findUnique({ where: { id: item.deviceId }, select: { condition: true } }) : null
      if (!unit || unit.condition === 'SCRAPPED') throw new AsServiceError(400, `${item.serialNo}: 폐기된 라인은 처리값을 바꿀 수 없습니다 — 기기현황에서 관리자 보정으로 폐기를 해제한 뒤 변경하세요`)
    }
    const warnings: string[] = []
    const today = todayKst()
    let condition: string | null = null
    const prev = (item.repairResult ?? null) as AsRepairResult | null
    const label = input.result ? AS_REPAIR_RESULT_DESC[input.result] : '회수처리 해제'
    let lineChanged = false // 라인 repair_result/repaired_at 변경 여부
    let deviceChanged = false // 기기 이벤트 기록 여부 — 둘 다 아니면 비고 무기록(재지정 멱등)
    /** 낙관 가드 409(동시 변경)는 경고로 삼키지 않고 전파 — tx 롤백 → 라우트 409 '동시에 변경되어 다시 시도하세요'(§7.4) */
    const rethrowIfConcurrent = (e: RegistryError) => { if (e.message.includes(DEVICE_CONCURRENT_CHANGE_MESSAGE)) throw e }

    if (input.result) {
      if (prev !== input.result) {
        await tx.asReceiptItem.update({ where: { id: item.id }, data: { repairResult: input.result, repairedAt: new Date(today), repairedById: actor.userId } })
        lineChanged = true
      }
      if (!item.deviceId) warnings.push(`${item.serialNo}: 미등록 라인 — 기기 상태는 기록되지 않았습니다(원장 확정 시 재적용)`)
      else {
        try {
          const r = await markDeviceRepaired(asCtx(receipt, actor, today, input.result === 'NO_FAULT' ? '문제없음 (회수기기 이상 없음)' : null), { deviceId: item.deviceId }, { client: tx })
          condition = r.unit.condition
          deviceChanged = r.changed
          warnings.push(...r.warnings)
        } catch (e) {
          if (!(e instanceof RegistryError)) throw e
          rethrowIfConcurrent(e)
          const cur = await tx.deviceUnit.findUnique({ where: { id: item.deviceId }, select: { condition: true } })
          condition = cur?.condition ?? null
          warnings.push(e.message.includes(DEVICE_REPAIR_IN_USE_MESSAGE) ? `${item.serialNo}: 기기는 이미 사용중(반환 확정) — 라인에만 ${AS_REPAIR_RESULT_LABELS[input.result]}을(를) 기록했습니다` : `${item.serialNo}: 기기 상태 기록 실패 — ${e.message}`)
        }
      }
    } else {
      if (item.repairedAt || prev) {
        await tx.asReceiptItem.update({ where: { id: item.id }, data: { repairResult: null, repairedAt: null, repairedById: null } })
        lineChanged = true
      }
      if (!item.deviceId) warnings.push(`${item.serialNo}: 미등록 라인 — 기기 상태는 바꾸지 않았습니다`)
      else {
        try {
          const r = await undoDeviceRepaired(asCtx(receipt, actor, today, '수리완료 해제'), { deviceId: item.deviceId }, { client: tx }) // 기기 이벤트 메모는 기기 관점 문구 유지(드로어 경로와 동일)
          condition = r.unit.condition
          deviceChanged = r.changed
          warnings.push(...r.warnings)
        } catch (e) {
          if (!(e instanceof RegistryError)) throw e
          rethrowIfConcurrent(e)
          const cur = await tx.deviceUnit.findUnique({ where: { id: item.deviceId }, select: { condition: true } })
          condition = cur?.condition ?? null
          warnings.push(`${item.serialNo}: 기기 상태가 수리완료가 아니라 되돌리지 않았습니다 (현재 ${deviceConditionLabel(condition)})`)
        }
      }
    }
    if (lineChanged || deviceChanged) {
      const change = lineChanged && prev && input.result && prev !== input.result ? ` (${AS_REPAIR_RESULT_LABELS[prev]} → ${AS_REPAIR_RESULT_LABELS[input.result]})` : ''
      await tx.asReceipt.update({ where: { id: receipt.id }, data: { note: appendNote(receipt.note, `[${label} ${today} ${actor.name ?? ''}] ${item.serialNo}${change}`) } })
    } else if (!warnings.length) warnings.push(`${item.serialNo}: 변경 사항 없음 — 이미 ${label} 상태입니다`)
    const after = await tx.asReceiptItem.findUnique({ where: { id: item.id }, select: { repairResult: true, repairedAt: true, repairedBy: { select: { id: true, name: true } } } })
    const res = (after?.repairResult ?? null) as AsSettableRepairResult | null
    return { itemId: item.id, serialNo: item.serialNo, repaired: !!res, repairResult: res, repairedAt: ymd(after?.repairedAt), repairedBy: after?.repairedBy ?? null, condition, warnings }
  }, { timeout: 60000, maxWait: 10000 })
}

/** 수리완료 체크/해제 (2026-09-17 원형 — 호환 래퍼): repaired=true → 수리(REPAIRED), false → 해제. 스모크·구 클라이언트용 */
export async function setAsLineRepaired(receiptId: number, actor: { userId: string; name: string | null }, input: { itemId: number; repaired: boolean }): Promise<RepairDoneResult> {
  return setAsLineRepairResult(receiptId, actor, { itemId: input.itemId, result: input.repaired ? 'REPAIRED' : null })
}

export interface ScrapLineResult {
  itemId: number
  serialNo: string
  repairResult: 'SCRAPPED'
  repairedAt: string | null
  condition: string | null
  warnings: string[]
}

/**
 * 라인 기기 폐기(SCRAP) — 소속·`canMarkAsLineRepaired`·deviceId 필수(미등록 400)·condition ∉ {LOST, SCRAPPED}(400)·**memo 필수(400, A-5 완화책)**
 * → `scrapDevice`(배치 ACTIVE는 409 '배치 중 기기는 먼저 회수하세요' — 전파; 배치 행 없는 유닛(REGISTER 취소 등)은 허용 — §7.1) → 라인 repair_result SCRAPPED + 처리일·처리자(2026-11-02, 이전엔 repaired_at NULL) → 비고 `[폐기 …] memo`.
 * 권한(!VIEWER)은 라우트. UI [폐기]는 `placement.status==='RECOVERED'`일 때만 노출(§6.1) — 배치 없음은 화면에서 도달하지 않는 서버 허용 집합.
 * 진행 중 라인(병원 배치 중) '폐기 판정'은 2026-11-02 검토 후 제외 — 폐기는 교체 최종확정으로 구기기가 회수된 뒤 이 경로로.
 */
export async function scrapAsLineDevice(receiptId: number, actor: { userId: string; name: string | null }, input: { itemId: number; memo: string }): Promise<ScrapLineResult> {
  if (!Number.isInteger(input.itemId)) throw new AsServiceError(400, '라인이 올바르지 않습니다.')
  const memo = input.memo?.trim()
  if (!memo) throw new AsServiceError(400, '폐기 사유(메모)를 입력하세요.')
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.asReceipt.findUnique({ where: { id: receiptId }, select: { id: true, asCode: true, hospitalCode: true, note: true } })
    if (!receipt) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
    const item = await requireRepairableLine(tx, receiptId, input.itemId, '폐기')
    if (!item.deviceId) throw new AsServiceError(400, `${item.serialNo}: 미등록 라인은 폐기할 수 없습니다 — 원장 확정 후 처리하세요`)
    const unit = await tx.deviceUnit.findUnique({ where: { id: item.deviceId }, select: { condition: true } })
    if (unit?.condition === 'LOST' || unit?.condition === 'SCRAPPED') throw new AsServiceError(400, `${item.serialNo}: 기기 상태 ${deviceConditionLabel(unit.condition)} — 폐기 대상이 아닙니다`)
    const today = todayKst()
    const r = await scrapDevice(asCtx(receipt, actor, today, memo), { deviceId: item.deviceId, memo }, { client: tx }) // RegistryError(ACTIVE 409 등)는 전파
    const prev = (item.repairResult ?? null) as AsRepairResult | null
    await tx.asReceiptItem.update({ where: { id: item.id }, data: { repairResult: 'SCRAPPED', repairedAt: new Date(today), repairedById: actor.userId } })
    await tx.asReceipt.update({ where: { id: receipt.id }, data: { note: appendNote(receipt.note, `[폐기 ${today} ${actor.name ?? ''}] ${item.serialNo}${prev ? ` (${AS_REPAIR_RESULT_LABELS[prev]} → 폐기)` : ''} — ${memo}`) } })
    return { itemId: item.id, serialNo: item.serialNo, repairResult: 'SCRAPPED', repairedAt: today, condition: r.unit.condition, warnings: r.warnings }
  }, { timeout: 60000, maxWait: 10000 })
}

// ── 분실 AS ↔ 출고업무 연동 (2026-11-10 — projects/as_lost_stock_out_link_design.md §4·§6) ─────────
// 분실 접수의 미종결 라인을 골라 출고업무 티켓(판매용·분실기기 제공·납품처=접수 병원)을 만들고 라인을 묶는다(활성 요청 동안 잠금).
// 기기 제공은 출고 실행(lib/stockOutFulfill)이 `resolveAsLinesIn(viaStockOutRequestId)`로 교체 확정. 요청 취소·삭제 시 `unlinkAsLinesFromStockOut`로 잠금 해제.

/** 활성(미종결) 출고요청 where — 상태 없음·매핑 없음은 활성으로 본다 */
export const ACTIVE_STOCK_OUT_WHERE: Prisma.StockOutRequestWhereInput = {
  OR: [{ statusId: null }, { status: { ticketStatus: null } }, { status: { ticketStatus: { notIn: ['RESOLVED', 'CLOSED'] } } }],
}

export interface AsStockOutRequestInput { itemIds: number[]; requestDate: string; shipAddress?: string | null; recipient?: string | null; note?: string | null }
export interface AsStockOutRequestResult { requestId: number; sorCode: string; ticketId: number; itemCount: number; groups: { group: string; count: number; itemName: string }[]; serials: string[] }

export async function createStockOutForAsLines(receiptId: number, actor: { userId: string; name: string | null }, input: AsStockOutRequestInput): Promise<AsStockOutRequestResult> {
  const ids = Array.from(new Set((input.itemIds ?? []).filter((v) => Number.isInteger(v))))
  if (!ids.length) throw new AsServiceError(400, '출고요청할 기기 라인을 선택하세요.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test((input.requestDate ?? '').trim())) throw new AsServiceError(400, '희망 출고일을 입력하세요 (YYYY-MM-DD).')
  const today = todayKst()
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const receipt = await tx.asReceipt.findUnique({
          where: { id: receiptId },
          select: {
            id: true, asCode: true, hospitalCode: true, category: true, note: true, destInfo: true, reporterName: true,
            status: { select: { ticketStatus: true } }, hospital: { select: { hospitalName: true } },
            items: { select: { id: true, serialNo: true, outcome: true, deviceId: true, deviceKind: true, intakeState: true, device: { select: { deviceInfoId: true, deviceInfo: { select: { deviceName: true } } } }, stockOutRequest: { select: { sorCode: true, status: { select: { ticketStatus: true } } } } } },
          },
        })
        if (!receipt) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
        if (receipt.category !== 'LOST') throw new AsServiceError(400, '출고요청은 분실 접수에서만 만들 수 있습니다. 고장 접수는 AS 처리방법(교체)으로 처리하세요.')
        if (receipt.status?.ticketStatus === 'RESOLVED' || receipt.status?.ticketStatus === 'CLOSED') throw new AsServiceError(409, '완료·취소된 접수입니다.')
        const byId = new Map(receipt.items.map((i) => [i.id, i]))
        const picked = ids.map((id) => {
          const it = byId.get(id)
          if (!it) throw new AsServiceError(400, `이 접수의 라인이 아닙니다: #${id}`)
          if (it.outcome) throw new AsServiceError(409, `이미 종결된 라인입니다: ${it.serialNo}`)
          if (isAsLineLockedByStockOut(it)) throw new AsServiceError(409, `${it.serialNo}: 이미 출고요청 ${it.stockOutRequest?.sorCode ?? ''}에 묶여 있습니다`)
          assertAsSerialOk(it.serialNo)
          if (it.intakeState === 'MISMATCH' || it.intakeState === 'EXTRA') throw new AsServiceError(409, `${it.serialNo}: 입고 대조 확인이 필요한 라인입니다`)
          return it
        })
        // 기기군별 자리표시 품목 — 판매용 노출·시리얼 관리·시리얼 추적 device_info 품목 중 분실 기기 모델 일치 우선, 없으면 그 기기군 첫 품목 (D2: 실제 출고 시리얼 기준으로 출고 실행 시 보정)
        const candidates = await tx.inventoryItem.findMany({
          where: { isActive: true, isSerialManaged: true, stockOutPurposes: { some: { purpose: 'SALES' } }, deviceInfo: { serialTracked: true, isActive: true }, inventory: { isActive: true } },
          select: { id: true, name: true, deviceInfoId: true, deviceInfo: { select: { deviceName: true } } },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        })
        const groupOfItem = (c: typeof candidates[number]) => asDeviceGroupOf(c.deviceInfo?.deviceName ?? null, null)
        const groups = new Map<string, typeof picked>()
        for (const it of picked) {
          const g = asDeviceGroupOf(it.device?.deviceInfo?.deviceName ?? null, it.deviceKind, it.serialNo)
          if (g === '기타') throw new AsServiceError(400, `${it.serialNo}: 기기군(심전계/산소포화도)을 판정할 수 없어 출고요청에 넣을 수 없습니다`)
          groups.set(g, [...(groups.get(g) ?? []), it])
        }
        const items: { inventoryItemId: number; quantity: number }[] = []
        const groupInfo: AsStockOutRequestResult['groups'] = []
        for (const [g, lines] of Array.from(groups.entries())) {
          const inGroup = candidates.filter((c) => groupOfItem(c) === g)
          if (!inGroup.length) throw new AsServiceError(409, `판매용 재고에 ${g} 본체 품목이 노출되어 있지 않습니다 — 설정 > 출고 품목 관리 > 판매용에서 노출하세요`)
          const modelIds = new Set(lines.map((l) => l.device?.deviceInfoId).filter((v): v is number => !!v))
          const pick = inGroup.find((c) => c.deviceInfoId != null && modelIds.has(c.deviceInfoId)) ?? inGroup[0]
          items.push({ inventoryItemId: pick.id, quantity: lines.length })
          groupInfo.push({ group: g, count: lines.length, itemName: pick.name })
        }
        const serials = picked.map((i) => i.serialNo)
        let prepared
        try {
          prepared = await prepareStockOutCreate({
            purpose: 'SALES', subPurpose: 'LOST_REPLACE', destType: 'HOSPITAL', destHospitalCode: receipt.hospitalCode,
            shipAddress: (input.shipAddress ?? '').trim() || receipt.destInfo || receipt.hospital?.hospitalName || '',
            recipient: (input.recipient ?? '').trim() || receipt.reporterName || '',
            requestDate: input.requestDate.trim(), items,
            note: (input.note ?? '').trim() || `AS ${receipt.asCode} 분실기기 제공 ${picked.length}대 (${serials.join(', ')})`,
            asReceiptId: receipt.id,
          }, tx)
        } catch (e) {
          if (e instanceof StockOutCreateError) throw new AsServiceError(400, e.message)
          throw e
        }
        const created = await createStockOutRequestIn(tx, prepared, actor)
        await tx.asReceiptItem.updateMany({ where: { id: { in: picked.map((i) => i.id) } }, data: { stockOutRequestId: created.id } })
        await tx.asReceipt.update({ where: { id: receipt.id }, data: { note: appendNote(receipt.note, `[출고요청 ${today} ${actor.name ?? ''}] ${created.sorCode} 분실기기 제공 ${picked.length}대 (${serials.join(', ')}) · ${groupInfo.map((g) => `${g.group} ${g.count}`).join(' · ')}`) } })
        return { requestId: created.id, sorCode: created.sorCode, ticketId: created.ticketId, itemCount: picked.length, groups: groupInfo, serials }
      }, { timeout: 60000, maxWait: 10000 })
    } catch (err) {
      if (attempt === 0 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue
      throw err
    }
  }
}

/** 출고요청 취소·삭제 시 — 묶인 미종결 라인 잠금 해제 + 접수 비고. 반환: 해제 라인 수 */
export async function unlinkAsLinesFromStockOut(tx: Prisma.TransactionClient, requestId: number, actor: { userId: string; name: string | null }, reason: '취소' | '삭제'): Promise<number> {
  const rows = await tx.asReceiptItem.findMany({ where: { stockOutRequestId: requestId, outcome: null }, select: { id: true, serialNo: true, receiptId: true, stockOutRequest: { select: { sorCode: true } } } })
  if (!rows.length) return 0
  await tx.asReceiptItem.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { stockOutRequestId: null } })
  const byReceipt = new Map<number, typeof rows>()
  for (const r of rows) byReceipt.set(r.receiptId, [...(byReceipt.get(r.receiptId) ?? []), r])
  const today = todayKst()
  for (const [receiptId, list] of Array.from(byReceipt.entries())) {
    const rc = await tx.asReceipt.findUnique({ where: { id: receiptId }, select: { note: true } })
    await tx.asReceipt.update({ where: { id: receiptId }, data: { note: appendNote(rc?.note ?? null, `[출고요청 ${reason} ${today} ${actor.name ?? ''}] ${list[0].stockOutRequest?.sorCode ?? ''} — ${list.map((r) => r.serialNo).join(', ')} 잠금 해제(재요청·분실종결 가능)`) } })
  }
  return rows.length
}

// ── 분실기기 되찾음 (2026-11-10 — projects/as_lost_found_design.md §3) ─────────
// 정책: 교체기기 발송 후 되찾으면 **되찾은 기기를 병원이 계속 쓰고 교체기기는 회수**(2대 사용 없음). 발송 전 되찾음은 기존 라인 취소.
// 라인 outcome REPLACE → FOUND(교체 이력 보존) + 원장 2대: 교체기기 RECOVER(RETURN, related=되찾은 기기) · 되찾은 기기 REGISTER 재배치(LOST → IN_USE, 교체기기 배치의 계약건·상품유형 승계).
// 분실 한도 분자는 REPLACE·REPAIR_RETURN만 세므로 FOUND는 자동 제외(병원 블록·접수 상세 동시 반영). 헤더 상태 불변.

export interface FoundLineInput {
  itemId: number
  /** 되찾은 날 YYYY-MM-DD (기본 오늘 KST) — 원장 이벤트 업무일자 */
  foundAt?: string | null
  /** 되찾은 기기를 되돌릴 병동(기본: 라인 병동·교체기기 배치 병동) */
  wardName?: string | null
  /** 교체기기 회수 송장(선택) */
  recallTrackingNo?: string | null
  memo?: string | null
}
export interface FoundLineResult { itemId: number; serialNo: string; newSerialNo: string | null; foundAt: string; wardName: string | null; warnings: string[] }

export async function markAsLineFound(receiptId: number, actor: { userId: string; name: string | null }, input: FoundLineInput): Promise<FoundLineResult> {
  if (!Number.isInteger(input.itemId)) throw new AsServiceError(400, '라인이 올바르지 않습니다.')
  const today = todayKst()
  const foundAt = (input.foundAt ?? '').trim() || today
  if (!/^\d{4}-\d{2}-\d{2}$/.test(foundAt)) throw new AsServiceError(400, '되찾은 날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).')
  if (foundAt > today) throw new AsServiceError(400, '되찾은 날짜는 미래일 수 없습니다.')
  const recallTrackingNo = (input.recallTrackingNo ?? '').trim().slice(0, 50) || null
  const memo = (input.memo ?? '').trim() || null
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.asReceipt.findUnique({ where: { id: receiptId }, select: { id: true, asCode: true, hospitalCode: true, category: true, note: true } })
    if (!receipt) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
    if (receipt.category !== 'LOST') throw new AsServiceError(400, '되찾음 처리는 분실 접수에서만 할 수 있습니다.')
    const item = await tx.asReceiptItem.findFirst({ where: { id: input.itemId, receiptId }, select: { id: true, serialNo: true, outcome: true, deviceId: true, newDeviceId: true, newSerialNo: true, wardName: true } })
    if (!item) throw new AsServiceError(404, '라인을 찾을 수 없습니다.')
    if (item.outcome === 'FOUND') throw new AsServiceError(409, `${item.serialNo}: 이미 되찾음 처리된 라인입니다.`)
    if (item.outcome !== 'REPLACE') throw new AsServiceError(400, `${item.serialNo}: 교체 확정 라인만 되찾음 처리할 수 있습니다 (발송 전이면 라인 취소로 처리).`)
    if (!canMarkAsLineFound(receipt.category, item)) {
      throw new AsServiceError(400, `${item.serialNo}: 교체기기가 원장에 별도 기기로 연결되지 않아(이력 이관 라인) 되찾음 처리를 할 수 없습니다 — 접수 취소로 처리하세요.`)
    }
    assertAsSerialOk(item.serialNo)

    // 되찾은 기기 — 분실 상태·미배치여야 한다
    const foundDev = await getUnitOr404(tx, item.deviceId!)
    if (foundDev.placement?.status === 'ACTIVE') throw new AsServiceError(409, `${item.serialNo}: 이미 배치 중인 기기입니다 (${foundDev.placement.hospitalCode === receipt.hospitalCode ? '이 병원' : '타 병원'}) — 기기현황을 확인하세요.`)
    const foundState = await unitStateOf(tx, foundDev.unit)
    if (foundState.condition !== 'LOST') throw new AsServiceError(409, `${item.serialNo}: 기기 상태가 분실이 아닙니다 (현재 ${deviceConditionLabel(foundState.condition)}) — 기기현황에서 상태를 확인하세요.`)

    // 교체기기 — 이 병원에 배치 중이고, 이 접수가 최근 상태를 기록한 기기여야 회수할 수 있다
    const newDev = await getUnitOr404(tx, item.newDeviceId!)
    const newLabel = newDev.unit.serialNo
    if (newDev.placement?.status !== 'ACTIVE' || newDev.placement.hospitalCode !== receipt.hospitalCode) {
      throw new AsServiceError(409, `교체기기 ${newLabel}가 이 병원에 배치 중이 아닙니다 (${newDev.placement?.status === 'ACTIVE' ? '타 병원 배치' : '회수 상태'}) — 기기현황을 확인하세요.`)
    }
    const gate = await ownsDeviceState(tx, receipt.asCode, item.newDeviceId!)
    if (!gate.owns) throw new AsServiceError(409, `교체기기 ${newLabel}: 다른 접수(${gate.by})가 최근 상태를 기록해 회수할 수 없습니다.`)

    const wardName = (input.wardName ?? '').trim() || null
    const targetWard = wardName ?? (newDev.placement.wardId ? (await tx.hospitalWard.findUnique({ where: { id: newDev.placement.wardId }, select: { name: true } }))?.name ?? null : null) ?? item.wardName ?? null
    const ctx = asCtx(receipt, actor, foundAt, memo ?? `되찾음 ${receipt.asCode}`)
    const warnings: string[] = []

    // ① 교체기기 회수 — 사유 RETURN(반납), 관련 기기 = 되찾은 기기. RegistryError(전이 불가 등)는 전파 → 전체 롤백
    const returnReason = await reasonByValue(tx, 'RETURN')
    const rec = await recoverDevice({ ...ctx, memo: `되찾음 ${receipt.asCode} — 교체기기 회수` }, { deviceId: item.newDeviceId!, reasonCodeId: returnReason.id, relatedDeviceId: item.deviceId! }, { client: tx })
    warnings.push(...rec.warnings.map((w) => `${newLabel}: ${w}`))

    // ② 되찾은 기기 재배치 — LOST → IN_USE(전이표 REGISTER), 교체기기 배치의 계약건·상품유형 승계
    const reg = await registerDevicesIn(tx, { ...ctx, memo: `되찾음 ${receipt.asCode} — 분실기기 사용중 복귀` }, [{
      serialInput: item.serialNo, wardName: targetWard, productType: newDev.placement.productType ?? undefined, dealCode: newDev.placement.dealCode ?? undefined, memo: `되찾음 ${receipt.asCode}`,
    }], { autoCreateWard: true })
    if (reg.skipped.length) throw new AsServiceError(409, `${item.serialNo}: 재배치 실패 — ${reg.skipped.map((s) => s.reason).join(', ')}`)
    if (reg.created.length + reg.reregistered.length !== 1) throw new AsServiceError(409, `${item.serialNo}: 재배치 결과가 올바르지 않습니다.`)
    warnings.push(...reg.warnings)

    // ③ 라인·비고
    await tx.asReceiptItem.update({ where: { id: item.id }, data: { outcome: 'FOUND', foundAt: new Date(foundAt), foundById: actor.userId, recallTrackingNo } })
    const line = `[되찾음 ${today} ${actor.name ?? ''}] ${item.serialNo} 사용중 복귀(${targetWard ?? '병동 미지정'}) · 교체기기 ${newLabel} 회수(반납)${recallTrackingNo ? ` · 회수 송장 ${recallTrackingNo}` : ''}${foundAt !== today ? ` · 되찾은 날 ${foundAt}` : ''}${memo ? ` — ${memo}` : ''}`
    await tx.asReceipt.update({ where: { id: receipt.id }, data: { note: appendNote(receipt.note, line) } })
    return { itemId: item.id, serialNo: item.serialNo, newSerialNo: item.newSerialNo ?? newLabel, foundAt, wardName: targetWard, warnings }
  }, { timeout: 60000, maxWait: 10000 })
}

// ── 발송완료 자동 전이 / 최종 완료 (2026-09-11 — 기기등록 후속업무 반영) ─────────
// 전 라인 종결 → '발송완료'(비종결, IN_PROGRESS). 최종 '완료'(CLOSED)는 4. 기기등록 카드의 [완료]로만(completeAsReceipt).

/** 미종결 라인이 0이고 현재 상태가 '발송완료' 이전이면 '발송완료'로. 반환: 전이 여부 */
async function advanceToShippedDone(tx: Prisma.TransactionClient, receiptId: number, actor: { userId: string | null; name: string | null }, warnings: string[]): Promise<boolean> {
  const remaining = await tx.asReceiptItem.count({ where: { receiptId, outcome: null } })
  if (remaining !== 0) return false
  const cur = await tx.asReceipt.findUnique({ where: { id: receiptId }, select: { statusId: true, status: { select: { order: true, ticketStatus: true } } } })
  const shipped = await tx.statusCode.findFirst({ where: { category: 'AS_STATUS', name: '발송완료' }, select: { id: true, order: true } })
  if (!shipped) { warnings.push("AS_STATUS '발송완료' 상태가 없어 자동 전이를 건너뛰었습니다 — seed-as-masters.sql 확인"); return false }
  if (!cur || cur.statusId === shipped.id) return false
  const terminal = cur.status?.ticketStatus === 'RESOLVED' || cur.status?.ticketStatus === 'CLOSED'
  if (terminal || (cur.status?.order ?? 0) > shipped.order) return false // 이미 완료·취소·보류 등 뒤 단계면 유지
  await tx.asReceipt.update({ where: { id: receiptId }, data: { statusId: shipped.id, statusChangedAt: new Date() } })
  await syncAsReceiptToTicket(tx, receiptId, actor.userId)
  return true
}

/** 4. 기기등록 [완료] — 전 라인 종결 상태에서만 최종 '완료'(CLOSED)·완료일 기록·티켓 CLOSED */
export async function completeAsReceipt(receiptId: number, actor: { userId: string; name: string | null }): Promise<{ statusName: string }> {
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.asReceipt.findUnique({
      where: { id: receiptId },
      select: { id: true, asCode: true, note: true, status: { select: { name: true, ticketStatus: true } } },
    })
    if (!receipt) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
    if (receipt.status?.ticketStatus === 'RESOLVED' || receipt.status?.ticketStatus === 'CLOSED') throw new AsServiceError(409, '이미 완료·취소된 접수입니다.')
    const remaining = await tx.asReceiptItem.count({ where: { receiptId, outcome: null } })
    if (remaining > 0) throw new AsServiceError(409, `미종결 라인이 ${remaining}개 있습니다 — 전 라인 처리 후 완료할 수 있습니다.`)
    const done = await tx.statusCode.findFirst({ where: { category: 'AS_STATUS', name: '완료' }, select: { id: true, name: true } })
    if (!done) throw new AsServiceError(400, "AS_STATUS '완료' 상태가 없습니다 — seed-as-masters.sql 확인")
    const today = todayKst()
    await tx.asReceipt.update({
      where: { id: receiptId },
      data: { statusId: done.id, statusChangedAt: new Date(), resolvedAt: new Date(today), note: appendNote(receipt.note, `[기기등록 완료 ${today} ${actor.name ?? ''}] ${receipt.status?.name ?? '-'} → 완료`) },
    })
    await syncAsReceiptToTicket(tx, receiptId, actor.userId)
    return { statusName: done.name }
  }, { timeout: 30000, maxWait: 10000 })
}

// ── 리오픈 (2026-09-11 — 완료·취소된 접수를 다시 진행 상태로) ─────────
// 헤더만 되돌린다(라인 결과·기기현황 이벤트는 그대로 — 라인 되돌리기는 별도 결정). 사유는 비고 이력 + 티켓은 어댑터 동기화로 재오픈.

export async function reopenAsReceipt(receiptId: number, actor: { userId: string; name: string | null }, input: { reason: string; statusId?: number | null }): Promise<{ statusName: string }> {
  const reason = input.reason?.trim()
  if (!reason) throw new AsServiceError(400, '리오픈 사유를 입력하세요.')
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.asReceipt.findUnique({
      where: { id: receiptId },
      select: { id: true, asCode: true, note: true, status: { select: { ticketStatus: true, name: true } }, items: { select: { intakeState: true, outcome: true } } },
    })
    if (!receipt) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
    const terminal = receipt.status?.ticketStatus === 'RESOLVED' || receipt.status?.ticketStatus === 'CLOSED'
    if (!terminal) throw new AsServiceError(409, '완료·취소된 접수만 리오픈할 수 있습니다.')
    // 대상 상태: 지정 시 비종결 AS_STATUS만 / 미지정 시 입고된 라인이 있으면 '입고', 없으면 '접수'
    let target: { id: number; name: string } | null = null
    if (input.statusId != null) {
      const row = await tx.statusCode.findFirst({ where: { id: input.statusId, category: 'AS_STATUS' }, select: { id: true, name: true, ticketStatus: true } })
      if (!row || row.ticketStatus === 'RESOLVED' || row.ticketStatus === 'CLOSED') throw new AsServiceError(400, '리오픈 대상 상태가 올바르지 않습니다 (종결 상태 불가).')
      target = { id: row.id, name: row.name }
    } else {
      const allClosed = receipt.items.length > 0 && receipt.items.every((i) => i.outcome)
      const name = allClosed ? '발송완료' : receipt.items.some((i) => i.intakeState === 'RECEIVED') ? '입고' : '접수'
      target = await tx.statusCode.findFirst({ where: { category: 'AS_STATUS', name }, select: { id: true, name: true } })
        ?? await tx.statusCode.findFirst({ where: { category: 'AS_STATUS', name: '접수' }, select: { id: true, name: true } })
      if (!target) throw new AsServiceError(400, "AS_STATUS '접수' 상태가 없습니다 — seed-as-masters.sql 확인")
    }
    const today = todayKst()
    await tx.asReceipt.update({
      where: { id: receipt.id },
      data: {
        statusId: target.id, statusChangedAt: new Date(), resolvedAt: null,
        note: appendNote(receipt.note, `[리오픈 ${today} ${actor.name ?? ''}] ${receipt.status?.name ?? '종결'} → ${target.name} — ${reason}`),
      },
    })
    await syncAsReceiptToTicket(tx, receipt.id, actor.userId)
    return { statusName: target.name }
  }, { timeout: 30000, maxWait: 10000 })
}

// ── 발송정보 갱신 (2026-09-11 — 기기군 단위 발송방법·송장·발송일 일괄 기입/정정) ─────────
// 발송된 라인(수리반환·교체)만 대상. 기기현황 이벤트는 건드리지 않음(발송 메타만). 시트 R·V·W 역기입은 다음 틱에 반영.

export interface ShipInfoInput {
  itemIds: number[]
  shipMethod?: 'PARCEL' | 'VISIT' | null
  shipTrackingNo?: string | null
  shippedAt?: string | null // YYYY-MM-DD
}

export async function updateAsShipInfo(receiptId: number, input: ShipInfoInput): Promise<{ updated: number }> {
  const ids = Array.from(new Set((input.itemIds ?? []).filter((n) => Number.isInteger(n))))
  if (!ids.length) throw new AsServiceError(400, '발송정보를 적용할 라인을 선택하세요.')
  const shipMethod = input.shipMethod ?? null
  if (shipMethod && shipMethod !== 'PARCEL' && shipMethod !== 'VISIT') throw new AsServiceError(400, '발송방법이 올바르지 않습니다.')
  const shippedAt = input.shippedAt?.trim() || null
  if (shippedAt && !/^\d{4}-\d{2}-\d{2}$/.test(shippedAt)) throw new AsServiceError(400, '발송일이 올바르지 않습니다 (YYYY-MM-DD).')
  const items = await prisma.asReceiptItem.findMany({ where: { id: { in: ids }, receiptId }, select: { id: true, serialNo: true, outcome: true, draftOutcome: true } })
  if (items.length !== ids.length) throw new AsServiceError(400, '이 접수의 라인이 아닙니다.')
  for (const i of items) assertAsSerialOk(i.serialNo) // 시리얼 형식 게이트 (2026-09-30)
  // 확정된 발송 라인 + 초안이 발송(수리반환·교체)인 라인 (2026-09-14 — 최종확정 전에 발송정보를 먼저 기입)
  const isShip = (o: string | null) => o === 'REPAIR_RETURN' || o === 'REPLACE'
  const notShipped = items.filter((i) => !(i.outcome ? isShip(i.outcome) : isShip(i.draftOutcome)))
  if (notShipped.length) throw new AsServiceError(400, `발송 라인(수리반환·교체 확정 또는 초안)만 발송정보를 수정할 수 있습니다: ${notShipped.map((i) => i.serialNo).join(', ')}`)
  const r = await prisma.asReceiptItem.updateMany({
    where: { id: { in: ids } },
    data: {
      shipMethod: input.shipMethod === undefined ? undefined : shipMethod,
      shipTrackingNo: input.shipTrackingNo === undefined ? undefined : input.shipTrackingNo?.trim() || null,
      shippedAt: shippedAt ? new Date(shippedAt) : undefined,
    },
  })
  return { updated: r.count }
}

// ── 접수 등록 코어 (2026-09-07 — 채널톡 자동 등록 편입으로 라우트에서 추출) ─────────
// 화면 등록(POST /api/as-receipts)과 채널톡 시트 폴링(lib/channeltalkAsSync)이 공유하는 단일 경로.
// 검증 실패는 AsServiceError(400). 발번 충돌(P2002)은 1회 재시도.

export interface CreateAsReceiptInput {
  /** 시트 자동 인입 전용 — 비정상 시리얼도 등록 허용(경고·'시리얼 오류' 태그로 이후 처리 차단). 화면 등록은 false(400) (2026-09-30) */
  allowInvalidSerial?: boolean
  hospitalCode: string
  category?: string
  receiptDate: Date
  reporterName?: string | null
  pickupMethod?: string | null
  pickupTrackingNo?: string | null
  pickedUpAt?: Date | null // 수거일 (2026-09-15 — 채널톡 자동 인입 기본 익일)
  priorityRepair?: boolean // 태그 (2026-09-15)
  firmwareUpdate?: boolean
  accessoryIncluded?: boolean
  combinedPack?: boolean // 합포장 태그 (2026-09-19)
  preReplace?: boolean
  destType?: string | null // HOSPITAL / OTHER
  destInfo?: string | null
  pickupDestInfo?: string | null // 회수지 정보 (CX #13 — 채널톡 인입 시 발송지와 동일 자동 기재)
  pickupDestDiffers?: boolean // 회수지 상이 체크 (2026-09-19 — 채널톡 T열 '회수지:'/'발송지:' 분해 시 자동)
  statusId?: number | null // 미지정 시 '접수'
  note?: string | null
  lines: LineInput[]
  /** 출처 (2026-10-27 as_channeltalk_intake_design §3.1) — 미지정 MANUAL. 시트 폴링 SHEET / 상담 자동 CHANNELTALK / 등록대기 확정 INTAKE_QUEUE */
  source?: 'MANUAL' | 'SHEET' | 'CHANNELTALK' | 'INTAKE_QUEUE' | 'IMPORT'
  /** 마스터 VOC — 지정 시 AS 티켓을 VOC 티켓의 하위(parentId)로 연결 */
  vocId?: number | null
}

export interface CreateAsReceiptResult {
  id: number
  asCode: string
  ticketId: number
  warnings: string[]
  hospitalName: string
}

export async function createAsReceipt(
  input: CreateAsReceiptInput,
  actor: { userId: string; name: string }
): Promise<CreateAsReceiptResult> {
  const hospitalCode = input.hospitalCode?.trim()
  if (!hospitalCode) throw new AsServiceError(400, '병원을 선택하세요.')
  const hospital = await prisma.hospital.findUnique({
    where: { hospitalCode },
    select: { hospitalCode: true, hospitalName: true },
  })
  if (!hospital) throw new AsServiceError(400, '병원을 찾을 수 없습니다.')

  const category = input.category ?? 'FAULT'
  if (!(AS_CATEGORIES as readonly string[]).includes(category)) throw new AsServiceError(400, '구분이 올바르지 않습니다.')

  const receiptDate = input.receiptDate
  if (!(receiptDate instanceof Date) || isNaN(receiptDate.getTime())) throw new AsServiceError(400, '접수일을 입력하세요.')

  const pickupMethod = input.pickupMethod ?? defaultAsPickupMethod(category) // 분실은 기본 '수거없음' (2026-09-18)
  if (pickupMethod && !(AS_PICKUP_METHODS as readonly string[]).includes(pickupMethod)) {
    throw new AsServiceError(400, '수거방법이 올바르지 않습니다.')
  }

  const lines = input.lines
  if (!lines.length) throw new AsServiceError(400, '기기 시리얼을 1개 이상 입력하세요.')
  const seen = new Set<string>()
  for (const l of lines) {
    const key = l.serial.replace(/\s+/g, '').toUpperCase()
    if (!key) throw new AsServiceError(400, '시리얼이 비어 있습니다.')
    if (seen.has(key)) throw new AsServiceError(400, `같은 시리얼이 중복 입력되었습니다: ${key}`)
    seen.add(key)
    // 시리얼 형식(2026-09-30): 화면 등록은 400으로 즉시 차단. 시트 자동 인입(allowInvalidSerial)은 등록은 허용하되 '시리얼 오류' 태그로 보정 전 이후 처리 차단
    if (!input.allowInvalidSerial) assertInputSerialOk(normalizeSerial(key).serialNo, '기기')
  }

  // 상태 — 지정 시 카테고리 검증, 미지정이면 '접수'
  let statusId: number | null = null
  if (input.statusId !== undefined && input.statusId !== null) {
    const row = Number.isInteger(input.statusId)
      ? await prisma.statusCode.findFirst({ where: { id: input.statusId, category: 'AS_STATUS' }, select: { id: true } })
      : null
    if (!row) throw new AsServiceError(400, '상태가 올바르지 않습니다.')
    statusId = row.id
  } else {
    const open = await prisma.statusCode.findFirst({ where: { category: 'AS_STATUS', name: '접수' }, select: { id: true } })
    statusId = open?.id ?? null
  }
  const statusRow = statusId ? await prisma.statusCode.findUnique({ where: { id: statusId }, select: { name: true } }) : null

  const note = input.note?.trim() || null
  const reporterName = input.reporterName?.trim() || null
  const pickupTrackingNo = input.pickupTrackingNo?.trim() || null
  const preReplace = input.preReplace === true
  const tagFlags = { priorityRepair: input.priorityRepair === true, firmwareUpdate: input.firmwareUpdate === true, accessoryIncluded: input.accessoryIncluded === true, combinedPack: input.combinedPack === true }
  const destType = input.destType ?? null
  if (destType && !(AS_DEST_TYPES as readonly string[]).includes(destType)) throw new AsServiceError(400, '발송지 구분이 올바르지 않습니다.')
  const destInfo = input.destInfo?.trim() || null

  // 티켓 설명 소스 — 비고 또는 라인 접수사유 상위 3건
  const symptoms = lines.map((l) => l.symptom?.trim()).filter((s): s is string => !!s)
  const description = note ?? (symptoms.length ? symptoms.slice(0, 3).join(' / ') : null)

  // 레코드+라인+연결 티켓+AS 표시 단일 트랜잭션 — 발번 P2002 1회 재시도
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
              pickedUpAt: input.pickedUpAt instanceof Date && !isNaN(input.pickedUpAt.getTime()) ? input.pickedUpAt : null,
              preReplace,
              ...tagFlags,
              destType,
              destInfo,
              pickupDestInfo: input.pickupDestInfo?.trim() || null,
              pickupDestDiffers: !!input.pickupDestDiffers,
              statusId,
              note,
              createdById: actor.userId,
              source: input.source ?? 'MANUAL',
              vocId: input.vocId ?? null,
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
            if (!isValidAsSerial(m.serialNo)) txWarnings.push(`${m.serialNo}: 시리얼 형식 오류 (${AS_SERIAL_RULE_TEXT}) — [시리얼 보정] 전에는 이후 처리 불가`) // 시트 자동 인입만 도달 (2026-09-30)
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
          }, actor.userId, 'domain')
          // 마스터 VOC가 있으면 AS 티켓을 VOC 티켓 하위로 (2026-10-27 — 채널톡 인입 경로, 2레벨 고정: VOC 티켓이 이미 하위면 연결 생략)
          if (input.vocId) {
            const vocTicket = await tx.vocReceipt.findUnique({ where: { id: input.vocId }, select: { ticketId: true, ticket: { select: { id: true, ticketCode: true, parentId: true } } } })
            if (vocTicket?.ticket && !vocTicket.ticket.parentId) {
              await tx.ticket.update({ where: { id: tid }, data: { parentId: vocTicket.ticket.id } })
              await addTicketEvent(tx, tid, 'link', actor.userId, { event: 'parent_set', parentId: vocTicket.ticket.id, parentCode: vocTicket.ticket.ticketCode, via: 'as_intake' })
            }
          }
          // AS 표시 — 접수일 기준, 실패는 경고 (ref 검증이 접수 레코드를 참조하므로 티켓 생성 후 호출 무관)
          txWarnings.push(
            ...(await openAsFlags(
              tx,
              { asCode: receipt.asCode, hospitalCode: hospital.hospitalCode },
              flagTargets,
              { userId: actor.userId, name: actor.name },
              receipt.receiptDate.toISOString().slice(0, 10)
            ))
          )
          return { receipt, tid, txWarnings }
        },
        { timeout: 60000, maxWait: 10000 }
      )
      return {
        id: result.receipt.id,
        asCode: result.receipt.asCode,
        ticketId: result.tid,
        warnings: result.txWarnings,
        hospitalName: hospital.hospitalName,
      }
    } catch (err) {
      if (attempt === 0 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue
      throw err
    }
  }
}

// ── 접수 분할 (2026-11-07 — projects/as_receipt_split_design.md) ─────────────────────────────
// 미종결 라인을 병동별(WARD) / 구분별(CATEGORY) 새 접수(+티켓)로 분리. 라인 행은 **이동**(id·입고·초안·수리기록 보존),
// 이동 라인 유닛의 이벤트 ref {AS, 원본코드}는 `editEvent`로 자식 코드로 정정(§5 — 되돌림 게이트·INTAKE 1회 스킵이 ref_code를 보므로 필수).

export type AsSplitMode = 'WARD' | 'CATEGORY'
export const AS_SPLIT_MAX_GROUPS = 10

export interface SplitGroupInput {
  /** 그룹 식별(병동명 등 — 비고·응답 표기용) */
  key: string
  itemIds: number[]
  /** 자식 발송지 (미지정 = 원본 값) */
  destInfo?: string | null
  /** CATEGORY 모드만 — 원본의 반대 구분 */
  category?: string | null
}

export interface SplitInput {
  mode: AsSplitMode
  groups: SplitGroupInput[]
}

export interface SplitChild { id: number; asCode: string; ticketId: number; category: string; key: string; count: number }
export interface SplitResult { children: SplitChild[]; warnings: string[] }

/** 비고 시스템 줄 접두 — 타임라인·검색용 고정 형식 */
const splitStamp = (actorName: string | null) => `[분할 ${todayKst()}${actorName ? ` ${actorName}` : ''}]`

export async function splitAsReceipt(receiptId: number, actor: { userId: string; name: string | null }, input: SplitInput): Promise<SplitResult> {
  const mode = input.mode
  if (mode !== 'WARD' && mode !== 'CATEGORY') throw new AsServiceError(400, '분할 기준이 올바르지 않습니다.')
  const groups = Array.isArray(input.groups) ? input.groups : []
  if (!groups.length) throw new AsServiceError(400, '분할할 그룹을 1개 이상 지정하세요.')
  if (groups.length > AS_SPLIT_MAX_GROUPS) throw new AsServiceError(400, `분할 그룹은 최대 ${AS_SPLIT_MAX_GROUPS}개입니다.`)
  if (mode === 'CATEGORY' && groups.length !== 1) throw new AsServiceError(400, '구분별 분할은 그룹 1개(반대 구분)만 가능합니다.')

  const src = await prisma.asReceipt.findUnique({
    where: { id: receiptId },
    include: { status: { select: { id: true, name: true, ticketStatus: true } }, hospital: { select: { hospitalCode: true, hospitalName: true } }, ticket: { select: { id: true, ownerId: true, parentId: true, ticketCode: true } }, items: { select: { id: true, serialNo: true, deviceId: true, outcome: true, draftOutcome: true, draftNewSerialNo: true, stockOutRequest: { select: { sorCode: true, status: { select: { ticketStatus: true } } } } } } },
  })
  if (!src) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
  if (src.status?.ticketStatus === 'RESOLVED' || src.status?.ticketStatus === 'CLOSED') throw new AsServiceError(409, '종결(완료·취소)된 접수는 분할할 수 없습니다. 리오픈 후 분할하세요.')

  // 라인 검증 — 소속·미종결·중복
  const byId = new Map(src.items.map((i) => [i.id, i]))
  const seen = new Set<number>()
  const planned: { key: string; items: typeof src.items; destInfo: string | null; category: string }[] = []
  for (const g of groups) {
    const key = String(g.key ?? '').trim() || `그룹 ${planned.length + 1}`
    const ids = Array.isArray(g.itemIds) ? g.itemIds.map((v) => Number(v)) : []
    if (!ids.length) throw new AsServiceError(400, `${key}: 이동할 기기 라인이 없습니다.`)
    const items: typeof src.items = []
    for (const id of ids) {
      if (!Number.isInteger(id)) throw new AsServiceError(400, '라인 id가 올바르지 않습니다.')
      if (seen.has(id)) throw new AsServiceError(400, '같은 라인이 두 그룹에 들어 있습니다.')
      const it = byId.get(id)
      if (!it) throw new AsServiceError(400, `이 접수의 라인이 아닙니다: #${id}`)
      if (it.outcome) throw new AsServiceError(400, `처리 확정된 라인은 이동할 수 없습니다: ${it.serialNo}`)
      if (isAsLineLockedByStockOut(it)) throw new AsServiceError(409, `${it.serialNo}: 출고요청 ${it.stockOutRequest?.sorCode ?? ''} 처리 대기 중인 라인은 이동할 수 없습니다 — 먼저 출고요청을 취소하세요`) // 2026-11-10
      seen.add(id)
      items.push(it)
    }
    const destInfo = typeof g.destInfo === 'string' && g.destInfo.trim() ? g.destInfo.trim() : src.destInfo
    if (destInfo && destInfo.length > 5000) throw new AsServiceError(400, `${key}: 발송지 정보가 너무 깁니다.`)
    let category = src.category
    if (mode === 'CATEGORY') {
      const want = String(g.category ?? '')
      if (!(AS_CATEGORIES as readonly string[]).includes(want) || want === src.category) throw new AsServiceError(400, `구분별 분할은 원본과 다른 구분(${src.category === 'LOST' ? '고장' : '분실'})만 지정할 수 있습니다.`)
      category = want
    }
    planned.push({ key, items, destInfo, category })
  }
  const remainingOpen = src.items.filter((i) => !i.outcome && !seen.has(i.id)).length
  if (remainingOpen < 1) throw new AsServiceError(400, '원본에 미종결 라인이 1개 이상 남아야 합니다.')

  const actorName = actor.name ?? null
  const stamp = splitStamp(actorName)
  const modeLabel = mode === 'WARD' ? '병동별' : '구분별'

  // 전체를 한 트랜잭션 — 채번 P2002 1회 재시도(createAsReceipt 패턴)
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const warnings: string[] = []
        const children: SplitChild[] = []
        const noteLines: string[] = []
        for (const g of planned) {
          const lostChild = g.category === 'LOST' && mode === 'CATEGORY'
          const child = await tx.asReceipt.create({
            data: {
              asCode: await nextAsCode(tx),
              hospitalCode: src.hospitalCode,
              category: g.category,
              receiptDate: src.receiptDate,
              reporterName: src.reporterName,
              pickupMethod: mode === 'CATEGORY' ? (lostChild ? 'NONE' : src.pickupMethod ?? defaultAsPickupMethod(g.category)) : src.pickupMethod,
              pickupTrackingNo: lostChild ? null : src.pickupTrackingNo,
              pickedUpAt: lostChild ? null : src.pickedUpAt,
              pickupDestDiffers: src.pickupDestDiffers,
              pickupDestInfo: src.pickupDestInfo,
              receivedAt: src.receivedAt,
              checkedAt: src.checkedAt,
              preReplace: src.preReplace,
              priorityRepair: src.priorityRepair,
              firmwareUpdate: src.firmwareUpdate,
              accessoryIncluded: src.accessoryIncluded,
              combinedPack: src.combinedPack,
              destType: src.destType,
              destInfo: g.destInfo,
              expectedShipDate: src.expectedShipDate,
              statusId: src.statusId,
              statusChangedAt: new Date(),
              note: `${stamp} ${src.asCode}에서 분리 (${modeLabel} · ${g.key} · ${g.items.length}대)`,
              createdById: actor.userId,
              source: src.source,
              vocId: src.vocId,
              splitFromId: src.id,
            },
          })
          // 라인 이동 (§4.3) + 구분 축 초안 정리 (§3.3-4)
          const ids = g.items.map((i) => i.id)
          await tx.asReceiptItem.updateMany({ where: { id: { in: ids }, receiptId: src.id }, data: { receiptId: child.id } })
          if (mode === 'CATEGORY') {
            const allowed = asResolveOutcomesFor(g.category) as readonly string[]
            const bad = g.items.filter((i) => i.draftOutcome && !allowed.includes(i.draftOutcome))
            if (bad.length) {
              await tx.asReceiptItem.updateMany({ where: { id: { in: bad.map((i) => i.id) } }, data: { draftOutcome: null, draftNewSerialNo: null } })
              warnings.push(`${child.asCode}: ${AS_CATEGORY_LABELS[g.category as AsCategory]} 구분에서 허용되지 않는 처리방법 초안 해제 — ${bad.map((i) => `${i.serialNo}(${AS_OUTCOME_LABELS[i.draftOutcome as AsOutcome] ?? i.draftOutcome})`).join(', ')}`)
            }
          }
          // 티켓 — 어댑터 생성 + 담당자·상위(VOC) 승계 (D2)
          const tid = await createTicketForAsReceipt(tx, {
            id: child.id, asCode: child.asCode, hospitalCode: src.hospitalCode, hospitalName: src.hospital.hospitalName,
            category: g.category, statusName: src.status?.name ?? null, statusId: src.statusId,
            description: `${src.asCode}에서 분할 (${modeLabel} · ${g.key})`, resolvedAt: null, createdAt: child.createdAt,
          }, actor.userId, 'domain')
          const inherit: Prisma.TicketUncheckedUpdateInput = {}
          if (src.ticket?.ownerId) inherit.ownerId = src.ticket.ownerId
          if (src.ticket?.parentId) inherit.parentId = src.ticket.parentId
          if (Object.keys(inherit).length) {
            await tx.ticket.update({ where: { id: tid }, data: inherit })
            if (src.ticket?.parentId) await addTicketEvent(tx, tid, 'link', actor.userId, { event: 'parent_set', parentId: src.ticket.parentId, via: 'as_split' })
          }
          await addTicketEvent(tx, tid, 'link', actor.userId, { event: 'split_from', refType: 'AS', refCode: src.asCode, ticketId: src.ticket?.id ?? null, ticketCode: src.ticket?.ticketCode ?? null, mode, key: g.key, count: g.items.length })
          // 원장 ref 정정 (§5) — 이동 라인 유닛의 ref {AS, 원본} 이벤트 전부 → 자식 코드. 실패는 전파(tx 롤백 → 409)
          for (const it of g.items) {
            if (!it.deviceId) continue
            const evs = await tx.hospitalDeviceEvent.findMany({ where: { deviceId: it.deviceId, refType: 'AS', refCode: src.asCode }, select: { id: true }, orderBy: { id: 'asc' } })
            for (const ev of evs) {
              await editEvent(
                { hospitalCode: src.hospitalCode, actor: { userId: actor.userId, name: actor.name }, source: 'MANUAL', memo: `접수 분할 ${src.asCode} → ${child.asCode}` },
                { eventId: ev.id, patch: { ref: { type: 'AS', code: child.asCode } } },
                { client: tx }
              )
            }
          }
          children.push({ id: child.id, asCode: child.asCode, ticketId: tid, category: g.category, key: g.key, count: g.items.length })
          noteLines.push(`${g.key} ${g.items.length}대 → ${child.asCode}`)
        }
        // 원본 — 비고 줄·티켓 동기화·이력
        const cur = await tx.asReceipt.findUnique({ where: { id: src.id }, select: { note: true } })
        await tx.asReceipt.update({ where: { id: src.id }, data: { note: appendNote(cur?.note, `${stamp} ${modeLabel} 분할 — ${noteLines.join(' · ')}`) } })
        await syncAsReceiptToTicket(tx, src.id, actor.userId)
        if (src.ticket) await addTicketEvent(tx, src.ticket.id, 'link', actor.userId, { event: 'split_to', refType: 'AS', mode, children: children.map((c) => ({ asCode: c.asCode, ticketId: c.ticketId, key: c.key, count: c.count })) })
        return { children, warnings }
      }, { timeout: 60000, maxWait: 10000 })
    } catch (err) {
      if (attempt === 0 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue
      throw err
    }
  }
}
