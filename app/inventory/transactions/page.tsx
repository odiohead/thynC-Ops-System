'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import BulkSerialTxModal from '../components/BulkSerialTxModal'
import TxEditModal from '../components/TxEditModal'

interface Warehouse { id: number; name: string; inventoryId: number }
interface Inventory { id: number; name: string; isActive: boolean }
interface Tx {
  id: number
  txCode: string
  txType: 'IN' | 'OUT' | 'MOVE' | 'TRANSFER'
  reasonCode: { id: number; name: string; value?: string | null } | null
  quantity: number
  transferDate: string | null
  transferPrice: number | null
  destination: string | null
  requester: string | null
  lotNo: string | null
  note: string | null
  canceledAt: string | null
  txDate: string
  createdAt: string
  item: { id: number; itemCode: string; name: string; unit: string; isSerialManaged: boolean }
  warehouse: { name: string } | null
  toWarehouse: { name: string } | null
  inventory: { name: string } | null
  toInventory: { name: string } | null
  hospital: { hospitalName: string } | null
  refCode: string | null
  workType: string | null
  actor: { name: string } | null
  canceledBy: { name: string } | null
  parentTx: { id: number; txCode: string } | null
  childTxs: { id: number; txCode: string }[]
}

const TYPE_BADGE: Record<string, string> = {
  IN: 'bg-green-50 text-green-700',
  OUT: 'bg-red-50 text-red-700',
  MOVE: 'bg-blue-50 text-blue-700',
  TRANSFER: 'bg-purple-50 text-purple-700',
}
const TYPE_LABEL: Record<string, string> = { IN: '입고', OUT: '출고', MOVE: '이동', TRANSFER: '이관(구)' }

export default function TransactionsPage() {
  const [txs, setTxs] = useState<Tx[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [inventories, setInventories] = useState<Inventory[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const limit = 50
  const [loading, setLoading] = useState(true)
  const [canManage, setCanManage] = useState(false)
  const [canEditTx, setCanEditTx] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [editTx, setEditTx] = useState<Tx | null>(null)

  const [filterType, setFilterType] = useState('')
  const [filterWarehouse, setFilterWarehouse] = useState('')
  const [filterInventory, setFilterInventory] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [error, setError] = useState<string | null>(null)

  const buildParams = useCallback(() => {
    const params = new URLSearchParams()
    if (filterType) params.set('txType', filterType)
    if (filterWarehouse) params.set('warehouseId', filterWarehouse)
    if (filterInventory) params.set('inventoryId', filterInventory)
    if (filterFrom) params.set('from', filterFrom)
    if (filterTo) params.set('to', filterTo)
    return params
  }, [filterType, filterWarehouse, filterInventory, filterFrom, filterTo])

  const fetchTxs = useCallback(async (p: number) => {
    setLoading(true)
    const params = buildParams()
    params.set('page', String(p))
    params.set('limit', String(limit))
    const res = await fetch(`/api/inventory/transactions?${params.toString()}`)
    if (res.ok) { const d = await res.json(); setTxs(d.data); setTotal(d.total) }
    setLoading(false)
  }, [buildParams])

  useEffect(() => {
    const inv = new URLSearchParams(window.location.search).get('inv')
    if (inv) setFilterInventory(inv)
    fetch('/api/settings/warehouses').then(async (r) => { if (r.ok) setWarehouses((await r.json()).warehouses) })
    fetch('/api/settings/inventories').then(async (r) => { if (r.ok) setInventories((await r.json()).inventories) })
    fetch('/api/inventory/can-manage').then(async (r) => { if (r.ok) { const d = await r.json(); setCanManage(d.canManage); setCanEditTx(!!d.canEditTx) } })
  }, [])
  useEffect(() => { setPage(1); fetchTxs(1) }, [fetchTxs])

  function exportExcel() {
    window.location.href = `/api/inventory/transactions/export?${buildParams().toString()}`
  }

  async function handleCancel(tx: Tx) {
    const setMsg = tx.childTxs.length > 0 ? `\n(세트출고 부자재 전표 ${tx.childTxs.length}건도 함께 취소됩니다)` : ''
    if (!confirm(`전표 ${tx.txCode}를 취소하시겠습니까? 재고가 역방향으로 되돌아갑니다.${setMsg}`)) return
    const res = await fetch(`/api/inventory/transactions/${tx.id}/cancel`, { method: 'POST' })
    if (res.ok) { fetchTxs(page) }
    else { setError((await res.json()).error ?? '취소 실패'); setTimeout(() => setError(null), 5000) }
  }

  const totalPages = Math.ceil(total / limit)
  const inputCls = 'rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-900">입출고 이력</h1>
        <div className="flex gap-2">
          {canManage && (
            <button onClick={() => setShowBulk(true)} className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100">Excel 일괄 입출고</button>
          )}
          <button onClick={exportExcel} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Excel 다운로드</button>
          <Link href={`/inventory${filterInventory ? `?inv=${filterInventory}` : ''}`} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">자재 현황</Link>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* 인벤토리 탭 — 인벤토리별 입출고 내역 분리 조회 */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-gray-200">
        <button onClick={() => setFilterInventory('')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${filterInventory === '' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          전체
        </button>
        {inventories.filter((i) => i.isActive).map((inv) => (
          <button key={inv.id} onClick={() => { setFilterInventory(String(inv.id)); setFilterWarehouse('') }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${filterInventory === String(inv.id) ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {inv.name}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className={inputCls}>
          <option value="">전체 유형</option>
          <option value="IN">입고</option>
          <option value="OUT">출고</option>
          <option value="MOVE">이동</option>
        </select>
        <select value={filterWarehouse} onChange={(e) => setFilterWarehouse(e.target.value)} className={inputCls}>
          <option value="">전체 위치</option>
          {warehouses
            .filter((w) => !filterInventory || w.inventoryId === parseInt(filterInventory))
            .map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className={inputCls} />
        <span className="text-gray-400 text-sm">~</span>
        <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className={inputCls} />
      </div>

      {/* 한 화면 표시 — 컬럼 병합(입출고일+처리일시·유형+입출고유형·인벤토리+위치) + 패딩 압축 + truncate */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              <th className="px-2 py-2.5">전표</th>
              <th className="px-2 py-2.5">입출고일</th>
              <th className="px-2 py-2.5">유형</th>
              <th className="px-2 py-2.5">품목</th>
              <th className="px-2 py-2.5 text-right">수량</th>
              <th className="px-2 py-2.5">인벤토리·위치</th>
              <th className="px-2 py-2.5">LOT</th>
              <th className="px-2 py-2.5">요청자</th>
              <th className="px-2 py-2.5">출고처</th>
              <th className="px-2 py-2.5">병원/업무</th>
              <th className="px-2 py-2.5">처리자</th>
              {canManage && <th className="px-2 py-2.5 text-right">관리</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={canManage ? 12 : 11} className="py-12 text-center text-sm text-gray-400">불러오는 중...</td></tr>
            ) : txs.length === 0 ? (
              <tr><td colSpan={canManage ? 12 : 11} className="py-12 text-center text-sm text-gray-400">이력이 없습니다.</td></tr>
            ) : txs.map((tx) => (
              <tr key={tx.id} className={`hover:bg-gray-50 ${tx.canceledAt ? 'opacity-50 line-through' : ''}`}>
                <td className="px-2 py-2 font-mono text-[11px] text-gray-500">
                  {tx.txCode}
                  {tx.parentTx && <span className="block text-[10px] text-emerald-600 no-underline">└ 세트 ({tx.parentTx.txCode})</span>}
                  {tx.childTxs.length > 0 && <span className="block text-[10px] text-emerald-600">세트출고 +{tx.childTxs.length}</span>}
                </td>
                <td className="px-2 py-2 text-xs">
                  <span className="font-medium text-gray-700 tabular-nums">{tx.txDate?.slice(0, 10) ?? '-'}</span>
                  <span className="block text-[10px] text-gray-400">{new Date(tx.createdAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                </td>
                <td className="px-2 py-2">
                  <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${TYPE_BADGE[tx.txType]}`}>{TYPE_LABEL[tx.txType]}</span>
                  {(tx.txType === 'IN' || tx.txType === 'OUT') && (
                    <span className="block max-w-[7rem] truncate text-[10px] text-gray-500" title={tx.reasonCode?.name ?? ''}>{tx.reasonCode?.name ?? '-'}</span>
                  )}
                </td>
                <td className="px-2 py-2 max-w-[14rem]">
                  <Link href={filterInventory ? `/inventory/${filterInventory}/items/${tx.item.id}` : `/inventory/items/${tx.item.id}`} title={tx.item.name} className="block truncate font-medium text-gray-900 hover:text-blue-600 no-underline">{tx.item.name}</Link>
                  <span className="block font-mono text-[10px] text-gray-400">{tx.item.itemCode}</span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums font-medium">{tx.quantity.toLocaleString()}<span className="text-xs text-gray-400 ml-0.5">{tx.item.unit}</span></td>
                <td className="px-2 py-2 text-xs text-gray-600 max-w-[11rem]">
                  <span className="block truncate text-[10px] text-gray-400" title={tx.inventory?.name ?? ''}>
                    {tx.inventory?.name ?? '-'}{tx.txType === 'TRANSFER' && tx.toInventory && <span className="text-purple-600"> → {tx.toInventory.name}</span>}
                  </span>
                  <span className="block truncate" title={`${tx.warehouse?.name ?? ''}${tx.toWarehouse ? ` → ${tx.toWarehouse.name}` : ''}`}>
                    {tx.warehouse?.name}{tx.toWarehouse && <span className="text-gray-400"> → {tx.toWarehouse.name}</span>}
                  </span>
                  {tx.txType === 'TRANSFER' && (
                    <span className="block text-[10px] text-gray-400">
                      {tx.transferDate ? new Date(tx.transferDate).toLocaleDateString('ko-KR') : ''}{tx.transferPrice != null && ` · 단가 ${tx.transferPrice.toLocaleString()}원`}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 font-mono text-[11px] text-gray-500 max-w-[6rem]"><span className="block truncate" title={tx.lotNo ?? ''}>{tx.lotNo ?? '-'}</span></td>
                <td className="px-2 py-2 text-gray-600 text-xs max-w-[6rem]"><span className="block truncate" title={tx.requester ?? ''}>{tx.requester ?? '-'}</span></td>
                <td className="px-2 py-2 text-gray-600 text-xs max-w-[8rem]"><span className="block truncate" title={tx.destination ?? ''}>{tx.destination ?? '-'}</span></td>
                <td className="px-2 py-2 text-gray-600 text-xs max-w-[10rem]">
                  <span className="block truncate" title={`${tx.hospital?.hospitalName ?? ''}${tx.refCode ? ` · ${tx.refCode}` : ''}`}>
                    {tx.hospital?.hospitalName ?? '-'}{tx.refCode && <span className="text-gray-400"> · {tx.refCode}</span>}
                  </span>
                </td>
                <td className="px-2 py-2 text-gray-500 text-xs">
                  {tx.actor?.name ?? '-'}
                  {tx.canceledAt && <span className="block text-red-400">취소: {tx.canceledBy?.name ?? ''}</span>}
                </td>
                {canManage && (
                  <td className="px-2 py-2 text-right">
                    {!tx.canceledAt && tx.txType !== 'TRANSFER' && (
                      <span className="inline-flex gap-1">
                        {canEditTx && (
                          <button onClick={() => setEditTx(tx)} className="rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50 no-underline">수정</button>
                        )}
                        <button onClick={() => handleCancel(tx)} className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-50 no-underline">취소</button>
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button onClick={() => { setPage(page - 1); fetchTxs(page - 1) }} disabled={page === 1} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40">이전</button>
          <span className="text-sm text-gray-600">{page} / {totalPages}</span>
          <button onClick={() => { setPage(page + 1); fetchTxs(page + 1) }} disabled={page === totalPages} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40">다음</button>
        </div>
      )}

      {showBulk && (
        <BulkSerialTxModal onClose={() => setShowBulk(false)} onDone={() => { setPage(1); fetchTxs(1) }} />
      )}

      {editTx && (
        <TxEditModal tx={editTx} onClose={() => setEditTx(null)} onDone={() => { setEditTx(null); fetchTxs(page) }} />
      )}
    </div>
  )
}
