'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Category { id: number; name: string; parentId: number | null }
interface Device { id: number; deviceModel: string; deviceName: string }
interface Manufacturer { id: number; name: string }
interface Inventory { id: number; name: string; isActive: boolean }

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
  sortOrder: number
  inventoryId: number
  inventory: { id: number; name: string } | null
  category: { id: number; name: string; parentId: number | null } | null
  categoryPath: string
  manufacturer: { id: number; name: string } | null
  deviceInfo: { id: number; deviceName: string; deviceModel: string } | null
}

interface ItemForm {
  inventoryId: number | null // 소속 인벤토리 (등록 시 필수, 수정 불가)
  name: string
  modelName: string
  cat1: number | null // 대분류
  cat2: number | null // 중분류
  cat3: number | null // 소분류
  manufacturerId: number | null
  spec: string
  unit: string
  isSerialManaged: boolean
  isLotManaged: boolean
  deviceInfoId: number | null
  refPrice: string
  memo: string
  isActive: boolean
}

const emptyForm: ItemForm = {
  inventoryId: null, name: '', modelName: '', cat1: null, cat2: null, cat3: null, manufacturerId: null, spec: '', unit: 'EA',
  isSerialManaged: false, isLotManaged: false, deviceInfoId: null, refPrice: '', memo: '', isActive: true,
}

interface PreviewResult {
  total: number
  newCount: number
  skipped: number
  unknownCategories: string[]
  unknownManufacturers: string[]
  rows: { name: string; modelName: string | null; categoryPath: string | null; manufacturer: string | null; unit: string; isSerialManaged: boolean; isLotManaged: boolean }[]
}

/** 품목의 categoryId에서 대/중/소 선택 상태 복원 */
function categoryChain(categories: Category[], leafId: number | null): [number | null, number | null, number | null] {
  if (leafId == null) return [null, null, null]
  const map = new Map(categories.map((c) => [c.id, c]))
  const chain: number[] = []
  let cur = map.get(leafId)
  while (cur && chain.length < 3) {
    chain.unshift(cur.id)
    cur = cur.parentId != null ? map.get(cur.parentId) : undefined
  }
  return [chain[0] ?? null, chain[1] ?? null, chain[2] ?? null]
}

export default function InventoryItemsPage() {
  const router = useRouter()
  const [items, setItems] = useState<Item[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([])
  const [inventories, setInventories] = useState<Inventory[]>([])
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState<string>('')
  const [tabInventory, setTabInventory] = useState<string>('') // '' = 전체

  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<ItemForm>(emptyForm)
  const [busy, setBusy] = useState(false)

  const [showImport, setShowImport] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importInventoryId, setImportInventoryId] = useState<number | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  const fetchItems = useCallback(async () => {
    const params = new URLSearchParams({ includeInactive: 'true' })
    if (search.trim()) params.set('search', search.trim())
    if (filterCategory) params.set('categoryId', filterCategory)
    if (tabInventory) params.set('inventoryId', tabInventory)
    const res = await fetch(`/api/inventory/items?${params.toString()}`)
    if (res.ok) setItems((await res.json()).items)
    setLoading(false)
  }, [search, filterCategory, tabInventory])

  async function fetchMeta() {
    const [cRes, dRes, mRes, iRes] = await Promise.all([
      fetch('/api/settings/item-category'),
      fetch('/api/settings/devices'),
      fetch('/api/settings/manufacturers'),
      fetch('/api/settings/inventories'),
    ])
    if (cRes.ok) setCategories((await cRes.json()).categories)
    if (dRes.ok) setDevices((await dRes.json()).devices)
    if (mRes.ok) setManufacturers((await mRes.json()).statusCodes)
    if (iRes.ok) setInventories((await iRes.json()).inventories)
  }

  async function fetchMe() {
    const res = await fetch('/api/auth/me')
    if (res.ok) {
      const data = await res.json()
      setUserRole(data.role ?? null)
      if (data.role !== 'SUPER_ADMIN' && data.role !== 'ADMIN') router.push('/inventory')
    }
  }

  useEffect(() => { fetchMe(); fetchMeta() }, [])
  useEffect(() => { fetchItems() }, [fetchItems])

  function showError(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 5000)
  }
  function showInfo(msg: string) {
    setInfo(msg)
    setTimeout(() => setInfo(null), 5000)
  }

  const roots = categories.filter((c) => c.parentId === null)
  const childrenOf = (id: number | null) => (id == null ? [] : categories.filter((c) => c.parentId === id))

  const activeInventories = inventories.filter((i) => i.isActive)

  function openAdd() {
    setEditId(null)
    // 현재 탭 인벤토리가 기본 선택
    setForm({ ...emptyForm, inventoryId: tabInventory ? parseInt(tabInventory) : (activeInventories[0]?.id ?? null) })
    setShowForm(true)
  }

  function openEdit(item: Item) {
    const [c1, c2, c3] = categoryChain(categories, item.category?.id ?? null)
    setEditId(item.id)
    setForm({
      inventoryId: item.inventoryId,
      name: item.name,
      modelName: item.modelName ?? '',
      cat1: c1, cat2: c2, cat3: c3,
      manufacturerId: item.manufacturer?.id ?? null,
      spec: item.spec ?? '',
      unit: item.unit,
      isSerialManaged: item.isSerialManaged,
      isLotManaged: item.isLotManaged,
      deviceInfoId: item.deviceInfo?.id ?? null,
      refPrice: item.refPrice != null ? String(item.refPrice) : '',
      memo: item.memo ?? '',
      isActive: item.isActive,
    })
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    if (!editId && !form.inventoryId) { showError('인벤토리를 선택해주세요.'); return }
    setBusy(true)
    const categoryId = form.cat3 ?? form.cat2 ?? form.cat1 // 가장 깊은 선택 노드
    const payload = {
      inventoryId: form.inventoryId, // 등록 시에만 사용 (수정 시 서버에서 무시)
      name: form.name.trim(),
      modelName: form.modelName.trim() || null,
      categoryId,
      manufacturerId: form.manufacturerId,
      spec: form.spec,
      unit: form.unit,
      isSerialManaged: form.isSerialManaged,
      isLotManaged: form.isLotManaged,
      deviceInfoId: form.deviceInfoId,
      refPrice: form.refPrice.trim() ? parseInt(form.refPrice) : null,
      memo: form.memo,
      isActive: form.isActive,
    }
    const url = editId ? `/api/inventory/items/${editId}` : '/api/inventory/items'
    const res = await fetch(url, {
      method: editId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      router.refresh()
      await fetchItems()
      setShowForm(false)
    } else {
      showError((await res.json()).error ?? '저장에 실패했습니다.')
    }
    setBusy(false)
  }

  async function handleDelete(item: Item) {
    if (!confirm(`'${item.name}' 품목을 삭제하시겠습니까?`)) return
    setBusy(true)
    const res = await fetch(`/api/inventory/items/${item.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (res.ok) {
      router.refresh()
      await fetchItems()
      if (data.deactivated) showInfo(data.message)
    } else {
      showError(data.error ?? '삭제에 실패했습니다.')
    }
    setBusy(false)
  }

  async function handlePreview() {
    if (!importFile || !importInventoryId) return
    setImportBusy(true)
    setImportMsg(null)
    const fd = new FormData()
    fd.append('file', importFile)
    fd.append('inventoryId', String(importInventoryId))
    const res = await fetch('/api/inventory/items/import?preview=true', { method: 'POST', body: fd })
    const data = await res.json()
    if (res.ok) setPreview(data)
    else setImportMsg(data.error ?? '미리보기에 실패했습니다.')
    setImportBusy(false)
  }

  async function handleImport() {
    if (!importFile || !importInventoryId) return
    setImportBusy(true)
    const fd = new FormData()
    fd.append('file', importFile)
    fd.append('inventoryId', String(importInventoryId))
    const res = await fetch('/api/inventory/items/import', { method: 'POST', body: fd })
    const data = await res.json()
    if (res.ok) {
      setImportMsg(`${data.imported}건 등록 완료 (중복 ${data.skipped}건 건너뜀)`)
      setPreview(null)
      setImportFile(null)
      router.refresh()
      await fetchItems()
    } else {
      setImportMsg(data.error ?? '가져오기에 실패했습니다.')
    }
    setImportBusy(false)
  }

  if (loading && items.length === 0) return <div className="p-8 text-sm text-gray-500">로딩 중...</div>
  if (userRole && userRole !== 'SUPER_ADMIN' && userRole !== 'ADMIN') return null

  const selectCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">품목 관리</h1>
          <p className="mt-1 text-sm text-gray-500">자재 품목 마스터를 관리합니다.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowImport(true); setPreview(null); setImportFile(null); setImportMsg(null); setImportInventoryId(tabInventory ? parseInt(tabInventory) : null) }}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Excel 가져오기
          </button>
          <button
            onClick={openAdd}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            + 품목 추가
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {info && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{info}</div>}

      {/* 인벤토리 탭 — 품목은 인벤토리별 독립 관리 */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-gray-200">
        <button onClick={() => setTabInventory('')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tabInventory === '' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          전체
        </button>
        {activeInventories.map((inv) => (
          <button key={inv.id} onClick={() => setTabInventory(String(inv.id))}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tabInventory === String(inv.id) ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {inv.name}
          </button>
        ))}
      </div>

      {/* 필터 */}
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="품목명·모델명·코드·규격 검색"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">전체 분류</option>
          {roots.map((r1) => (
            <optgroup key={r1.id} label={r1.name}>
              <option value={r1.id}>{r1.name} 전체</option>
              {childrenOf(r1.id).map((r2) => (
                <option key={r2.id} value={r2.id}>└ {r2.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              <th className="px-2 py-2.5">코드</th>
              <th className="px-2 py-2.5">인벤토리</th>
              <th className="px-2 py-2.5">분류</th>
              <th className="px-2 py-2.5">품목명</th>
              <th className="px-2 py-2.5">모델명</th>
              <th className="px-2 py-2.5">제조사</th>
              <th className="px-2 py-2.5">규격</th>
              <th className="px-2 py-2.5">단위</th>
              <th className="px-2 py-2.5 text-center">시리얼</th>
              <th className="px-2 py-2.5">비고</th>
              <th className="px-2 py-2.5 text-right">참고단가</th>
              <th className="px-2 py-2.5 text-center">활성</th>
              <th className="px-2 py-2.5 text-right">관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((item) => (
              <tr key={item.id} className={`hover:bg-gray-50 ${!item.isActive ? 'opacity-50' : ''}`}>
                <td className="px-2 py-2 font-mono text-xs text-gray-500">{item.itemCode}</td>
                <td className="px-2 py-2 text-xs">
                  <span className="rounded bg-blue-50 px-1.5 py-0.5 font-medium text-blue-700">{item.inventory?.name ?? '-'}</span>
                </td>
                <td className="px-2 py-2 text-xs text-gray-600 max-w-[130px] truncate" title={item.categoryPath}>{item.categoryPath || '-'}</td>
                <td className="px-2 py-2 font-medium text-gray-900 max-w-[200px] truncate" title={item.name}>
                  {item.name}
                  {item.deviceInfo && <span className="ml-1 text-xs text-gray-400">({item.deviceInfo.deviceModel})</span>}
                </td>
                <td className="px-2 py-2 text-gray-600 text-xs max-w-[120px] truncate" title={item.modelName ?? ''}>{item.modelName ?? '-'}</td>
                <td className="px-2 py-2 text-gray-600 text-xs max-w-[90px] truncate" title={item.manufacturer?.name ?? ''}>{item.manufacturer?.name ?? '-'}</td>
                <td className="px-2 py-2 text-gray-600 text-xs max-w-[100px] truncate" title={item.spec ?? ''}>{item.spec || '-'}</td>
                <td className="px-2 py-2 text-gray-600 text-xs">{item.unit}</td>
                <td className="px-2 py-2 text-center">
                  {item.isSerialManaged || item.isLotManaged
                    ? <span className="inline-flex items-center gap-0.5">{item.isSerialManaged && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-600">S/N</span>}{item.isLotManaged && <span className="rounded bg-teal-50 px-1.5 py-0.5 text-xs font-medium text-teal-600">LOT</span>}</span>
                    : <span className="text-gray-300">-</span>}
                </td>
                <td className="px-2 py-2 text-gray-500 text-xs max-w-[120px] truncate" title={item.memo ?? ''}>{item.memo || '-'}</td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-600 text-xs">{item.refPrice != null ? item.refPrice.toLocaleString() : '-'}</td>
                <td className="px-2 py-2 text-center">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${item.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {item.isActive ? '활성' : '비활성'}
                  </span>
                </td>
                <td className="px-2 py-2 text-right">
                  <div className="flex justify-end gap-1.5">
                    <button onClick={() => openEdit(item)} disabled={busy} className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50">수정</button>
                    <button onClick={() => handleDelete(item)} disabled={busy} className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-500 hover:bg-red-50 disabled:opacity-50">삭제</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <div className="py-12 text-center text-sm text-gray-500">등록된 품목이 없습니다.</div>}
      </div>

      {/* 품목 추가/수정 모달 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false) }}>
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 sticky top-0 bg-white">
              <h2 className="text-base font-semibold text-gray-900">{editId ? '품목 수정' : '품목 추가'}</h2>
              <button onClick={() => setShowForm(false)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">인벤토리 <span className="text-red-500">*</span>{editId && <span className="ml-1 text-gray-400">(변경 불가)</span>}</label>
                <select value={form.inventoryId ?? ''} disabled={!!editId}
                  onChange={(e) => setForm((f) => ({ ...f, inventoryId: e.target.value ? parseInt(e.target.value) : null }))}
                  className={selectCls + ' disabled:bg-gray-50 disabled:text-gray-500'}>
                  <option value="">선택하세요</option>
                  {activeInventories.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                {!editId && <p className="mt-1 text-xs text-gray-400">품목은 인벤토리별로 독립 관리됩니다. 같은 물건도 인벤토리마다 따로 등록하세요.</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">품목명 <span className="text-red-500">*</span></label>
                <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus className={selectCls} placeholder="예: 게이트웨이" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">모델명</label>
                <input type="text" value={form.modelName} onChange={(e) => setForm((f) => ({ ...f, modelName: e.target.value }))} className={selectCls} placeholder="예: MC200M-T" />
              </div>

              {/* 대/중/소분류 연동 select */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">분류 (대 &gt; 중 &gt; 소)</label>
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={form.cat1 ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, cat1: e.target.value ? parseInt(e.target.value) : null, cat2: null, cat3: null }))}
                    className={selectCls}
                  >
                    <option value="">대분류</option>
                    {roots.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <select
                    value={form.cat2 ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, cat2: e.target.value ? parseInt(e.target.value) : null, cat3: null }))}
                    disabled={!form.cat1 || childrenOf(form.cat1).length === 0}
                    className={selectCls + ' disabled:bg-gray-50 disabled:text-gray-400'}
                  >
                    <option value="">중분류</option>
                    {childrenOf(form.cat1).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <select
                    value={form.cat3 ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, cat3: e.target.value ? parseInt(e.target.value) : null }))}
                    disabled={!form.cat2 || childrenOf(form.cat2).length === 0}
                    className={selectCls + ' disabled:bg-gray-50 disabled:text-gray-400'}
                  >
                    <option value="">소분류</option>
                    {childrenOf(form.cat2).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">제조사</label>
                  <select value={form.manufacturerId ?? ''} onChange={(e) => setForm((f) => ({ ...f, manufacturerId: e.target.value ? parseInt(e.target.value) : null }))} className={selectCls}>
                    <option value="">-</option>
                    {manufacturers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">단위</label>
                  <input type="text" value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} className={selectCls} placeholder="EA" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">규격</label>
                <input type="text" value={form.spec} onChange={(e) => setForm((f) => ({ ...f, spec: e.target.value }))} className={selectCls} placeholder="예: Cat.6 UTP 305m" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">연결 장비 (자사 기기)</label>
                <select value={form.deviceInfoId ?? ''} onChange={(e) => setForm((f) => ({ ...f, deviceInfoId: e.target.value ? parseInt(e.target.value) : null }))} className={selectCls}>
                  <option value="">연결 안 함</option>
                  {devices.map((d) => <option key={d.id} value={d.id}>{d.deviceModel} · {d.deviceName}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">참고 단가 (원)</label>
                <input type="number" value={form.refPrice} onChange={(e) => setForm((f) => ({ ...f, refPrice: e.target.value }))} className={selectCls} placeholder="선택" />
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={form.isSerialManaged} onChange={(e) => setForm((f) => ({ ...f, isSerialManaged: e.target.checked }))} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  시리얼(개체) 관리
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={form.isLotManaged} onChange={(e) => setForm((f) => ({ ...f, isLotManaged: e.target.checked }))} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  LOT 관리
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  활성
                </label>
              </div>
              {editId && <p className="text-xs text-gray-400">시리얼 관리 여부는 입출고 이력이 생기면 변경할 수 없습니다. LOT 관리는 이력이 있어도 변경 가능 — 기존 재고·전표의 LOT는 빈 값으로 남고 이후 입출고부터 적용됩니다. (시리얼+LOT: 신규 입고 시 LOT 필수, 비시리얼+LOT: 전표에 선택 기록)</p>}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">비고</label>
                <textarea value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} rows={2} className={selectCls} />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4 sticky bottom-0 bg-white">
              <button onClick={() => setShowForm(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">취소</button>
              <button onClick={handleSave} disabled={busy || !form.name.trim() || (!editId && !form.inventoryId)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{editId ? '저장' : '추가'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Excel 가져오기 모달 */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) setShowImport(false) }}>
          <div className="w-full max-w-xl rounded-xl bg-white shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-base font-semibold text-gray-900">품목 Excel 가져오기</h2>
              <button onClick={() => setShowImport(false)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <p className="text-xs text-gray-500">
                컬럼 순서: <b>품목명 · 모델명 · 대분류 · 중분류 · 소분류 · 제조사 · 규격 · 단위 · 시리얼여부 · 참고단가 · LOT여부</b> (1행은 헤더).
                분류·제조사는 등록된 이름과 일치해야 하며, 매칭 실패 시 미지정으로 등록됩니다.
                시리얼여부·LOT여부는 &apos;Y/예/시리얼&apos; 등이면 활성 (LOT은 시리얼 품목만 유효). 선택한 인벤토리에 이미 있는 품목명은 건너뜁니다.
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">가져올 인벤토리 <span className="text-red-500">*</span></label>
                <select value={importInventoryId ?? ''} onChange={(e) => { setImportInventoryId(e.target.value ? parseInt(e.target.value) : null); setPreview(null) }} className={selectCls}>
                  <option value="">선택하세요</option>
                  {activeInventories.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => { setImportFile(e.target.files?.[0] ?? null); setPreview(null); setImportMsg(null) }}
                className="w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
              />

              {importMsg && <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{importMsg}</div>}

              {preview && (
                <div className="rounded-lg border border-gray-200 p-3 text-sm">
                  <div className="mb-2 text-gray-700">
                    총 <b>{preview.total}</b>건 · 신규 <b className="text-blue-600">{preview.newCount}</b>건 · 중복 스킵 <b className="text-gray-500">{preview.skipped}</b>건
                  </div>
                  {preview.unknownCategories.length > 0 && (
                    <div className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
                      미등록 분류 경로(분류 없이 등록됨): {preview.unknownCategories.join(', ')}
                    </div>
                  )}
                  {preview.unknownManufacturers.length > 0 && (
                    <div className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
                      미등록 제조사(제조사 없이 등록됨): {preview.unknownManufacturers.join(', ')}
                    </div>
                  )}
                  <div className="max-h-48 overflow-y-auto rounded border border-gray-100">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-500">
                        <tr><th className="px-2 py-1 text-left">품목명</th><th className="px-2 py-1 text-left">모델명</th><th className="px-2 py-1 text-left">분류</th><th className="px-2 py-1 text-left">제조사</th><th className="px-2 py-1 text-left">단위</th><th className="px-2 py-1 text-center">S/N</th><th className="px-2 py-1 text-center">LOT</th></tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {preview.rows.slice(0, 100).map((r, i) => (
                          <tr key={i}>
                            <td className="px-2 py-1">{r.name}</td>
                            <td className="px-2 py-1 text-gray-500">{r.modelName ?? '-'}</td>
                            <td className="px-2 py-1 text-gray-500">{r.categoryPath ?? '-'}</td>
                            <td className="px-2 py-1 text-gray-500">{r.manufacturer ?? '-'}</td>
                            <td className="px-2 py-1 text-gray-500">{r.unit}</td>
                            <td className="px-2 py-1 text-center">{r.isSerialManaged ? '✓' : ''}</td>
                            <td className="px-2 py-1 text-center">{r.isLotManaged ? '✓' : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
              {!preview ? (
                <button onClick={handlePreview} disabled={!importFile || !importInventoryId || importBusy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{importBusy ? '분석 중...' : '미리보기'}</button>
              ) : (
                <button onClick={handleImport} disabled={importBusy || preview.newCount === 0} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{importBusy ? '등록 중...' : `${preview.newCount}건 등록`}</button>
              )}
              <button onClick={() => setShowImport(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
