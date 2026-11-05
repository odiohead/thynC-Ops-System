/** 모바일 출고요청 목록·상세 공용 — 행 타입·상태 배지·품목 요약 */

export interface MobileStockOutRow {
  id: number
  sorCode: string
  purpose: string
  subPurpose: string | null
  destType: string | null
  destText: string | null
  destHospital: { hospitalCode: string; hospitalName: string } | null
  project: { projectName: string } | null
  requestDate: string
  createdAt: string
  status: { id: number; name: string; color: string | null } | null
  items: { quantity: number; item: { name: string; modelName: string | null } }[]
}

export function StatusPill({ status }: { status: MobileStockOutRow['status'] }) {
  if (!status) return null
  return (
    <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: `${status.color ?? '#6B7280'}1F`, color: status.color ?? '#6B7280' }}>
      {status.name}
    </span>
  )
}

export function itemsLine(items: MobileStockOutRow['items']): string {
  if (!items.length) return '-'
  const total = items.reduce((s, l) => s + l.quantity, 0)
  const first = `${items[0].item.modelName || items[0].item.name} ${items[0].quantity}`
  return items.length > 1 ? `${first} 외 ${items.length - 1}종 · 총 ${total}개` : first
}
