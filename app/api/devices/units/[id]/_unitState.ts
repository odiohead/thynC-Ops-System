/**
 * 기기 상태·위치 축 라우트 공용(2026-09-17 device_condition_location_design.md §6.2·§7.1) — repair-done · repair-undo · scrap · location 4종이 함께 쓴다.
 *
 * - `syncAsLinesForUnitState` : **라인 동기화** — 그 기기의 `canMarkAsLineRepaired` 라인(`intake_state='RECEIVED' ∧ outcome ∉ {LOST, CANCELED, NOT_RECEIVED}`,
 *   종결 접수 포함 — A-2, 선교체 REPLACE·RECEIVED 포함)에 대해 수리완료는 미처리 라인을 회수기기 처리 '수리'로, 해제는 수리·문제없음 라인을 NULL로,
 *   폐기는 미처리 라인을 '폐기'로 기록(2026-11-02 — repair_result·repaired_at 짝은 DB CHECK로 강제).
 *   같은 tx + 접수 비고 이력(`[수리완료 (회수기기 수리) …]`/`[회수처리 해제 …]`/`[폐기 …]`). 드로어 경로의 원장 이벤트는 ref 없음(어느 접수든 `ownsDeviceState` 통과).
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
 * - done : 미처리 라인(+ 폐기였다가 기기 상태가 보정된 라인)을 회수기기 처리 '수리'로 기록(이미 수리·문제없음인 라인은 그대로 — 멱등)
 * - undo : 처리값이 수리·문제없음인 라인만 해제(폐기 라인 제외)
 * - scrap: 기기를 손에 쥔 라인(결과 없음 또는 교체) 중 **가장 최근 라인 1개**를 '폐기'로 기록(2026-11-02 — 이전엔 repaired_at 전부 NULL이라 폐기 기기가
 *          수리 대기 큐에 남았음. 수리반환된 과거 라인은 그 접수의 기록이라 유지) + 대상 기기 라인이 있는 접수 전부에 `[폐기 …] memo` 이력
 */
export async function syncAsLinesForUnitState(
  tx: DbClient,
  input: { deviceId: number; serialNo: string; mode: UnitStateSyncMode; actor: { userId: string | null; name: string | null }; on: string; memo?: string | null }
): Promise<AsLineSyncResult> {
  const items = await tx.asReceiptItem.findMany({
    where: { deviceId: input.deviceId, intakeState: 'RECEIVED', OR: [{ outcome: null }, { outcome: { notIn: [...AS_REPAIR_EXCLUDED_OUTCOMES] } }] },
    select: { id: true, outcome: true, intakeState: true, repairedAt: true, repairResult: true, receipt: { select: { id: true, asCode: true, note: true } } },
    orderBy: { id: 'asc' },
  })
  const eligible = items.filter((it) => canMarkAsLineRepaired(it))
  const inHand = eligible.filter((it) => it.outcome == null || it.outcome === 'REPLACE') // 수리반환 확정 라인은 이미 병원에 돌려준 기기 — 폐기 대상 기록 아님
  const latest = inHand[inHand.length - 1] // items는 id 오름차순
  const targets = input.mode === 'undo'
    ? eligible.filter((it) => it.repairResult === 'REPAIRED' || it.repairResult === 'NO_FAULT')
    : input.mode === 'done'
      ? eligible.filter((it) => it.repairedAt == null || it.repairResult === 'SCRAPPED')
      : latest && latest.repairResult !== 'SCRAPPED' ? [latest] : []
  if (targets.length > 0) {
    const on = { repairedAt: ymdToDate(input.on), repairedById: input.actor.userId ?? null }
    const data: Prisma.AsReceiptItemUncheckedUpdateManyInput = input.mode === 'done' ? { repairResult: 'REPAIRED', ...on } : input.mode === 'scrap' ? { repairResult: 'SCRAPPED', ...on } : { repairResult: null, repairedAt: null, repairedById: null }
    await tx.asReceiptItem.updateMany({ where: { id: { in: targets.map((t) => t.id) } }, data })
  }
  // 비고 이력 — done/undo는 실제 갱신된 라인의 접수만, scrap은 대상 라인이 있는 접수 전부(폐기 사실을 접수에 남긴다)
  const noteSource = input.mode === 'scrap' ? eligible : targets
  const receipts = new Map<number, { asCode: string; note: string | null }>()
  for (const it of noteSource) if (!receipts.has(it.receipt.id)) receipts.set(it.receipt.id, { asCode: it.receipt.asCode, note: it.receipt.note })
  const who = input.actor.name ?? ''
  const line =
    input.mode === 'done'
      ? `[수리완료 (회수기기 수리) ${input.on} ${who}] ${input.serialNo} (기기현황)`
      : input.mode === 'undo'
        ? `[회수처리 해제 ${input.on} ${who}] ${input.serialNo} (기기현황)`
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
