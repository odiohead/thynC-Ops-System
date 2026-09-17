/**
 * 기기 상태·위치 축 라우트 공용(2026-09-17 device_condition_location_design.md §6.2·§7.1) — repair-done · repair-undo · scrap · location 4종이 함께 쓴다.
 *
 * - `syncAsLinesForUnitState` : **라인 동기화** — 그 기기의 `canMarkAsLineRepaired` 라인(`intake_state='RECEIVED' ∧ outcome ∉ {LOST, CANCELED, NOT_RECEIVED}`,
 *   종결 접수 포함 — A-2, 선교체 REPLACE·RECEIVED 포함)에 대해 수리완료는 그중 `repaired_at IS NULL`인 라인에 기록, 해제·폐기는 전부 NULL.
 *   같은 tx + 접수 비고 이력(`[수리완료 …]`/`[수리완료 해제 …]`/`[폐기 …]`). 드로어 경로의 원장 이벤트는 ref 없음(어느 접수든 `ownsDeviceState` 통과).
 *   `as_receipt_items`는 prisma로 직접 갱신한다 — 비고 이력은 lib/asReceiptShared `appendAsNote`(AS 서비스와 공용, 5,000자 절단).
 * - `unitStateAudit`   : audit before/after 스냅샷(`projectionSnapshot` + 상태·위치 문장화 값. 배치 없는 유닛은 유닛 식별만)
 * - `unitStateResponse`: 201 본문 `{ changed, event, device, before, after, lines?, warnings }`
 */
import type { Prisma } from '@prisma/client'
import { flattenDevice, ymdToDate, type DbClient, type UnitStateResult } from '@/lib/deviceRegistry'
import { AS_REPAIR_EXCLUDED_OUTCOMES, appendAsNote, canMarkAsLineRepaired } from '@/lib/asReceiptShared'
import { projectionSnapshot } from '@/lib/deviceRegistryRoute'
import { locationSnapshotText } from '@/app/devices/_components/deviceDisplay'
import { deviceConditionLabel } from '@/lib/deviceRegistryShared'

export type UnitStateSyncMode = 'done' | 'undo' | 'scrap'

export interface AsLineSyncResult {
  /** repaired_at/by를 갱신한 라인 수 */
  updated: number
  /** 비고 이력을 남긴 접수 코드 */
  asCodes: string[]
}

/**
 * 라인 동기화(§6.2). `on`은 업무일자(YYYY-MM-DD) — 이벤트 occurredOn(드로어는 오늘). Prisma `notIn`은 NULL을 제외하므로 outcome NULL은 OR로 포함한다.
 * - done : `repaired_at IS NULL`인 라인만 기록(이미 체크된 라인은 그대로 — 멱등)
 * - undo : `repaired_at`이 있던 라인만 NULL
 * - scrap: `repaired_at` 전부 NULL + 대상 라인이 있는 접수 전부에 `[폐기 …] memo` 이력
 */
export async function syncAsLinesForUnitState(
  tx: DbClient,
  input: { deviceId: number; serialNo: string; mode: UnitStateSyncMode; actor: { userId: string | null; name: string | null }; on: string; memo?: string | null }
): Promise<AsLineSyncResult> {
  const items = await tx.asReceiptItem.findMany({
    where: { deviceId: input.deviceId, intakeState: 'RECEIVED', OR: [{ outcome: null }, { outcome: { notIn: [...AS_REPAIR_EXCLUDED_OUTCOMES] } }] },
    select: { id: true, outcome: true, intakeState: true, repairedAt: true, receipt: { select: { id: true, asCode: true, note: true } } },
    orderBy: { id: 'asc' },
  })
  const eligible = items.filter((it) => canMarkAsLineRepaired(it))
  const targets = input.mode === 'done' ? eligible.filter((it) => it.repairedAt == null) : eligible.filter((it) => it.repairedAt != null)
  if (targets.length > 0) {
    const data: Prisma.AsReceiptItemUncheckedUpdateManyInput = input.mode === 'done' ? { repairedAt: ymdToDate(input.on), repairedById: input.actor.userId ?? null } : { repairedAt: null, repairedById: null }
    await tx.asReceiptItem.updateMany({ where: { id: { in: targets.map((t) => t.id) } }, data })
  }
  // 비고 이력 — done/undo는 실제 갱신된 라인의 접수만, scrap은 대상 라인이 있는 접수 전부(폐기 사실을 접수에 남긴다)
  const noteSource = input.mode === 'scrap' ? eligible : targets
  const receipts = new Map<number, { asCode: string; note: string | null }>()
  for (const it of noteSource) if (!receipts.has(it.receipt.id)) receipts.set(it.receipt.id, { asCode: it.receipt.asCode, note: it.receipt.note })
  const who = input.actor.name ?? ''
  const line =
    input.mode === 'done'
      ? `[수리완료 ${input.on} ${who}] ${input.serialNo} (기기현황)`
      : input.mode === 'undo'
        ? `[수리완료 해제 ${input.on} ${who}] ${input.serialNo} (기기현황)`
        : `[폐기 ${input.on} ${who}] ${input.serialNo}${input.memo ? ` ${input.memo}` : ''} (기기현황)`
  for (const [id, r] of Array.from(receipts.entries())) {
    await tx.asReceipt.update({ where: { id }, data: { note: appendAsNote(r.note, line) } })
  }
  return { updated: targets.length, asCodes: Array.from(receipts.values()).map((r) => r.asCode) }
}

/** 상태·위치 축 결과 → 공개 device(배치 행 있는 유닛만 DeviceRow, 없으면 null) */
export function unitStateDevice(r: UnitStateResult) {
  return r.placement ? flattenDevice(r.unit, r.placement) : null
}

/** audit before/after — `projectionSnapshot`(배치 행 있을 때) + 상태·위치 문장화 값(§8.3 '스냅샷은 문장화 값') */
export function unitStateAudit(r: UnitStateResult) {
  const device = unitStateDevice(r)
  const base = device ? projectionSnapshot(device) : { id: r.unit.id, serialNo: r.unit.serialNo }
  const snap = (s: UnitStateResult['before']) => ({ condition: s.condition, conditionLabel: deviceConditionLabel(s.condition), location: s.location, locationLabel: locationSnapshotText(s.location) })
  return {
    device,
    before: { ...base, ...snap(r.before) } as Record<string, unknown>,
    after: {
      ...base,
      ...snap(r.after),
      ...(r.event ? { event: { id: r.event.id, eventType: r.event.eventType, occurredOn: r.event.occurredOn, memo: r.event.memo, refType: r.event.refType, refCode: r.event.refCode, actionGroup: r.event.actionGroup } } : {}),
    } as Record<string, unknown>,
  }
}

/** 201 본문 */
export function unitStateResponse(r: UnitStateResult, extra?: { lines?: AsLineSyncResult; warnings?: string[] }) {
  return {
    changed: r.changed,
    event: r.event,
    device: unitStateDevice(r),
    before: r.before,
    after: r.after,
    ...(extra?.lines ? { lines: extra.lines } : {}),
    warnings: [...r.warnings, ...(extra?.warnings ?? [])],
  }
}
