/**
 * 분실 AS — 구매수량 대비 누적 교체 제공 현황 (2026-10-30 사용자 요청)
 *
 * 정책: 분실 기기는 구매수량의 10%까지만 신규 기기로 제공. AS 상세 '1. 공통정보' 구분 필드에 기기군(심전계/산소포화도)별로
 * "이 접수 이전 제공 / 구매수량 (%)"를 표기하고, 이미 초과했거나 이 접수를 교체 처리하면 초과하는 경우 식별 표시.
 *
 * - 분모(구매수량) = 계약완료 딜의 `sales_deal_devices.quantity` 합(기기군별). 행이 없는 병원은 null('구매수량 미등록') — 사용자 결정: 원장 배치 수로 대체하지 않음
 * - 분자(이전 제공) = 같은 병원의 다른 분실 접수(취소 제외) 라인 중 결과가 '제공'(`AS_LOST_PROVIDED_OUTCOMES` = REPLACE·REPAIR_RETURN) 대수
 *   · REPAIR_RETURN을 포함하는 이유(2026-10-30 센트럴병원 HOSP-000076 사례): thynC AS이력 마이그(IMPORT)는 "발송기기(W) = 접수 시리얼(F)"이면 수리반환으로
 *     분류했는데, 분실 행은 CS가 새 기기에 분실 기기의 시리얼 라벨을 승계해 W에 같은 시리얼을 적는 관행이라 실제로는 전부 새 기기 제공(196라인·55곳).
 *     분실 기기를 수리해 돌려주는 경우는 없으므로 분실 접수의 수리반환 = 제공으로 본다 (앱에서는 분실 접수에 수리반환 선택 자체를 막음 — `asResolveOutcomesFor`)
 * - 이 접수 = 미종결 라인 전부 + 이미 제공 확정된 라인 (분실 접수는 교체 발송이 기본이므로 미종결 라인은 전부 교체 예정으로 본다)
 * - 기기군 접기는 asDeviceGroupOf(원장 모델명 → 미등록 라인 기기종류 → 시리얼 접두) 단일 소스
 */
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { asDeviceGroupOf, AS_LOST_QUOTA_PCT, AS_LOST_PROVIDED_OUTCOMES, type AsDeviceGroup, type AsLostQuota, type AsLostQuotaGroup } from '@/lib/asReceiptShared'

const QUOTA_GROUPS: AsLostQuotaGroup['group'][] = ['심전계', '산소포화도']
const PROVIDED = Prisma.join([...AS_LOST_PROVIDED_OUTCOMES])

export async function computeAsLostQuota(receipt: { id: number; hospitalCode: string }): Promise<AsLostQuota> {
  const [purchasedRows, beforeRows, thisRows] = await Promise.all([
    prisma.$queryRaw<{ device_name: string; qty: number }[]>`
      SELECT di.device_name, sum(dd.quantity)::int AS qty
      FROM sales_deal_devices dd JOIN sales_deals d ON d.id = dd.deal_id JOIN status_codes s ON s.id = d.status_id JOIN device_info di ON di.id = dd.device_info_id
      WHERE d.hospital_code = ${receipt.hospitalCode} AND s.name = '계약완료' AND dd.quantity > 0 GROUP BY di.device_name`,
    prisma.$queryRaw<{ device_name: string | null; device_kind: string | null; serial_no: string }[]>`
      SELECT di.device_name, i.device_kind, i.serial_no
      FROM as_receipt_items i JOIN as_receipts r ON r.id = i.receipt_id LEFT JOIN status_codes s ON s.id = r.status_id
      LEFT JOIN device_units du ON du.id = i.device_id LEFT JOIN device_info di ON di.id = du.device_info_id
      WHERE r.hospital_code = ${receipt.hospitalCode} AND r.category = 'LOST' AND r.id <> ${receipt.id} AND i.outcome IN (${PROVIDED}) AND coalesce(s.name, '') <> '취소'`,
    prisma.$queryRaw<{ device_name: string | null; device_kind: string | null; serial_no: string }[]>`
      SELECT di.device_name, i.device_kind, i.serial_no
      FROM as_receipt_items i LEFT JOIN device_units du ON du.id = i.device_id LEFT JOIN device_info di ON di.id = du.device_info_id
      WHERE i.receipt_id = ${receipt.id} AND (i.outcome IS NULL OR i.outcome IN (${PROVIDED}))`,
  ])
  const purchased = new Map<AsDeviceGroup, number>()
  for (const r of purchasedRows) { const g = asDeviceGroupOf(r.device_name, null); purchased.set(g, (purchased.get(g) ?? 0) + Number(r.qty)) }
  const count = (rows: { device_name: string | null; device_kind: string | null; serial_no: string }[]) => {
    const m = new Map<AsDeviceGroup, number>()
    for (const r of rows) { const g = asDeviceGroupOf(r.device_name, r.device_kind, r.serial_no); m.set(g, (m.get(g) ?? 0) + 1) }
    return m
  }
  const before = count(beforeRows)
  const cur = count(thisRows)
  const pct = (n: number, d: number | null) => (d ? Math.round((n / d) * 1000) / 10 : null)
  const groups: AsLostQuotaGroup[] = QUOTA_GROUPS.map((group) => {
    const p = purchased.get(group) ?? null
    const b = before.get(group) ?? 0
    const t = cur.get(group) ?? 0
    const a = b + t
    const limit = p === null ? null : (p * AS_LOST_QUOTA_PCT) / 100
    return {
      group, purchased: p, before: b, thisReceipt: t, after: a,
      pctBefore: pct(b, p), pctAfter: pct(a, p),
      overBefore: limit !== null && b > limit,
      overAfter: limit !== null && a > limit,
    }
  })
  return { thresholdPct: AS_LOST_QUOTA_PCT, hasPurchase: groups.some((g) => g.purchased !== null), groups }
}
