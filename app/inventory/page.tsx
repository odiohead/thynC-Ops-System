'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import TransactionModal, { ModalItem } from './components/TransactionModal'

interface Category { id: number; name: string; parentId: number | null }
interface Warehouse { id: number; name: string; isActive: boolean }
interface Inventory { id: number; name: string; isTransferLocked: boolean; linkHospital: boolean; isActive: boolean }
interface StockRow {
  id: number
  itemCode: string
  name: string
  modelName: string | null
  spec: string | null
  unit: string
  isSerialManaged: boolean
  category: { id: number; name: string } | null
  categoryPath: string
  deviceModel: string | null
  componentCount: number
  isComponent: boolean
  stocks: { warehouseId: number; warehouseName: string; inventoryId: number; inventoryName: string; quantity: number }[]
  total: number
}

/** 트리 분류를 들여쓰기 옵션으로 (대 > └중 > 　└소) */
function categoryOptions(categories: Category[]): { id: number; label: string }[] {
  const byParent = new Map<number | null, Category[]>()
  for (const c of categories) {
    const key = c.parentId
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(c)
  }
  const out: { id: number; label: string }[] = []
  function walk(parentId: number | null, depth: number) {
    for (const c of byParent.get(parentId) ?? []) {
      out.push({ id: c.id, label: `${'　'.repeat(depth)}${depth > 0 ? '└ ' : ''}${c.name}` })
      walk(c.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

export default function InventoryPage() {
  const [rows, setRows] = useState<StockRow[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [inventories, setInventories] = useState<Inventory[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [canManage, setCanManage] = useState(false)

  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterWarehouse, setFilterWarehouse] = useState('')
  const [tabInventory, setTabInventory] = useState('') // '' = 전체

  const [modalItem, setModalItem] = useState<ModalItem | null>(null)

  const fetchStocks = useCallback(async () => {
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (filterCategory) params.set('categoryId', filterCategory)
    if (filterWarehouse) params.set('warehouseId', filterWarehouse)
    if (tabInventory) params.set('inventoryId', tabInventory)
    const res = await fetch(`/api/inventory/stocks?${params.toString()}`)
    if (res.ok) setRows((await res.json()).items)
    setLoading(false)
  }, [search, filterCategory, filterWarehouse, tabInventory])

  useEffect(() => {
    const inv = new URLSearchParams(window.location.search).get('inv')
    if (inv) setTabInventory(inv)
    fetch('/api/settings/item-category').then(async (r) => { if (r.ok) setCategories((await r.json()).categories) })
    fetch('/api/settings/warehouses').then(async (r) => { if (r.ok) setWarehouses((await r.json()).warehouses) })
    fetch('/api/settings/inventories').then(async (r) => { if (r.ok) setInventories((await r.json()).inventories) })
    fetch('/api/auth/me').then(async (r) => { if (r.ok) { const d = await r.json(); setIsAdmin(d.role === 'SUPER_ADMIN' || d.role === 'ADMIN') } })
    fetch('/api/inventory/can-manage').then(async (r) => { if (r.ok) setCanManage((await r.json()).canManage) })
  }, [])
  useEffect(() => { fetchStocks() }, [fetchStocks])

  function exportExcel() {
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (filterCategory) params.set('categoryId', filterCategory)
    if (filterWarehouse) params.set('warehouseId', filterWarehouse)
    if (tabInventory) params.set('inventoryId', tabInventory)
    window.location.href = `/api/inventory/stocks/export?${params.toString()}`
  }

  const activeInventories = inventories.filter((i) => i.isActive)

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-xl font-semibold text-gray-900">자재 현황</h1>
        <div className="flex gap-2">
          <button onClick={exportExcel} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Excel 다운로드</button>
          <Link href={`/inventory/transactions${tabInventory ? `?inv=${tabInventory}` : ''}`} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">입출고 이력</Link>
          {isAdmin && <Link href="/inventory/items" className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">품목 관리</Link>}
        </div>
      </div>

      {/* 인벤토리 탭 */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-gray-200">
        <button onClick={() => setTabInventory('')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tabInventory === '' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          전체
        </button>
        {activeInventories.map((inv) => (
          <button key={inv.id} onClick={() => setTabInventory(String(inv.id))}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tabInventory === String(inv.id) ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {inv.name}
            {inv.isTransferLocked && <span className="ml-1 text-xs text-amber-500" title="이관 잠금">🔒</span>}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="품목명·모델명·코드·규격 검색" className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
          <option value="">전체 분류</option>
          {categoryOptions(categories).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select value={filterWarehouse} onChange={(e) => setFilterWarehouse(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
          <option value="">전체 위치</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              <th className="px-3 py-3">코드</th>
              <th className="px-3 py-3">분류</th>
              <th className="px-3 py-3">품목명</th>
              <th className="px-3 py-3">{tabInventory ? '위치별 재고' : '인벤토리·위치별 재고'}</th>
              <th className="px-3 py-3 text-right">총재고</th>
              {canManage && <th className="px-3 py-3 text-right">처리</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={canManage ? 6 : 5} className="py-12 text-center text-sm text-gray-400">불러오는 중...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={canManage ? 6 : 5} className="py-12 text-center text-sm text-gray-400">품목이 없습니다.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-3 py-3 font-mono text-xs text-gray-500">
                  <Link href={tabInventory ? `/inventory/${tabInventory}/items/${r.id}` : `/inventory/items/${r.id}`} className="hover:text-blue-600 hover:underline">{r.itemCode}</Link>
                </td>
                <td className="px-3 py-3 text-xs text-gray-600">
                  {r.categoryPath || <span className="text-gray-400">-</span>}
                </td>
                <td className="px-3 py-3 font-medium text-gray-900">
                  <Link href={tabInventory ? `/inventory/${tabInventory}/items/${r.id}` : `/inventory/items/${r.id}`} className="hover:text-blue-600 hover:underline">{r.name}</Link>
                  {r.modelName && <span className="ml-1 text-xs text-gray-400">{r.modelName}</span>}
                  {r.isSerialManaged && <span className="ml-1 text-xs text-indigo-500">S/N</span>}
                  {r.componentCount > 0 && <span className="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-600" title={`부자재 ${r.componentCount}종`}>주자재</span>}
                  {r.isComponent && <span className="ml-1 rounded bg-sky-50 px-1.5 py-0.5 text-xs font-medium text-sky-600">부자재</span>}
                </td>
                <td className="px-3 py-3">
                  {r.stocks.length === 0 ? <span className="text-gray-300">-</span> : (
                    <div className="flex flex-wrap gap-1">
                      {r.stocks.map((s) => (
                        <span key={`${s.warehouseId}-${s.inventoryId}`} className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                          {!tabInventory && <>{s.inventoryName} <span className="text-gray-400">·</span></>} {s.warehouseName} <b className="tabular-nums">{s.quantity}</b>
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 text-right">
                  <span className="tabular-nums font-semibold text-gray-900">{r.total}</span> <span className="text-xs text-gray-400">{r.unit}</span>
                </td>
                {canManage && (
                  <td className="px-3 py-3 text-right">
                    <button onClick={() => setModalItem({ id: r.id, itemCode: r.itemCode, name: r.name, unit: r.unit, isSerialManaged: r.isSerialManaged })}
                      className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700">입출고</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalItem && (
        <TransactionModal
          item={modalItem}
          warehouses={warehouses}
          defaultInventoryId={tabInventory ? parseInt(tabInventory) : null}
          onClose={() => setModalItem(null)}
          onDone={() => { setModalItem(null); fetchStocks() }}
        />
      )}
    </div>
  )
}
