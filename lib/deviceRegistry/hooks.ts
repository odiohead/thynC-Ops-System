/**
 * 후속 훅 진입점 — 시그니처만 고정, 본체는 후속 구현 (§7.0 · §9.2 후속 훅 지점 · §9.4)
 *
 * - registerFromInventoryOut  : WMS 출고(OUT+병원 연결) → REGISTER(source WMS, ref INVENTORY_TX, 병동 NULL, 충돌은 skip)
 * - recoverFromInventoryReturn: WMS 반품 입고 → RECOVER(사유 value=RETURN 고정)
 * - cancelEventsOfRef         : 전표 취소(cancelInventoryTransaction) → 해당 ref 이벤트 취소(이후 이벤트 있으면 409) — **구현됨 (2026-11-27)**
 * - applyOnpremSnapshot       : 온프렘 전량 스냅샷 → 3분류 제안(자동 RECOVER 없음)
 * 멱등은 (ref_type, ref_code, device_id, event_type) 부분 UNIQUE(불변식 8) — `insertEvent`가 P2002를 no-op으로 삼킨다.
 */
import { normalizeSerial } from '@/lib/deviceRegistryShared'
import type { DbClient, EventRow, RegistryActor, RegistryCtx, RegistryRef } from './core'
import { cancelLastEvent } from './admin'

export async function registerFromInventoryOut(client: DbClient, txId: number, actor: RegistryActor): Promise<never> {
  void client
  void txId
  void actor
  throw new Error('후속 구현')
}

export async function recoverFromInventoryReturn(client: DbClient, txId: number, actor: RegistryActor): Promise<never> {
  void client
  void txId
  void actor
  throw new Error('후속 구현')
}

export interface CancelRefItem {
  serialNo: string
  hospitalCode: string | null
  /** 취소의 기준이 된 이벤트(그 ref 로 만든 등록) */
  eventId: number
  /** 함께 지워진 이벤트 전체 (이관이었으면 원래 병원의 회수 짝 포함) — 감사 기록용 */
  cancelledEventIds: number[]
  cancelledEvents: EventRow[]
  /** 취소 뒤 남은 배치 (없으면 null = 배치 기록이 사라짐, 있으면 원래 병원으로 복귀) */
  restored: { status: string; hospitalCode: string | null } | null
}
export interface CancelRefResult {
  cancelled: CancelRefItem[]
  warnings: string[]
}

/**
 * 이 ref(들)로 만들어진 기기현황 기록을 취소한다 — 전표 취소가 부른다(호출부 트랜잭션에 합류).
 *
 *  - ref 가 같은 기록 가운데 opts.serials 의 시리얼만 본다. 출고요청 한 건이 창고별로 전표가 나뉘면 등록 기록의 ref 는
 *    첫 전표 하나로 적히므로(lib/stockOutFulfill.ts), 호출부가 같은 요청의 전표 코드를 모두 넘기고 시리얼로 좁힌다
 *  - 취소 자체는 화면의 '이벤트 취소'와 같은 `cancelLastEvent` — 그 기기에 이후 기록(병동 이동 · AS · 회수 등)이 있으면
 *    RegistryError 409 를 그대로 던진다 → 호출부(전표 취소)가 통째로 되돌린다. 기기현황을 먼저 정리해야 전표를 취소할 수 있다
 *  - 해당 기록이 없으면 아무것도 하지 않는다(기기현황에 등록하지 않는 품목 · 병원 연결 없는 출고)
 */
export async function cancelEventsOfRef(
  client: DbClient,
  ref: RegistryRef | readonly RegistryRef[],
  actor: RegistryActor,
  opts?: { serials?: readonly string[] },
): Promise<CancelRefResult> {
  const refs = (Array.isArray(ref) ? ref : [ref]) as readonly RegistryRef[]
  const out: CancelRefResult = { cancelled: [], warnings: [] }
  if (refs.length === 0) return out
  const serials = opts?.serials ? Array.from(new Set(opts.serials.map((s) => normalizeSerial(s).serialNo).filter(Boolean))) : null
  if (serials && serials.length === 0) return out
  const events = await client.hospitalDeviceEvent.findMany({
    where: {
      OR: refs.map((r) => ({ refType: r.type, refCode: r.code })),
      eventType: 'REGISTER',
      ...(serials ? { device: { serialNo: { in: serials } } } : {}),
    },
    include: { device: { select: { serialNo: true } } },
    orderBy: { id: 'desc' },
  })
  const done = new Set<number>()
  for (const ev of events) {
    if (done.has(ev.id)) continue
    const r = await cancelLastEvent({ actor }, { eventId: ev.id }, { client })
    for (const id of r.cancelledEventIds) done.add(id)
    const back = r.restoredDevices.find((d) => d.id === ev.deviceId) ?? null
    out.cancelled.push({
      serialNo: ev.device.serialNo,
      hospitalCode: ev.hospitalCode,
      eventId: ev.id,
      cancelledEventIds: r.cancelledEventIds,
      cancelledEvents: r.cancelledEvents,
      restored: back ? { status: back.status, hospitalCode: back.hospitalCode } : null,
    })
    out.warnings.push(...r.warnings)
  }
  return out
}

export interface OnpremSnapshotRow {
  serialNumber: string
  wardCode?: string | null
  deviceType?: number | null
  organizationCode?: string | null
  macAddress?: string | null
  deviceCode?: string | null
}

export async function applyOnpremSnapshot(ctx: RegistryCtx, rows: readonly OnpremSnapshotRow[]): Promise<never> {
  void ctx
  void rows
  throw new Error('후속 구현')
}
