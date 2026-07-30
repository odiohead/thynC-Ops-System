'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface Unit {
  id: number
  serialNo: string
  lotNo: string | null
  status: string
  warehouse: { name: string } | null
  hospital: { hospitalName: string } | null
}
interface TxUnit {
  unit: Unit
}
interface Tx {
  id: number
  txCode: string
  txType: 'IN' | 'OUT' | 'MOVE' | 'TRANSFER'
  reasonCode: { id: number; name: string } | null
  quantity: number
  destination: string | null
  requester: string | null
  lotNo: string | null
  note: string | null
  canceledAt: string | null
  txDate: string
  createdAt: string
  item: { id: number; itemCode: string; name: string; unit: string; isSerialManaged: boolean }
  warehouse: { id: number; name: string } | null
  toWarehouse: { id: number; name: string } | null
  inventory: { id: number; name: string } | null
  toInventory: { id: number; name: string } | null
  hospital: { hospitalName: string } | null
  refCode: string | null
  workType: string | null
  actor: { name: string } | null
  canceledBy: { name: string } | null
  parentTx: { id: number; txCode: string } | null
  childTxs: { id: number; txCode: string; item: { name: string }; quantity: number }[]
  units: TxUnit[]
}

const TYPE_BADGE: Record<string, string> = {
  IN: 'bg-green-50 text-green-700',
  OUT: 'bg-red-50 text-red-700',
  MOVE: 'bg-blue-50 text-blue-700',
  TRANSFER: 'bg-purple-50 text-purple-700',
}
const TYPE_LABEL: Record<string, string> = { IN: '입고', OUT: '출고', MOVE: '이동', TRANSFER: '이관(구)' }
const UNIT_STATUS: Record<string, { label: string; cls: string }> = {
  IN_STOCK: { label: '재고', cls: 'bg-green-50 text-green-700' },
  OUT: { label: '출고', cls: 'bg-gray-100 text-gray-600' },
  DISPOSED: { label: '폐기', cls: 'bg-red-50 text-red-600' },
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <div className="w-28 shrink-0 text-xs font-medium text-gray-400">{label}</div>
      <div className="text-sm text-gray-800">{children}</div>
    </div>
  )
}

export default function TransactionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [tx, setTx] = useState<Tx | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/inventory/transactions/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error || '조회 실패')
        return r.json()
      })
      .then((d) => setTx(d.transaction))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="p-6 text-sm text-gray-400">불러오는 중...</div>
  if (error || !tx)
    return (
      <div className="p-6">
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error || '전표를 찾을 수 없습니다.'}</div>
        <button onClick={() => router.back()} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">뒤로</button>
      </div>
    )

  const itemHref = tx.inventory ? `/inventory/${tx.inventory.id}/items/${tx.item.id}` : `/inventory/items/${tx.item.id}`

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-700">← 입출고 이력</button>
      </div>

      {/* 헤더 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className={`inline-flex items-center rounded px-2 py-0.5 text-sm font-medium ${TYPE_BADGE[tx.txType]}`}>{TYPE_LABEL[tx.txType]}</span>
        <span className="font-mono text-lg font-semibold text-gray-900">{tx.txCode}</span>
        {tx.canceledAt && <span className="rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">취소됨</span>}
      </div>

      {/* 전표 정보 */}
      <div className="mb-4 space-y-2.5 rounded-xl border border-gray-200 bg-white p-4">
        <Field label="품목">
          <Link href={itemHref} className="font-medium text-gray-900 hover:text-blue-600">
            {tx.item.name}
          </Link>
          <span className="ml-2 font-mono text-xs text-gray-400">{tx.item.itemCode}</span>
          {tx.item.isSerialManaged && <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">시리얼</span>}
        </Field>
        <Field label="수량">
          <span className="font-semibold tabular-nums">{tx.quantity.toLocaleString()}</span>
          <span className="ml-1 text-xs text-gray-400">{tx.item.unit}</span>
        </Field>
        {(tx.txType === 'IN' || tx.txType === 'OUT') && <Field label="입출고 유형">{tx.reasonCode?.name ?? '-'}</Field>}
        <Field label="인벤토리·위치">
          <span>{tx.inventory?.name ?? '-'}</span>
          <span className="mx-1 text-gray-300">/</span>
          <span>{tx.warehouse?.name ?? '-'}</span>
          {tx.toWarehouse && <span className="text-gray-400"> → {tx.toWarehouse.name}</span>}
        </Field>
        {tx.lotNo && <Field label="LOT">{tx.lotNo}</Field>}
        <Field label="입출고일">{tx.txDate?.slice(0, 10) ?? '-'}</Field>
        {tx.requester && <Field label="요청자">{tx.requester}</Field>}
        {tx.destination && <Field label="출고처">{tx.destination}</Field>}
        {(tx.hospital || tx.refCode) && (
          <Field label="병원·업무">
            {tx.hospital?.hospitalName ?? ''}
            {tx.refCode && <span className="text-gray-400"> · {tx.refCode}</span>}
          </Field>
        )}
        {tx.note && <Field label="비고">{tx.note}</Field>}
        <Field label="처리">
          {tx.actor?.name ?? '-'}
          <span className="ml-2 text-xs text-gray-400">{new Date(tx.createdAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}</span>
          {tx.canceledAt && <span className="ml-2 text-xs text-red-500">취소: {tx.canceledBy?.name ?? ''}</span>}
        </Field>
      </div>

      {/* 세트출고 부모/자식 */}
      {(tx.parentTx || tx.childTxs.length > 0) && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
          <div className="mb-2 text-xs font-medium text-emerald-700">세트출고</div>
          {tx.parentTx && (
            <div className="text-sm">
              주자재 전표:{' '}
              <Link href={`/inventory/transactions/${tx.parentTx.id}`} className="font-mono text-emerald-700 hover:underline">{tx.parentTx.txCode}</Link>
            </div>
          )}
          {tx.childTxs.map((c) => (
            <div key={c.id} className="text-sm">
              부자재:{' '}
              <Link href={`/inventory/transactions/${c.id}`} className="font-mono text-emerald-700 hover:underline">{c.txCode}</Link>
              <span className="ml-2 text-gray-600">{c.item.name} · {c.quantity.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}

      {/* 시리얼 개체 목록 */}
      {tx.item.isSerialManaged && (
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-2.5 text-sm font-medium text-gray-700">
            시리얼번호 <span className="text-gray-400">({tx.units.length})</span>
          </div>
          {tx.units.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">연결된 시리얼 개체가 없습니다.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium text-gray-500">
                    <th className="px-4 py-2">시리얼번호</th>
                    <th className="px-4 py-2">LOT</th>
                    <th className="px-4 py-2">현재 상태</th>
                    <th className="px-4 py-2">현재 위치</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tx.units.map(({ unit }) => {
                    const st = UNIT_STATUS[unit.status] ?? { label: unit.status, cls: 'bg-gray-100 text-gray-600' }
                    return (
                      <tr key={unit.id}>
                        <td className="px-4 py-2 font-mono text-gray-800">{unit.serialNo}</td>
                        <td className="px-4 py-2 font-mono text-xs text-gray-500">{unit.lotNo ?? '-'}</td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                        </td>
                        <td className="px-4 py-2 text-gray-600">{unit.hospital?.hospitalName ?? unit.warehouse?.name ?? '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
