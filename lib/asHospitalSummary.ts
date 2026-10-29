/**
 * 병원 상세 'thynC 현황 > AS 현황' 집계 (2026-10-30) — 고장/분실 분리
 *
 * 서버 컴포넌트(HospitalAsSummary)가 직접 호출한다(API 경유 아님 — 병원 상세 권한을 따름, HospitalDeviceSummary 선례).
 * - 접수 단위: 누적·미완료(완료·취소 제외)·최근 90일 (상세 레코드 목록은 2026-10-30 사용자 결정으로 미표시 — 블록이 AS업무 필터 링크)
 * - 기기 단위: 누적 라인 수를 기기군(심전계/산소포화도)으로 접음(취소 접수·취소 라인 제외, asDeviceGroupOf 단일 소스)
 * - 분실: 교체 제공 / 구매수량(%)·한도 초과 여부는 lib/asLostQuota 와 같은 산식(receipt id 0 = 모든 분실 접수를 '이전 제공'으로 집계)
 */
import { prisma } from '@/lib/prisma'
import { asDeviceGroupOf, type AsDeviceGroup, type AsLostQuota } from '@/lib/asReceiptShared'
import { computeAsLostQuota } from '@/lib/asLostQuota'

export interface AsHospitalCategoryStat {
  category: 'FAULT' | 'LOST'
  receipts: number
  open: number
  openOver7d: number
  last90d: number
  devices: number
  byGroup: { group: AsDeviceGroup; count: number }[]
  lastReceiptDate: string | null
}
export interface AsHospitalSummary { fault: AsHospitalCategoryStat; lost: AsHospitalCategoryStat; lostQuota: AsLostQuota }

export async function getHospitalAsSummary(hospitalCode: string): Promise<AsHospitalSummary> {
  const [stats, items, lostQuota] = await Promise.all([
    prisma.$queryRaw<{ category: string; receipts: number; open: number; open_over7: number; last90: number; last_date: Date | null }[]>`
      SELECT r.category, count(*)::int AS receipts,
             count(*) FILTER (WHERE s.id IS NULL OR s.ticket_status <> 'CLOSED')::int AS open,
             count(*) FILTER (WHERE (s.id IS NULL OR s.ticket_status <> 'CLOSED') AND r.receipt_date < (now() AT TIME ZONE 'Asia/Seoul')::date - 7)::int AS open_over7,
             count(*) FILTER (WHERE r.receipt_date >= (now() AT TIME ZONE 'Asia/Seoul')::date - 90)::int AS last90,
             max(r.receipt_date) AS last_date
      FROM as_receipts r LEFT JOIN status_codes s ON s.id = r.status_id
      WHERE r.hospital_code = ${hospitalCode} AND coalesce(s.name, '') <> '취소' GROUP BY r.category`,
    prisma.$queryRaw<{ category: string; device_name: string | null; device_kind: string | null; serial_no: string }[]>`
      SELECT r.category, di.device_name, i.device_kind, i.serial_no
      FROM as_receipt_items i JOIN as_receipts r ON r.id = i.receipt_id LEFT JOIN status_codes s ON s.id = r.status_id
      LEFT JOIN device_units du ON du.id = i.device_id LEFT JOIN device_info di ON di.id = du.device_info_id
      WHERE r.hospital_code = ${hospitalCode} AND coalesce(s.name, '') <> '취소' AND coalesce(i.outcome, '') <> 'CANCELED'`,
    computeAsLostQuota({ id: 0, hospitalCode }),
  ])
  const stat = (category: 'FAULT' | 'LOST'): AsHospitalCategoryStat => {
    const s = stats.find((r) => r.category === category)
    const grp = new Map<AsDeviceGroup, number>()
    let devices = 0
    for (const it of items) if (it.category === category) { const g = asDeviceGroupOf(it.device_name, it.device_kind, it.serial_no); grp.set(g, (grp.get(g) ?? 0) + 1); devices++ }
    return {
      category,
      receipts: Number(s?.receipts ?? 0), open: Number(s?.open ?? 0), openOver7d: Number(s?.open_over7 ?? 0), last90d: Number(s?.last90 ?? 0),
      devices, byGroup: (['심전계', '산소포화도', '기타'] as AsDeviceGroup[]).map((g) => ({ group: g, count: grp.get(g) ?? 0 })).filter((g) => g.count > 0),
      lastReceiptDate: s?.last_date ? new Date(s.last_date).toISOString().slice(0, 10) : null,
    }
  }
  return { fault: stat('FAULT'), lost: stat('LOST'), lostQuota }
}
