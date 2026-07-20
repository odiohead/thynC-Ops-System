'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import TransactionModal, { ModalInventory, TxType } from './components/TransactionModal'

interface Category { id: number; name: string; parentId: number | null }
interface Warehouse { id: number; name: string; isActive: boolean; inventoryId: number }
interface Inventory { id: number; name: string; linkHospital: boolean; isActive: boolean }
interface StockRow {
  id: number
  itemCode: string
  name: string
  modelName: string | null
  spec: string | null
  unit: string
  isSerialManaged: boolean
  inventoryId: number
  category: { id: number; name: string } | null
  categoryPath: string
  deviceModel: string | null
  componentCount: number
  isComponent: boolean
  stocks: { warehouseId: number; warehouseName: string; quantity: number }[]
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

/**
 * 자재 현황 첫페이지 — 인벤토리별 카드 섹션 (탭 없음).
 * 각 섹션 헤더에 입고/출고/이동 버튼 1세트 (품목은 모달에서 선택), 행별 입출고 버튼 없음.
 */
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

  const [modal, setModal] = useState<{ inventory: ModalInventory; txType: TxType } | null>(null)

  const fetchStocks = useCallback(async () => {
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (filterCategory) params.set('categoryId', filterCategory)
    const res = await fetch(`/api/inventory/stocks?${params.toString()}`)
    if (res.ok) setRows((await res.json()).items)
    setLoading(false)
  }, [search, filterCategory])

  useEffect(() => {
    fetch('/api/settings/item-category').then(async (r) => { if (r.ok) setCategories((await r.json()).categories) })
    fetch('/api/settings/warehouses').then(async (r) => { if (r.ok) setWarehouses((await r.json()).warehouses) })
    fetch('/api/settings/inventories').then(async (r) => { if (r.ok) setInventories((await r.json()).inventories) })
    fetch('/api/auth/me').then(async (r) => { if (r.ok) { const d = await r.json(); setIsAdmin(d.role === 'SUPER_ADMIN' || d.role === 'ADMIN') } })
    fetch('/api/inventory/can-manage').then(async (r) => { if (r.ok) setCanManage((await r.json()).canManage) })
  }, [])
  useEffect(() => { fetchStocks() }, [fetchStocks])

  function exportExcel(inventoryId?: number) {
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (filterCategory) params.set('categoryId', filterCategory)
    if (inventoryId) params.set('inventoryId', String(inventoryId))
    window.location.href = `/api/inventory/stocks/export?${params.toString()}`
  }

  const activeInventories = inventories.filter((i) => i.isActive)

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-xl font-semibold text-gray-900">자재 현황</h1>
        <div className="flex gap-2">
          <button onClick={() => exportExcel()} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Excel 다운로드</button>
          <Link href="/inventory/transactions" className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">입출고 이력</Link>
          {isAdmin && <Link href="/inventory/items" className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">품목 관리</Link>}
        </div>
      </div>

      {/* 공통 필터 — 모든 인벤토리 섹션에 적용 */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="품목명·모델명·코드·규격 검색" className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
          <option value="">전체 분류</option>
          {categoryOptions(categories).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>

      {/* 인벤토리별 카드 섹션 */}
      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">불러오는 중...</div>
      ) : (
        <div className="space-y-8">
          {activeInventories.map((inv) => {
            const invRows = rows.filter((r) => r.inventoryId === inv.id)
            const invWarehouseCount = warehouses.filter((w) => w.inventoryId === inv.id && w.isActive).length
            const invTotal = invRows.reduce((sum, r) => sum + r.total, 0)
            return (
              <section key={inv.id} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                {/* 섹션 헤더 */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h2 className="text-base font-semibold text-gray-900">{inv.name}</h2>
                    <span className="text-xs text-gray-500">
                      품목 {invRows.length}종 · 총 <b className="tabular-nums text-gray-700">{invTotal.toLocaleString()}</b> · 위치 {invWarehouseCount}곳
                    </span>
                    {inv.linkHospital && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">병원 연결</span>}
                  </div>
                  {canManage && (
                    <div className="flex gap-1.5">
                      <button onClick={() => setModal({ inventory: inv, txType: 'IN' })}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">입고</button>
                      <button onClick={() => setModal({ inventory: inv, txType: 'OUT' })}
                        className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700">출고</button>
                      <button onClick={() => setModal({ inventory: inv, txType: 'MOVE' })}
                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100">이동</button>
                    </div>
                  )}
                </div>

                {/* 품목별 재고 테이블 */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        <th className="px-3 py-2.5">코드</th>
                        <th className="px-3 py-2.5">분류</th>
                        <th className="px-3 py-2.5">품목명</th>
                        <th className="px-3 py-2.5">위치별 재고</th>
                        <th className="px-3 py-2.5 text-right">총재고</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {invRows.length === 0 ? (
                        <tr><td colSpan={5} className="py-8 text-center text-sm text-gray-400">품목이 없습니다.</td></tr>
                      ) : invRows.map((r) => (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="px-3 py-3 font-mono text-xs text-gray-500">
                            <Link href={`/inventory/${inv.id}/items/${r.id}`} className="hover:text-blue-600 hover:underline">{r.itemCode}</Link>
                          </td>
                          <td className="px-3 py-3 text-xs text-gray-600">
                            {r.categoryPath || <span className="text-gray-400">-</span>}
                          </td>
                          <td className="px-3 py-3 font-medium text-gray-900">
                            <Link href={`/inventory/${inv.id}/items/${r.id}`} className="hover:text-blue-600 hover:underline">{r.name}</Link>
                            {r.modelName && <span className="ml-1 text-xs text-gray-400">{r.modelName}</span>}
                            {r.isSerialManaged && <span className="ml-1 text-xs text-indigo-500">S/N</span>}
                            {r.componentCount > 0 && <span className="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-600" title={`부자재 ${r.componentCount}종`}>주자재</span>}
                            {r.isComponent && <span className="ml-1 rounded bg-sky-50 px-1.5 py-0.5 text-xs font-medium text-sky-600">부자재</span>}
                          </td>
                          <td className="px-3 py-3">
                            {r.stocks.length === 0 ? <span className="text-gray-300">-</span> : (
                              <div className="flex flex-wrap gap-1">
                                {r.stocks.map((s) => (
                                  <span key={s.warehouseId} className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                                    {s.warehouseName} <b className="tabular-nums">{s.quantity.toLocaleString()}</b>
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span className="tabular-nums font-semibold text-gray-900">{r.total.toLocaleString()}</span> <span className="text-xs text-gray-400">{r.unit}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )
          })}
        </div>
      )}

      {modal && (
        <TransactionModal
          inventory={modal.inventory}
          defaultTxType={modal.txType}
          warehouses={warehouses}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); fetchStocks() }}
        />
      )}
    </div>
  )
}
