/**
 * AS 접수 상세 — 계약건별 도입 기기수량 · 상품유형(일반/라이트)×기기군 AS 교체 현황 (2026-11-02, projects/as_deal_quota_design.md)
 *
 * 취지: 라이트형은 AS(교체) 수량에 정책 제한이 있어 접수 처리 시점에 "도입 수량 대비 교체 누계"를 봐야 한다.
 * 한도(2026-11-02): **라이트형만** 도입 수량의 100%(AS_LITE_REPLACE_QUOTA_PCT)까지 — 이미 초과·이 접수 처리 시 초과를 셀·필드·상단 배너에 표시. 일반형은 비율만
 * - 분모(도입 수량) = 이 병원 계약완료 딜을 `sales_deals.product_type`으로 묶어 `sales_deal_devices.quantity`를 기기군별 합산
 * - 분자(교체 누계) = 이 병원 **고장** 접수(분실 제외 — 분실 교체는 분실 한도 필드가 담당)의 REPLACE 라인(취소 접수 제외, 이 접수 제외)을
 *   교체된 기기의 원장 상품유형(`hospital_devices.product_type` — 이 병원 행 우선)으로 집계. 기기 미연결·상품유형 없음 → '미지정'
 * - 계약건별 교체 수는 산출하지 않는다 (기기의 deal_code 연결 75%·잡음 — 설계 §2). 딜 목록은 도입 수량 출처 표시용
 * - 이 접수분 = 이 접수가 고장 접수일 때 미종결 라인(outcome NULL) + 교체 확정 라인
 */
import { prisma } from '@/lib/prisma'
import { asDeviceGroupOf, type AsDeviceGroup, type AsDealQuota, type AsDealQuotaCell, type AsDealQuotaDeal, type AsDealQuotaRow, type AsProductTypeRow, AS_PRODUCT_TYPE_ROWS, AS_LITE_REPLACE_QUOTA_PCT } from '@/lib/asReceiptShared'

type Grp = Exclude<AsDeviceGroup, '기타'>
const GROUPS: Grp[] = ['심전계', '산소포화도']
const ptOf = (v: string | null | undefined): AsProductTypeRow => (v === '일반' || v === '라이트' ? v : '미지정')
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

interface LineRow { device_name: string | null; device_kind: string | null; serial_no: string; product_type: string | null }

export async function computeAsDealQuota(receipt: { id: number; hospitalCode: string; category: string }): Promise<AsDealQuota> {
  const isFault = receipt.category !== 'LOST'
  const [dealRows, beforeRows, thisRows] = await Promise.all([
    prisma.$queryRaw<{ deal_code: string; round_no: number; contract_date: Date | null; product_type: string | null; device_name: string | null; qty: number | null }[]>`
      SELECT d.deal_code, d.round_no, d.contract_date, d.product_type, di.device_name, sum(dd.quantity)::int AS qty
      FROM sales_deals d JOIN status_codes s ON s.id = d.status_id
      LEFT JOIN sales_deal_devices dd ON dd.deal_id = d.id AND dd.quantity > 0
      LEFT JOIN device_info di ON di.id = dd.device_info_id
      WHERE d.hospital_code = ${receipt.hospitalCode} AND s.name = '계약완료'
      GROUP BY d.id, d.deal_code, d.round_no, d.contract_date, d.product_type, di.device_name
      ORDER BY d.round_no, d.contract_date NULLS LAST, d.id`,
    // 교체 누계 — 이 병원 고장 접수(취소 제외)·이 접수 제외·REPLACE 라인. 상품유형 = 교체된 기기의 원장 행(이 병원 행 우선, 최신)
    prisma.$queryRaw<LineRow[]>`
      SELECT di.device_name, i.device_kind, i.serial_no, hd.product_type
      FROM as_receipt_items i JOIN as_receipts r ON r.id = i.receipt_id LEFT JOIN status_codes s ON s.id = r.status_id
      LEFT JOIN device_units du ON du.id = i.device_id LEFT JOIN device_info di ON di.id = du.device_info_id
      LEFT JOIN LATERAL (
        SELECT h.product_type FROM hospital_devices h WHERE h.device_id = i.device_id
        ORDER BY (h.hospital_code = r.hospital_code) DESC, h.id DESC LIMIT 1
      ) hd ON TRUE
      WHERE r.hospital_code = ${receipt.hospitalCode} AND r.category <> 'LOST' AND r.id <> ${receipt.id}
        AND i.outcome = 'REPLACE' AND coalesce(s.name, '') <> '취소'`,
    isFault
      ? prisma.$queryRaw<LineRow[]>`
      SELECT di.device_name, i.device_kind, i.serial_no, hd.product_type
      FROM as_receipt_items i JOIN as_receipts r ON r.id = i.receipt_id
      LEFT JOIN device_units du ON du.id = i.device_id LEFT JOIN device_info di ON di.id = du.device_info_id
      LEFT JOIN LATERAL (
        SELECT h.product_type FROM hospital_devices h WHERE h.device_id = i.device_id
        ORDER BY (h.hospital_code = r.hospital_code) DESC, h.id DESC LIMIT 1
      ) hd ON TRUE
      WHERE i.receipt_id = ${receipt.id} AND (i.outcome IS NULL OR i.outcome = 'REPLACE')`
      : Promise.resolve([] as LineRow[]),
  ])

  // 딜 목록 + 상품유형별 도입 수량
  const dealMap = new Map<string, AsDealQuotaDeal>()
  const introduced = new Map<AsProductTypeRow, Partial<Record<Grp, number>>>()
  const dealTypes = new Set<AsProductTypeRow>()
  for (const r of dealRows) {
    const pt = ptOf(r.product_type)
    dealTypes.add(pt)
    const d = dealMap.get(r.deal_code) ?? { dealCode: r.deal_code, roundNo: r.round_no, contractDate: ymd(r.contract_date), productType: pt, ecg: null, spo2: null }
    if (r.device_name && r.qty) {
      const g = asDeviceGroupOf(r.device_name, null)
      if (g === '심전계') d.ecg = (d.ecg ?? 0) + Number(r.qty)
      if (g === '산소포화도') d.spo2 = (d.spo2 ?? 0) + Number(r.qty)
      if (g !== '기타') { const m = introduced.get(pt) ?? {}; m[g] = (m[g] ?? 0) + Number(r.qty); introduced.set(pt, m) }
    }
    dealMap.set(r.deal_code, d)
  }

  const count = (rows: LineRow[]) => {
    const m = new Map<AsProductTypeRow, Partial<Record<Grp, number>>>()
    for (const r of rows) {
      const g = asDeviceGroupOf(r.device_name, r.device_kind, r.serial_no)
      if (g === '기타') continue
      const pt = ptOf(r.product_type)
      const c = m.get(pt) ?? {}; c[g] = (c[g] ?? 0) + 1; m.set(pt, c)
    }
    return m
  }
  const before = count(beforeRows)
  const cur = count(thisRows)
  const pct = (n: number, d: number | null) => (d ? Math.round((n / d) * 1000) / 10 : null)

  const rows: AsDealQuotaRow[] = []
  for (const pt of AS_PRODUCT_TYPE_ROWS) {
    const hasDeal = dealTypes.has(pt)
    const hasAny = hasDeal || GROUPS.some((g) => (before.get(pt)?.[g] ?? 0) + (cur.get(pt)?.[g] ?? 0) > 0)
    if (!hasAny) continue
    if (pt === '미지정' && !hasAny) continue
    const cells = {} as Record<Grp, AsDealQuotaCell>
    for (const g of GROUPS) {
      const intro = hasDeal ? introduced.get(pt)?.[g] ?? null : null
      const b = before.get(pt)?.[g] ?? 0
      const t = cur.get(pt)?.[g] ?? 0
      const limit = pt === '라이트' && intro !== null ? (intro * AS_LITE_REPLACE_QUOTA_PCT) / 100 : null
      cells[g] = {
        introduced: intro, before: b, thisReceipt: t, after: b + t, pctBefore: pct(b, intro), pctAfter: pct(b + t, intro),
        overBefore: limit !== null && b > limit,
        overAfter: limit !== null && b + t > limit,
      }
    }
    rows.push({ productType: pt, hasDeal, cells })
  }
  const liteCells = rows.filter((r) => r.productType === '라이트').flatMap((r) => GROUPS.map((g) => r.cells[g]))
  return {
    liteThresholdPct: AS_LITE_REPLACE_QUOTA_PCT,
    liteOverBefore: liteCells.some((c) => c.overBefore),
    liteOverAfter: liteCells.some((c) => c.overAfter),
    deals: Array.from(dealMap.values()),
    rows,
  }
}
