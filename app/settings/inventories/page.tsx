'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Inventory {
  id: number
  name: string
  isTransferLocked: boolean
  linkHospital: boolean
  memo: string | null
  isActive: boolean
  sortOrder: number
}

/**
 * 인벤토리 관리 (ADMIN 이상) — 대웅제약재고 / 평가용재고 / 판매용재고.
 * 이관 잠금 인벤토리는 TRANSFER 출발·도착 모두 불가 (평가용재고).
 */
export default function InventoriesSettingsPage() {
  const router = useRouter()
  const [inventories, setInventories] = useState<Inventory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [editId, setEditId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')

  const [isAdding, setIsAdding] = useState(false)
  const [addName, setAddName] = useState('')
  const [addLocked, setAddLocked] = useState(false)
  const [addLinkHospital, setAddLinkHospital] = useState(false)

  const fetchAll = useCallback(async () => {
    const res = await fetch('/api/settings/inventories')
    if (res.ok) setInventories((await res.json()).inventories)
    setLoading(false)
  }, [])
  useEffect(() => { fetchAll() }, [fetchAll])

  function showError(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 5000)
  }

  async function patch(inv: Inventory, data: Partial<Inventory>) {
    setBusy(true)
    const res = await fetch(`/api/settings/inventories/${inv.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: inv.name, ...data }),
    })
    if (res.ok) { router.refresh(); await fetchAll(); setEditId(null) }
    else showError((await res.json()).error ?? '저장 실패')
    setBusy(false)
  }

  async function handleAdd() {
    if (!addName.trim()) return
    setBusy(true)
    const nextOrder = inventories.length > 0 ? Math.max(...inventories.map((i) => i.sortOrder)) + 1 : 1
    const res = await fetch('/api/settings/inventories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: addName.trim(), isTransferLocked: addLocked, linkHospital: addLinkHospital, sortOrder: nextOrder }),
    })
    if (res.ok) { router.refresh(); await fetchAll(); setIsAdding(false); setAddName(''); setAddLocked(false); setAddLinkHospital(false) }
    else showError((await res.json()).error ?? '추가 실패')
    setBusy(false)
  }

  async function handleDelete(inv: Inventory) {
    if (!confirm(`'${inv.name}' 인벤토리를 삭제하시겠습니까?`)) return
    setBusy(true)
    const res = await fetch(`/api/settings/inventories/${inv.id}`, { method: 'DELETE' })
    if (res.ok) { router.refresh(); await fetchAll() }
    else showError((await res.json()).error ?? '삭제 실패')
    setBusy(false)
  }

  async function handleMove(index: number, direction: 'up' | 'down') {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= inventories.length) return
    const current = inventories[index]
    const target = inventories[targetIndex]
    setBusy(true)
    await Promise.all([
      fetch(`/api/settings/inventories/${current.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: current.name, sortOrder: target.sortOrder }) }),
      fetch(`/api/settings/inventories/${target.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: target.name, sortOrder: current.sortOrder }) }),
    ])
    router.refresh()
    await fetchAll()
    setBusy(false)
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">인벤토리 관리</h1>
        <p className="mt-1 text-sm text-gray-500">
          재고를 관리하는 인벤토리 목록입니다. 같은 품목도 인벤토리별로 수량·입출고가 독립 관리됩니다.
          <br />
          <b>이관 잠금</b>이 켜진 인벤토리(예: 평가용재고)는 다른 인벤토리와의 이관(TRANSFER)이 출발·도착 모두 차단됩니다.
          <br />
          <b>병원 연결</b>이 켜진 인벤토리(예: 대웅제약재고)에서만 출고 시 병원·업무 연결이 가능합니다.
        </p>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="mb-3 flex justify-end">
        {!isAdding && (
          <button onClick={() => { setIsAdding(true); setEditId(null) }} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">+ 추가</button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="w-16 px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">순서</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">이름</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">이관 잠금</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">병원 연결</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">활성</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={6} className="py-10 text-center text-sm text-gray-400">불러오는 중...</td></tr>
            ) : inventories.length === 0 ? (
              <tr><td colSpan={6} className="py-10 text-center text-sm text-gray-400">등록된 인벤토리가 없습니다.</td></tr>
            ) : inventories.map((inv, index) => (
              <tr key={inv.id} className={`hover:bg-gray-50 ${!inv.isActive ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <span className="w-6 text-sm tabular-nums text-gray-500">{index + 1}</span>
                    <div className="flex flex-col">
                      <button onClick={() => handleMove(index, 'up')} disabled={index === 0 || busy} className="rounded px-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="위로">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
                      </button>
                      <button onClick={() => handleMove(index, 'down')} disabled={index === inventories.length - 1 || busy} className="rounded px-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="아래로">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                      </button>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {editId === inv.id ? (
                    <input
                      type="text" value={editName} autoFocus
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') patch(inv, { name: editName.trim() }); if (e.key === 'Escape') setEditId(null) }}
                      className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  ) : (
                    <span className="text-sm font-medium text-gray-900">{inv.name}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <input type="checkbox" checked={inv.isTransferLocked} disabled={busy}
                    onChange={(e) => patch(inv, { isTransferLocked: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
                </td>
                <td className="px-4 py-3 text-center">
                  <input type="checkbox" checked={inv.linkHospital} disabled={busy}
                    onChange={(e) => patch(inv, { linkHospital: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
                </td>
                <td className="px-4 py-3 text-center">
                  <input type="checkbox" checked={inv.isActive} disabled={busy}
                    onChange={(e) => patch(inv, { isActive: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                </td>
                <td className="px-4 py-3 text-right">
                  {editId === inv.id ? (
                    <div className="flex justify-end gap-2">
                      <button onClick={() => patch(inv, { name: editName.trim() })} disabled={busy} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">저장</button>
                      <button onClick={() => setEditId(null)} className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100">취소</button>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <button onClick={() => { setEditId(inv.id); setEditName(inv.name); setIsAdding(false) }} disabled={busy} className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50">수정</button>
                      <button onClick={() => handleDelete(inv)} disabled={busy} className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-500 hover:bg-red-50 disabled:opacity-50">삭제</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}

            {isAdding && (
              <tr className="bg-blue-50">
                <td className="px-4 py-3 text-sm text-gray-400">{inventories.length + 1}</td>
                <td className="px-4 py-3">
                  <input
                    type="text" value={addName} autoFocus placeholder="예: 임대용재고"
                    onChange={(e) => setAddName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setIsAdding(false); setAddName('') } }}
                    className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <input type="checkbox" checked={addLocked} onChange={(e) => setAddLocked(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
                </td>
                <td className="px-4 py-3 text-center">
                  <input type="checkbox" checked={addLinkHospital} onChange={(e) => setAddLinkHospital(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
                </td>
                <td className="px-4 py-3 text-center text-xs text-gray-400">활성</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <button onClick={handleAdd} disabled={busy || !addName.trim()} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">추가</button>
                    <button onClick={() => { setIsAdding(false); setAddName('') }} className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100">취소</button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-400">사용 중(재고·전표·개체)인 인벤토리는 삭제할 수 없습니다 — 비활성화를 사용하세요.</p>
    </div>
  )
}
