'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import TransactionModal, { ModalItem } from '../../../components/TransactionModal'

interface Item {
  id: number
  itemCode: string
  name: string
  modelName: string | null
  spec: string | null
  unit: string
  isSerialManaged: boolean
  isLotManaged: boolean
  refPrice: number | null
  memo: string | null
  isActive: boolean
  inventoryId: number
  inventory: { id: number; name: string; linkHospital: boolean } | null
  categoryPath: string
  manufacturer: { id: number; name: string } | null
  deviceInfo: { deviceName: string; deviceModel: string } | null
  stocks: { warehouseId: number; quantity: number; warehouse: { name: string } }[]
}
interface Warehouse { id: number; name: string; isActive: boolean; inventoryId: number }
interface Tx {
  id: number; txCode: string; txType: string; quantity: number
  reasonCode: { name: string } | null
  destination: string | null
  canceledAt: string | null; createdAt: string
  warehouse: { name: string } | null; toWarehouse: { name: string } | null
  inventory: { id: number; name: string } | null; toInventory: { id: number; name: string } | null
  hospital: { hospitalName: string } | null; actor: { name: string } | null
  parentTx: { txCode: string } | null
}
interface Unit {
  id: number; serialNo: string; lotNo: string | null; status: string; memo: string | null
  warehouse: { name: string } | null; hospital: { hospitalName: string } | null
}

const TYPE_LABEL: Record<string, string> = { IN: '입고', OUT: '출고', MOVE: '이동', TRANSFER: '이관(구)' }
const UNIT_STATUS: Record<string, { label: string; cls: string }> = {
  IN_STOCK: { label: '재고', cls: 'bg-green-50 text-green-700' },
  OUT: { label: '출고', cls: 'bg-blue-50 text-blue-700' },
  DISPOSED: { label: '폐기', cls: 'bg-gray-100 text-gray-500' },
}

/**
 * 인벤토리 자재 상세 — 품목이 인벤토리에 귀속되므로 URL의 invId와 품목 소속이 일치해야 한다.
 * 재고·이력·개체·입출고 처리 전부 이 인벤토리 스코프.
 */
export default function InventoryScopedItemPage() {
  const params = useParams()
  const invId = parseInt(params.invId as string)
  const itemId = params.itemId as string

  const [item, setItem] = useState<Item | null>(null)
  const [txs, setTxs] = useState<Tx[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [canManage, setCanManage] = useState(false)
  const [tab, setTab] = useState<'history' | 'units'>('history')
  const [modalOpen, setModalOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    const [iRes, tRes] = await Promise.all([
      fetch(`/api/inventory/items/${itemId}`),
      fetch(`/api/inventory/transactions?itemId=${itemId}&limit=100`),
    ])
    if (iRes.ok) setItem((await iRes.json()).item)
    if (tRes.ok) setTxs((await tRes.json()).data)
    setLoading(false)
  }, [itemId])

  const fetchUnits = useCallback(async () => {
    const res = await fetch(`/api/inventory/units?itemId=${itemId}`)
    if (res.ok) setUnits((await res.json()).units)
  }, [itemId])

  useEffect(() => {
    fetch('/api/settings/warehouses').then(async (r) => { if (r.ok) setWarehouses((await r.json()).warehouses) })
    fetch('/api/inventory/can-manage').then(async (r) => { if (r.ok) setCanManage((await r.json()).canManage) })
  }, [])
  useEffect(() => { fetchAll() }, [fetchAll])
  useEffect(() => { if (item?.isSerialManaged) fetchUnits() }, [item?.isSerialManaged, fetchUnits])

  if (loading) return <div className="p-8 text-sm text-gray-500">불러오는 중...</div>
  if (!item) return <div className="p-8 text-sm text-gray-500">품목을 찾을 수 없습니다. <Link href="/inventory" className="text-blue-600">자재 현황으로</Link></div>
  // 품목이 다른 인벤토리 소속이면 스코프 불일치 안내
  if (item.inventoryId !== invId) {
    return (
      <div className="p-8 text-sm text-gray-500">
        이 품목은 다른 인벤토리({item.inventory?.name ?? '?'}) 소속입니다.{' '}
        <Link href={`/inventory/${item.inventoryId}/items/${item.id}`} className="text-blue-600 hover:underline">해당 인벤토리에서 보기</Link>
        {' · '}
        <Link href="/inventory" className="text-blue-600 hover:underline">자재 현황으로</Link>
      </div>
    )
  }

  const inventory = item.inventory!
  const scopedStocks = item.stocks.filter((s) => s.quantity > 0)
  const scopedTotal = item.stocks.reduce((sum, s) => sum + s.quantity, 0)
  const inStockUnits = units.filter((u) => u.status === 'IN_STOCK')

  const modalItem: ModalItem = { id: item.id, itemCode: item.itemCode, name: item.name, unit: item.unit, isSerialManaged: item.isSerialManaged, isLotManaged: item.isLotManaged }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
        <Link href="/inventory" className="hover:text-blue-600">자재 현황</Link>
        <span>/</span>
        <span className="font-medium text-blue-600">{inventory.name}</span>
        <span>/</span>
        <span className="font-mono text-xs">{item.itemCode}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-sm font-semibold text-blue-700">
              {inventory.name}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            {item.name}
            {item.isSerialManaged && <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">시리얼</span>}
            {!item.isActive && <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">비활성</span>}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            {item.modelName && <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">{item.modelName}</span>}
            {item.categoryPath && <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{item.categoryPath}</span>}
            {item.manufacturer && <span className="text-xs">{item.manufacturer.name}</span>}
            {item.spec && <span>{item.spec}</span>}
            <Link href={`/inventory/items/${item.id}`} className="text-xs text-blue-600 hover:underline">품목 마스터 보기 →</Link>
          </div>
        </div>
        {canManage && (
          <button onClick={() => setModalOpen(true)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">입출고</button>
        )}
      </div>

      {/* 이 인벤토리 재고 요약 */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 mb-6">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <div className="text-xs text-gray-500">{inventory.name} 재고</div>
            <div className="mt-0.5 text-2xl font-bold text-gray-900">{scopedTotal}<span className="text-sm font-normal text-gray-400 ml-1">{item.unit}</span></div>
          </div>
          <div className="flex-1">
            <div className="text-xs text-gray-500 mb-1">위치별</div>
            {scopedStocks.length === 0 ? (
              <div className="text-sm text-gray-400">재고 없음</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {scopedStocks.map((s) => (
                  <span key={s.warehouseId} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-700">
                    {s.warehouse.name} <b className="tabular-nums">{s.quantity}</b>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 탭 — 이 품목(=이 인벤토리)의 이력·개체 */}
      <div className="mb-3 flex border-b border-gray-200">
        <button onClick={() => setTab('history')} className={`px-4 py-2 text-sm font-medium ${tab === 'history' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>입출고 이력</button>
        {item.isSerialManaged && <button onClick={() => setTab('units')} className={`px-4 py-2 text-sm font-medium ${tab === 'units' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>개체 목록 (재고 {inStockUnits.length})</button>}
      </div>

      {tab === 'history' ? (
        <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="px-3 py-2">전표</th><th className="px-3 py-2">일시</th><th className="px-3 py-2">유형</th><th className="px-3 py-2">입출고 유형</th><th className="px-3 py-2 text-right">수량</th><th className="px-3 py-2">위치</th><th className="px-3 py-2">출고처/병원</th><th className="px-3 py-2">처리자</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {txs.length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-sm text-gray-400">이력이 없습니다.</td></tr>
              ) : txs.map((tx) => (
                <tr key={tx.id} className={tx.canceledAt ? 'opacity-50 line-through' : ''}>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500">
                    {tx.txCode}
                    {tx.parentTx && <span className="block text-[10px] text-emerald-600">└ 세트</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{new Date(tx.createdAt).toLocaleDateString('ko-KR')}</td>
                  <td className="px-3 py-2">
                    {TYPE_LABEL[tx.txType] ?? tx.txType}
                    {tx.txType === 'TRANSFER' && tx.inventory && tx.toInventory && (
                      <span className="block text-[10px] text-purple-600">{tx.inventory.name} → {tx.toInventory.name}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{tx.txType === 'MOVE' ? '이동' : tx.txType === 'TRANSFER' ? '이관(구)' : (tx.reasonCode?.name ?? '-')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{tx.quantity}</td>
                  <td className="px-3 py-2 text-gray-600">{tx.warehouse?.name}{tx.toWarehouse && ` → ${tx.toWarehouse.name}`}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{tx.destination ?? tx.hospital?.hospitalName ?? '-'}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{tx.actor?.name ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="px-3 py-2">시리얼</th><th className="px-3 py-2">LOT</th><th className="px-3 py-2">상태</th><th className="px-3 py-2">위치</th><th className="px-3 py-2">설치처</th><th className="px-3 py-2">메모</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {units.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-sm text-gray-400">개체가 없습니다.</td></tr>
              ) : units.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-2 font-mono text-gray-900">{u.serialNo}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500">{u.lotNo ?? '-'}</td>
                  <td className="px-3 py-2"><span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${UNIT_STATUS[u.status]?.cls ?? ''}`}>{UNIT_STATUS[u.status]?.label ?? u.status}</span></td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{u.status === 'IN_STOCK' ? (u.warehouse?.name ?? '-') : '-'}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{u.status === 'OUT' ? (u.hospital?.hospitalName ?? '출고됨') : '-'}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{u.memo ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <TransactionModal item={modalItem} inventory={inventory} warehouses={warehouses}
          onClose={() => setModalOpen(false)} onDone={() => { setModalOpen(false); fetchAll(); if (item.isSerialManaged) fetchUnits() }} />
      )}
    </div>
  )
}
