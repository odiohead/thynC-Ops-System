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
import { AS_OUTCOMES, AS_RESOLVE_OUTCOMES, AS_CATEGORIES, AS_METHODS, AS_DEST_TYPES, AS_OUTCOME_LABELS, AS_REPAIR_EXCLUDED_OUTCOMES, appendAsNote as appendNote, asDeviceKindFromSerial, canMarkAsLineRepaired, type AsOutcome } from '@/lib/asReceiptShared'
import { nextAsCode } from '@/lib/asReceipt'

type DbClient = Prisma.TransactionClient | typeof prisma

export class AsServiceError extends Error {
  status: 400 | 404 | 409
  constructor(status: 400 | 404 | 409, message: string) {
    super(message)
    this.name = 'AsServiceError'
    this.status = status
  }
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
  line: { serialNo: string; deviceId: number | null; intakeState: string; receivedAt: Date | string | null; repairedAt: Date | string | null; outcome?: string | null }
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
  if (line.repairedAt) {
    try {
      await markDeviceRepaired(asCtx(receipt, actor, ymd(line.repairedAt) ?? today), { deviceId: line.deviceId }, { client: tx })
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
  opts?: { previousHospitalCode?: string }
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

  // 제거 (미종결) — IN_USE 복귀(실물 이동 근거 없음 → 병원, 게이트·플래그 소유 판정은 setUnitInUse). 병원 변경 시 미종결 라인 전부 대상(재추가 전제)
  // 병원 변경 재생성 라인은 입고·수리완료 기록을 보존해 새 매칭 기기에 재적용한다(§7.3 — 기존 유실 결함 동반 수정)
  const carried = new Map<string, { intakeState: string; receivedAt: Date | null; receiptSerialNo: string | null; intakeSource: string; repairedAt: Date | null; repairedById: string | null }>()
  for (const item of existing) {
    if (seen.has(item.serialNo) && !(hospitalChanged && !item.outcome)) continue
    if (hospitalChanged && !item.outcome && seen.has(item.serialNo)) {
      carried.set(item.serialNo, { intakeState: item.intakeState, receivedAt: item.receivedAt, receiptSerialNo: item.receiptSerialNo, intakeSource: item.intakeSource, repairedAt: item.repairedAt, repairedById: item.repairedById })
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
  const reapply: { serialNo: string; deviceId: number | null; intakeState: string; receivedAt: Date | null; repairedAt: Date | null }[] = []
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
        ...(keep ? { intakeState: keep.intakeState, receivedAt: keep.receivedAt, receiptSerialNo: keep.receiptSerialNo, intakeSource: keep.intakeSource, repairedAt: keep.repairedAt, repairedById: keep.repairedById } : {}),
      },
    })
    if (m.state === 'ACTIVE_HERE' && !m.asOpen) flagTargets.push({ serialNo: m.serialNo, deviceId: m.deviceId! })
    if (keep) reapply.push({ serialNo: m.serialNo, deviceId: m.deviceId, intakeState: keep.intakeState, receivedAt: keep.receivedAt, repairedAt: keep.repairedAt })
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
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new AsServiceError(400, '처리할 라인을 선택하세요.')
  for (const l of input.lines) {
    if (!Number.isInteger(l.itemId)) throw new AsServiceError(400, '라인이 올바르지 않습니다.')
    if (!AS_OUTCOMES.includes(l.outcome)) throw new AsServiceError(400, '처리 결과가 올바르지 않습니다.')
    if (l.outcome === 'NOT_RECEIVED') throw new AsServiceError(400, "'미회수'는 입고 대조의 접수자 확인에서만 확정할 수 있습니다.")
    if (l.outcome === 'REPLACE' && !normalizeSerial(l.newSerial ?? '').serialNo) {
      throw new AsServiceError(400, '교체 처리에는 발송기기 시리얼이 필요합니다.')
    }
  }
  const effectiveDate = input.effectiveDate?.trim() || todayKst()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new AsServiceError(400, '처리일이 올바르지 않습니다 (YYYY-MM-DD).')
  for (const l of input.lines) {
    if (l.effectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(l.effectiveDate)) throw new AsServiceError(400, '라인 처리일이 올바르지 않습니다 (YYYY-MM-DD).')
  }
  const shipMethod = input.shipMethod ?? null
  if (shipMethod && shipMethod !== 'PARCEL' && shipMethod !== 'VISIT') throw new AsServiceError(400, '발송방법이 올바르지 않습니다.')

  return prisma.$transaction(
    async (tx) => {
      const receipt = await tx.asReceipt.findUnique({
        where: { id: receiptId },
        select: {
          id: true, asCode: true, hospitalCode: true, category: true, note: true,
          status: { select: { ticketStatus: true } },
          items: { select: { id: true, serialNo: true, deviceId: true, outcome: true, intakeState: true, repairedAt: true } },
        },
      })
      if (!receipt) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
      if (receipt.status?.ticketStatus === 'RESOLVED' || receipt.status?.ticketStatus === 'CLOSED') {
        throw new AsServiceError(409, '완료·취소된 접수는 처리할 수 없습니다.')
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
          data.repairedAt = null
          data.repairedById = null
          history.push(`${item.serialNo} 수리완료 해제 (${AS_OUTCOME_LABELS[l.outcome]} 확정)`)
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
    },
    { timeout: 120000, maxWait: 10000 }
  )
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
  }
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.asReceipt.findUnique({
      where: { id: receiptId },
      select: { status: { select: { ticketStatus: true } }, items: { select: { id: true, serialNo: true, outcome: true, intakeState: true } } },
    })
    if (!receipt) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
    if (receipt.status?.ticketStatus === 'RESOLVED' || receipt.status?.ticketStatus === 'CLOSED') throw new AsServiceError(409, '완료·취소된 접수는 처리할 수 없습니다.')
    const byId = new Map(receipt.items.map((i) => [i.id, i]))
    let updated = 0
    for (const l of input.lines) {
      const item = byId.get(l.itemId)
      if (!item) throw new AsServiceError(400, '이 접수의 라인이 아닙니다.')
      if (item.outcome) throw new AsServiceError(409, `이미 확정된 라인은 변경할 수 없습니다: ${item.serialNo}`)
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
        const receivedAt = item.receivedAt ?? new Date(today)
        await tx.asReceiptItem.update({ where: { id: item.id }, data: { intakeState: 'RECEIVED', receivedAt } })
        await intakeUnit(item.deviceId, item.serialNo, receivedAt)
        history = `${item.serialNo} 정상입고 수동 확정`
        break
      }
      case 'NOT_RECEIVED': {
        const item = await getItem(action.itemId)
        if (item.intakeState !== 'MISMATCH') throw new AsServiceError(400, `미입고 라인이 아닙니다: ${item.serialNo}`)
        const comment = action.comment?.trim()
        if (!comment) throw new AsServiceError(400, '미회수 처리에는 코멘트가 필요합니다.')
        // 실물 이동 근거 없음 → IN_USE·병원(게이트 통과 시 — 플래그 소유면 AS_CLEAR, 아니면 CORRECT 폴백)
        if (item.deviceId) warnings.push(...(await setUnitInUse(tx, ctx, item.deviceId, { locationToHospital: true, memo: `미회수 확정 ${receipt.asCode}` })))
        // 미입고 라인은 수리완료 체크 불가(D5)지만 방어적으로 해제 — n/m 정합
        await tx.asReceiptItem.update({ where: { id: item.id }, data: { outcome: 'NOT_RECEIVED', processNote: comment, ...(item.repairedAt ? { repairedAt: null, repairedById: null } : {}) } })
        history = `${item.serialNo} 미회수 종결 — ${comment}${item.repairedAt ? ' (수리완료 해제)' : ''}`
        break
      }
      case 'ACCEPT_EXTRA': {
        const item = await getItem(action.itemId)
        if (item.intakeState !== 'EXTRA') throw new AsServiceError(400, `미식별입고 라인이 아닙니다: ${item.serialNo}`)
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
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.asReceipt.findUnique({
      where: { id: receiptId },
      select: { id: true, asCode: true, hospitalCode: true, receiptDate: true, note: true, status: { select: { ticketStatus: true } }, items: { select: { id: true, serialNo: true } } },
    })
    if (!receipt) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
    if (receipt.status?.ticketStatus === 'RESOLVED' || receipt.status?.ticketStatus === 'CLOSED') throw new AsServiceError(409, '완료·취소된 접수입니다.')
    const item = await tx.asReceiptItem.findFirst({ where: { id: input.itemId, receiptId } })
    if (!item) throw new AsServiceError(400, '이 접수의 라인이 아닙니다.')
    if (item.outcome) throw new AsServiceError(409, `이미 종결된 라인입니다: ${item.serialNo}`)
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

// ── 수리완료 체크 · 폐기 (2026-09-17 — device_condition_location_design.md §7.1·§7.2) ─────────
// 수리완료는 outcome·헤더 전이·완료 판정에 개입하지 않는 제3축(라인 repaired_at + 기기 condition REPAIRED). 게이트는 라인 단위 — 접수 상태 무관(종결 접수 허용, A-2).
// 이 함수들은 outcome·draft_*·헤더 상태·advanceToShippedDone·completeAsReceipt·reopen을 절대 건드리지 않는다.

export interface RepairDoneResult {
  itemId: number
  serialNo: string
  repaired: boolean
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
  if (item.intakeState !== 'RECEIVED') throw new AsServiceError(400, `입고된 라인만 ${what} 처리할 수 있습니다`)
  if (AS_REPAIR_EXCLUDED_OUTCOMES.includes(item.outcome ?? '')) throw new AsServiceError(400, `분실·취소·미회수 라인은 ${what} 대상이 아닙니다`)
  if (!canMarkAsLineRepaired(item)) throw new AsServiceError(400, `${what} 대상이 아닌 라인입니다`) // 판정 단일 소스(lib/asReceiptShared) 방어
  return item
}

/**
 * 수리완료 체크/해제 — `repaired=true`: repaired_at(오늘 KST, B-34)/by 기록 + `markDeviceRepaired`(AS_WAITING/NULL → REPAIRED, IN_USE는 경고 '이미 사용중')
 * `repaired=false`: repaired_at/by NULL + 기기 REPAIRED면 `undoDeviceRepaired`(CORRECT → AS_WAITING), 아니면 경고. 미등록 라인은 라인만 기록 + 경고(원장 확정 시 재적용).
 * 원장 RegistryError는 경고 흡수(유닛 쓰기 전 409만) — 단 **낙관 가드 409(동시 변경)는 전파**(tx 롤백 → 라우트 409 '다시 시도', §7.4: 라인만 커밋되고 기기 미반영인 반쪽 상태 방지).
 * 비고 이력 `[수리완료 …]`/`[수리완료 해제 …]`는 라인 또는 기기가 실제로 바뀐 호출에만(재체크 멱등 — 줄 누적 방지). (P2 리뷰 2026-09-17)
 */
export async function setAsLineRepaired(receiptId: number, actor: { userId: string; name: string | null }, input: { itemId: number; repaired: boolean }): Promise<RepairDoneResult> {
  if (!Number.isInteger(input.itemId)) throw new AsServiceError(400, '라인이 올바르지 않습니다.')
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.asReceipt.findUnique({ where: { id: receiptId }, select: { id: true, asCode: true, hospitalCode: true, note: true } })
    if (!receipt) throw new AsServiceError(404, 'AS접수를 찾을 수 없습니다.')
    const item = await requireRepairableLine(tx, receiptId, input.itemId, '수리완료')
    const warnings: string[] = []
    const today = todayKst()
    let condition: string | null = null
    const label = input.repaired ? '수리완료' : '수리완료 해제'
    let lineChanged = false // 라인 repaired_at/by 변경 여부
    let deviceChanged = false // 기기 이벤트 기록 여부 — 둘 다 아니면 비고 무기록(재체크 멱등)
    /** 낙관 가드 409(동시 변경)는 경고로 삼키지 않고 전파 — tx 롤백 → 라우트 409 '동시에 변경되어 다시 시도하세요'(§7.4) */
    const rethrowIfConcurrent = (e: RegistryError) => { if (e.message.includes(DEVICE_CONCURRENT_CHANGE_MESSAGE)) throw e }

    if (input.repaired) {
      // 이미 체크된 라인은 일자·사용자 유지(멱등), 기기 상태만 재확인
      if (!item.repairedAt) {
        await tx.asReceiptItem.update({ where: { id: item.id }, data: { repairedAt: new Date(today), repairedById: actor.userId } })
        lineChanged = true
      }
      if (!item.deviceId) warnings.push(`${item.serialNo}: 미등록 라인 — 기기 상태는 기록되지 않았습니다(원장 확정 시 재적용)`)
      else {
        try {
          const r = await markDeviceRepaired(asCtx(receipt, actor, today), { deviceId: item.deviceId }, { client: tx })
          condition = r.unit.condition
          deviceChanged = r.changed
          warnings.push(...r.warnings)
        } catch (e) {
          if (!(e instanceof RegistryError)) throw e
          rethrowIfConcurrent(e)
          const cur = await tx.deviceUnit.findUnique({ where: { id: item.deviceId }, select: { condition: true } })
          condition = cur?.condition ?? null
          warnings.push(e.message.includes(DEVICE_REPAIR_IN_USE_MESSAGE) ? `${item.serialNo}: 기기는 이미 사용중(반환 확정) — 라인에만 수리완료를 기록했습니다` : `${item.serialNo}: 기기 상태 기록 실패 — ${e.message}`)
        }
      }
    } else {
      if (item.repairedAt) {
        await tx.asReceiptItem.update({ where: { id: item.id }, data: { repairedAt: null, repairedById: null } })
        lineChanged = true
      }
      if (!item.deviceId) warnings.push(`${item.serialNo}: 미등록 라인 — 기기 상태는 바꾸지 않았습니다`)
      else {
        try {
          const r = await undoDeviceRepaired(asCtx(receipt, actor, today, '수리완료 해제'), { deviceId: item.deviceId }, { client: tx })
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
      await tx.asReceipt.update({ where: { id: receipt.id }, data: { note: appendNote(receipt.note, `[${label} ${today} ${actor.name ?? ''}] ${item.serialNo}`) } })
    } else if (!warnings.length) warnings.push(`${item.serialNo}: 변경 사항 없음 — 이미 ${label} 상태입니다`)
    const after = await tx.asReceiptItem.findUnique({ where: { id: item.id }, select: { repairedAt: true, repairedBy: { select: { id: true, name: true } } } })
    return { itemId: item.id, serialNo: item.serialNo, repaired: input.repaired, repairedAt: ymd(after?.repairedAt), repairedBy: after?.repairedBy ?? null, condition, warnings }
  }, { timeout: 60000, maxWait: 10000 })
}

export interface ScrapLineResult {
  itemId: number
  serialNo: string
  condition: string | null
  warnings: string[]
}

/**
 * 라인 기기 폐기(SCRAP) — 소속·`canMarkAsLineRepaired`·deviceId 필수(미등록 400)·condition ∉ {LOST, SCRAPPED}(400)·**memo 필수(400, A-5 완화책)**
 * → `scrapDevice`(배치 ACTIVE는 409 '배치 중 기기는 먼저 회수하세요' — 전파; 배치 행 없는 유닛(REGISTER 취소 등)은 허용 — §7.1) → 라인 repaired_at/by NULL → 비고 `[폐기 …] memo`.
 * 권한(!VIEWER)은 라우트. UI [폐기]는 `placement.status==='RECOVERED'`일 때만 노출(§6.1) — 배치 없음은 화면에서 도달하지 않는 서버 허용 집합.
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
    if (item.repairedAt) await tx.asReceiptItem.update({ where: { id: item.id }, data: { repairedAt: null, repairedById: null } })
    await tx.asReceipt.update({ where: { id: receipt.id }, data: { note: appendNote(receipt.note, `[폐기 ${today} ${actor.name ?? ''}] ${item.serialNo}${item.repairedAt ? ' (수리완료 해제)' : ''} — ${memo}`) } })
    return { itemId: item.id, serialNo: item.serialNo, condition: r.unit.condition, warnings: r.warnings }
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
  preReplace?: boolean
  destType?: string | null // HOSPITAL / OTHER
  destInfo?: string | null
  pickupDestInfo?: string | null // 회수지 정보 (CX #13 — 채널톡 인입 시 발송지와 동일 자동 기재)
  statusId?: number | null // 미지정 시 '접수'
  note?: string | null
  lines: LineInput[]
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

  const pickupMethod = input.pickupMethod ?? null
  if (pickupMethod && !(AS_METHODS as readonly string[]).includes(pickupMethod)) {
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
  const tagFlags = { priorityRepair: input.priorityRepair === true, firmwareUpdate: input.firmwareUpdate === true, accessoryIncluded: input.accessoryIncluded === true }
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
              statusId,
              note,
              createdById: actor.userId,
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
          }, actor.userId, 'domain')
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
