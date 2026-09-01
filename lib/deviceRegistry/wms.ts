/**
 * WMS(inventory_units) 읽기 매칭 — §9.2 (D9: 조인 키만, WMS 테이블 쓰기 없음)
 *
 * - 행 단위 LIKE 금지 → 배치 1쿼리(`= ANY` + `right(serial_no, 7)`)
 * - `device_info_id` 일치 우선, `model_name` 폴백(GW 품목은 device_info_id NULL·model_name='MGW1010')
 * - 후보 1건 또는 OUT 1건이면 연결. `inventory_units.status`는 후보 우선순위·⚠ 표시에만 읽는다
 * - `persist:true`는 쓰기 경로(register/import/replace/CORRECT)에서만 — GET은 표시용 매칭만
 */
import { Prisma } from '@prisma/client'
import type { DbClient } from './core'

export interface WmsUnitRow {
  id: number
  serial_no: string
  status: string
  inventory_id: number
  inventory_name: string
  item_code: string
  device_info_id: number | null
  model_name: string | null
  linked_device_id: number | null
}

export interface WmsMatch {
  unitId: number
  serialNo: string
  inventoryName: string
  status: string
  itemCode: string
  modelName: string | null
}

export interface WmsMatchInput {
  id: number
  serialNo: string
  serialRaw: string | null
  deviceInfoId: number | null
  deviceModel: string | null
}

/**
 * §9.2 배치 쿼리 — 시리얼 키/원문 정확 일치 또는 접미 7자 일치(GW 합성 `GW4C11-B008381`).
 * 모델 제약(`modelIds`/`modelNames`)이 비어 있으면 시리얼만으로 조회한다(시리얼 조회 lookup용).
 */
export async function queryWmsUnits(
  client: DbClient,
  params: { keys: readonly string[]; raws?: readonly string[]; modelIds?: readonly number[]; modelNames?: readonly string[]; limit?: number }
): Promise<WmsUnitRow[]> {
  const exact = Array.from(new Set([...params.keys, ...(params.raws ?? [])].filter(Boolean)))
  const suffix = Array.from(new Set(params.keys.filter((k) => k.length === 7)))
  if (exact.length === 0 && suffix.length === 0) return []
  const modelIds = params.modelIds ?? []
  const modelNames = params.modelNames ?? []
  const modelFilter =
    modelIds.length === 0 && modelNames.length === 0
      ? Prisma.empty
      : Prisma.sql`AND (i.device_info_id = ANY(${modelIds}::int[]) OR i.model_name = ANY(${modelNames}::text[]))`
  const limit = params.limit && params.limit > 0 ? Prisma.sql`LIMIT ${params.limit}` : Prisma.empty
  return client.$queryRaw<WmsUnitRow[]>`
    SELECT u.id, u.serial_no::text AS serial_no, u.status::text AS status, u.inventory_id,
           inv.name::text AS inventory_name, i.item_code::text AS item_code, i.device_info_id, i.model_name::text AS model_name,
           hd.id AS linked_device_id
      FROM inventory_units u
      JOIN inventory_items i ON i.id = u.item_id
      JOIN inventories inv ON inv.id = u.inventory_id
      LEFT JOIN hospital_devices hd ON hd.inventory_unit_id = u.id
     WHERE i.is_serial_managed
       ${modelFilter}
       AND (u.serial_no = ANY(${exact}::text[]) OR right(u.serial_no, 7) = ANY(${suffix}::text[]))
     ORDER BY u.id
     ${limit}`
}

function toMatch(u: WmsUnitRow): WmsMatch {
  return { unitId: u.id, serialNo: u.serial_no, inventoryName: u.inventory_name, status: u.status, itemCode: u.item_code, modelName: u.model_name }
}

/** 메모리 판정 — 후보 중 모델 우선(device_info_id → model_name), 1건 또는 OUT 1건이면 연결 */
export function pickWmsMatch(device: WmsMatchInput, candidates: readonly WmsUnitRow[]): WmsMatch | null {
  const usable = candidates.filter((u) => u.linked_device_id == null || u.linked_device_id === device.id)
  if (usable.length === 0) return null
  const byModelId = device.deviceInfoId != null ? usable.filter((u) => u.device_info_id === device.deviceInfoId) : []
  const byModelName = device.deviceModel ? usable.filter((u) => u.model_name != null && u.model_name.toUpperCase() === device.deviceModel!.toUpperCase()) : []
  const pool = byModelId.length > 0 ? byModelId : byModelName.length > 0 ? byModelName : []
  if (pool.length === 0) return null
  if (pool.length === 1) return toMatch(pool[0])
  const out = pool.filter((u) => u.status === 'OUT')
  if (out.length === 1) return toMatch(out[0])
  return null
}

/**
 * 기기 배열 → WMS 개체 매칭(배치 1쿼리). `persist`면 매칭된 행의 `hospital_devices.inventory_unit_id`를 기록한다
 * (이미 다른 값이 있는 행은 덮지 않는다 — 연결은 쓰기 경로에서 한 번). 반환: deviceId → 매치 | null.
 */
export async function matchInventoryUnits(
  client: DbClient,
  devices: readonly WmsMatchInput[],
  opts: { persist: boolean }
): Promise<Map<number, WmsMatch | null>> {
  const result = new Map<number, WmsMatch | null>()
  if (devices.length === 0) return result
  const keys = devices.map((d) => d.serialNo).filter(Boolean)
  const raws = devices.map((d) => d.serialRaw).filter((r): r is string => !!r)
  const modelIds = Array.from(new Set(devices.map((d) => d.deviceInfoId).filter((v): v is number => v != null)))
  const modelNames = Array.from(new Set(devices.map((d) => d.deviceModel).filter((v): v is string => !!v)))
  const units = await queryWmsUnits(client, { keys, raws, modelIds, modelNames })

  // 시리얼 → 후보 인덱스 (정확 일치·접미 7자)
  const byExact = new Map<string, WmsUnitRow[]>()
  const bySuffix = new Map<string, WmsUnitRow[]>()
  for (const u of units) {
    const s = u.serial_no
    ;(byExact.get(s) ?? byExact.set(s, []).get(s)!).push(u)
    if (s.length >= 7) {
      const suf = s.slice(-7)
      ;(bySuffix.get(suf) ?? bySuffix.set(suf, []).get(suf)!).push(u)
    }
  }

  const persistUpdates: { id: number; unitId: number }[] = []
  for (const d of devices) {
    const cands = new Map<number, WmsUnitRow>()
    for (const u of byExact.get(d.serialNo) ?? []) cands.set(u.id, u)
    if (d.serialRaw) for (const u of byExact.get(d.serialRaw) ?? []) cands.set(u.id, u)
    if (d.serialNo.length === 7) for (const u of bySuffix.get(d.serialNo) ?? []) cands.set(u.id, u)
    const m = pickWmsMatch(d, Array.from(cands.values()))
    result.set(d.id, m)
    if (m && opts.persist) persistUpdates.push({ id: d.id, unitId: m.unitId })
  }

  if (opts.persist && persistUpdates.length > 0) {
    // 같은 unit이 두 기기에 배정되는 극단 케이스(UNIQUE) 방지 — unit당 첫 기기만
    const seenUnit = new Set<number>()
    for (const p of persistUpdates) {
      if (seenUnit.has(p.unitId)) continue
      seenUnit.add(p.unitId)
      await client.hospitalDevice.updateMany({
        where: { id: p.id, inventoryUnitId: null },
        data: { inventoryUnitId: p.unitId },
      })
    }
  }
  return result
}

/** 표시용 상태 플래그 — ACTIVE 개체가 창고 IN_STOCK/DISPOSED이면 ⚠ (§9.2) */
export function wmsWarning(match: WmsMatch | null | undefined, deviceStatus: string): string | null {
  if (!match) return null
  if (deviceStatus === 'ACTIVE' && match.status === 'IN_STOCK') return '창고 개체가 재고 상태(IN_STOCK)입니다'
  if (match.status === 'DISPOSED') return '창고 개체가 폐기(DISPOSED) 상태입니다'
  return null
}
