/**
 * 후속 훅 진입점 — 시그니처만 고정, 본체는 후속 구현 (§7.0 · §9.2 후속 훅 지점 · §9.4)
 *
 * - registerFromInventoryOut  : WMS 출고(OUT+병원 연결) → REGISTER(source WMS, ref INVENTORY_TX, 병동 NULL, 충돌은 skip)
 * - recoverFromInventoryReturn: WMS 반품 입고 → RECOVER(사유 value=RETURN 고정)
 * - cancelEventsOfRef         : 전표 취소(reverseTransaction) → 해당 ref 이벤트 취소(이후 이벤트 있으면 409)
 * - applyOnpremSnapshot       : 온프렘 전량 스냅샷 → 3분류 제안(자동 RECOVER 없음)
 * 멱등은 (ref_type, ref_code, device_id, event_type) 부분 UNIQUE(불변식 8) — `insertEvent`가 P2002를 no-op으로 삼킨다.
 */
import type { DbClient, RegistryActor, RegistryCtx, RegistryRef } from './core'

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

export async function cancelEventsOfRef(client: DbClient, ref: RegistryRef, actor: RegistryActor): Promise<never> {
  void client
  void ref
  void actor
  throw new Error('후속 구현')
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
