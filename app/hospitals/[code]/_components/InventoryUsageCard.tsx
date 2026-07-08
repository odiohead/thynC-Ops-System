'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Tx {
  id: number
  createdAt: string
  reasonCode: { name: string } | null
  inventory: { name: string } | null
  quantity: number
  refCode: string | null
  canceledAt: string | null
  item: { id: number; itemCode: string; name: string; unit: string }
}
interface Unit {
  id: number
  serialNo: string
  item: { id: number; name: string; itemCode: string }
}

/**
 * 병원 상세 — 이 병원으로 출고된 자재 이력 + 설치된 시리얼 개체.
 * function_wms.md §7. 메인 모듈 컴포넌트(자재관리는 위키 경계와 무관).
 */
export default function InventoryUsageCard({ hospitalCode }: { hospitalCode: string }) {
  const [txs, setTxs] = useState<Tx[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch(`/api/inventory/transactions?hospitalCode=${encodeURIComponent(hospitalCode)}&limit=100`).then((r) => r.ok ? r.json() : { data: [] }),
      fetch(`/api/inventory/units?hospitalCode=${encodeURIComponent(hospitalCode)}&status=OUT`).then((r) => r.ok ? r.json() : { units: [] }),
    ]).then(([t, u]) => {
      setTxs((t.data ?? []).filter((x: Tx) => !x.canceledAt))
      setUnits(u.units ?? [])
      setLoading(false)
    })
  }, [hospitalCode])

  if (loading) return null
  if (txs.length === 0 && units.length === 0) return null

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <h2 className="text-sm font-semibold text-gray-700">사용 자재</h2>
        <Link href="/inventory" className="text-xs text-blue-600 hover:underline">자재 현황</Link>
      </div>

      {txs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['일자', '품목', '수량', '유형', '인벤토리', '연결업무'].map((c) => (
                  <th key={c} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {txs.map((tx) => (
                <tr key={tx.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">{new Date(tx.createdAt).toLocaleDateString('ko-KR')}</td>
                  <td className="px-4 py-3">
                    <Link href={`/inventory/items/${tx.item.id}`} className="text-sm font-medium text-gray-900 hover:text-blue-600">{tx.item.name}</Link>
                    <span className="ml-1 font-mono text-xs text-gray-400">{tx.item.itemCode}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm tabular-nums text-gray-700">{tx.quantity} {tx.item.unit}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{tx.reasonCode?.name ?? '-'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{tx.inventory?.name ?? '-'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{tx.refCode ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {units.length > 0 && (
        <div className="border-t border-gray-100 px-6 py-4">
          <div className="mb-2 text-xs font-medium text-gray-500">설치된 개체 (시리얼)</div>
          <div className="flex flex-wrap gap-1.5">
            {units.map((u) => (
              <span key={u.id} className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
                <span className="text-gray-400">{u.item.name}</span>
                <span className="font-mono text-gray-900">{u.serialNo}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
