'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Inventory {
  id: number
  name: string
  isActive: boolean
}

interface Warehouse {
  id: number
  name: string
  inventoryId: number
  memo: string | null
  isActive: boolean
  sortOrder: number
  createdAt: string
}

interface EditForm {
  name: string
  memo: string
  sortOrder: number
  isActive: boolean
}

const emptyForm: EditForm = { name: '', memo: '', sortOrder: 0, isActive: true }

/**
 * 창고(위치) 관리 — 위치는 인벤토리에 귀속. 인벤토리별 섹션에서 독립적으로 추가/수정/삭제.
 */
export default function WarehousesSettingsPage() {
  const router = useRouter()
  const [inventories, setInventories] = useState<Inventory[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editId, setEditId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<EditForm>(emptyForm)

  const [addingInv, setAddingInv] = useState<number | null>(null) // 추가 폼이 열린 인벤토리
  const [addForm, setAddForm] = useState<EditForm>(emptyForm)

  const [busy, setBusy] = useState(false)

  async function fetchAll() {
    const [wRes, iRes] = await Promise.all([
      fetch('/api/settings/warehouses'),
      fetch('/api/settings/inventories'),
    ])
    if (wRes.ok) setWarehouses((await wRes.json()).warehouses)
    if (iRes.ok) setInventories((await iRes.json()).inventories)
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [])

  function showError(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 4000)
  }

  async function handleSaveEdit(wh: Warehouse) {
    if (!editForm.name.trim()) return
    setBusy(true)
    const res = await fetch(`/api/settings/warehouses/${wh.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    })
    if (res.ok) {
      router.refresh()
      await fetchAll()
      setEditId(null)
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleDelete(wh: Warehouse) {
    if (!confirm(`'${wh.name}' 위치를 삭제하시겠습니까?`)) return
    setBusy(true)
    const res = await fetch(`/api/settings/warehouses/${wh.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.refresh()
      await fetchAll()
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleAdd(inventoryId: number, list: Warehouse[]) {
    if (!addForm.name.trim()) return
    setBusy(true)
    const nextOrder = list.length > 0 ? Math.max(...list.map((w) => w.sortOrder)) + 1 : 0
    const res = await fetch('/api/settings/warehouses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...addForm, inventoryId, sortOrder: nextOrder }),
    })
    if (res.ok) {
      router.refresh()
      await fetchAll()
      setAddingInv(null)
      setAddForm(emptyForm)
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleMove(list: Warehouse[], index: number, direction: 'up' | 'down') {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= list.length) return

    const current = list[index]
    const target = list[targetIndex]
    setBusy(true)

    await Promise.all([
      fetch(`/api/settings/warehouses/${current.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: current.name, memo: current.memo, isActive: current.isActive, sortOrder: target.sortOrder }),
      }),
      fetch(`/api/settings/warehouses/${target.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: target.name, memo: target.memo, isActive: target.isActive, sortOrder: current.sortOrder }),
      }),
    ])

    router.refresh()
    await fetchAll()
    setBusy(false)
  }

  const activeInventories = inventories.filter((i) => i.isActive)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">창고(위치) 관리</h1>
          <p className="mt-1 text-sm text-gray-500">
            자재를 보관하는 위치(창고)를 <b>인벤토리별로 독립</b> 관리합니다. 불량품 보관은 별도 위치로 표현하세요.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400">불러오는 중...</div>
        ) : (
          <div className="space-y-8">
            {activeInventories.map((inv) => {
              const list = warehouses
                .filter((w) => w.inventoryId === inv.id)
                .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
              return (
                <section key={inv.id}>
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-base font-semibold text-gray-900">
                      {inv.name} <span className="ml-1 text-xs font-normal text-gray-400">위치 {list.length}곳</span>
                    </h2>
                    {addingInv !== inv.id && (
                      <button
                        type="button"
                        onClick={() => { setAddingInv(inv.id); setAddForm(emptyForm); setEditId(null) }}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                      >
                        + 위치 추가
                      </button>
                    )}
                  </div>

                  <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="w-16 px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">순서</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">위치명</th>
                          <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 sm:table-cell">메모</th>
                          <th className="hidden px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500 md:table-cell">활성</th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">관리</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {list.length === 0 && addingInv !== inv.id ? (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-sm text-gray-400">등록된 위치가 없습니다.</td>
                          </tr>
                        ) : (
                          list.map((wh, index) => (
                            <tr key={wh.id} className={`hover:bg-gray-50 ${!wh.isActive ? 'opacity-50' : ''}`}>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1">
                                  <span className="w-6 text-sm tabular-nums text-gray-500">{index + 1}</span>
                                  <div className="flex flex-col">
                                    <button
                                      onClick={() => handleMove(list, index, 'up')}
                                      disabled={index === 0 || busy}
                                      className="rounded px-0.5 text-gray-400 transition-colors hover:text-gray-700 disabled:opacity-30"
                                      title="위로"
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="18 15 12 9 6 15" />
                                      </svg>
                                    </button>
                                    <button
                                      onClick={() => handleMove(list, index, 'down')}
                                      disabled={index === list.length - 1 || busy}
                                      className="rounded px-0.5 text-gray-400 transition-colors hover:text-gray-700 disabled:opacity-30"
                                      title="아래로"
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="6 9 12 15 18 9" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                {editId === wh.id ? (
                                  <input
                                    type="text"
                                    value={editForm.name}
                                    onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                                    autoFocus
                                    className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    placeholder="예: 본사 창고"
                                  />
                                ) : (
                                  <span className="text-sm font-medium text-gray-900">{wh.name}</span>
                                )}
                              </td>
                              <td className="hidden px-4 py-3 sm:table-cell">
                                {editId === wh.id ? (
                                  <input
                                    type="text"
                                    value={editForm.memo}
                                    onChange={(e) => setEditForm((f) => ({ ...f, memo: e.target.value }))}
                                    className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    placeholder="메모 (선택)"
                                  />
                                ) : (
                                  <span className="text-sm text-gray-500">{wh.memo || '-'}</span>
                                )}
                              </td>
                              <td className="hidden px-4 py-3 text-center md:table-cell">
                                {editId === wh.id ? (
                                  <input
                                    type="checkbox"
                                    checked={editForm.isActive}
                                    onChange={(e) => setEditForm((f) => ({ ...f, isActive: e.target.checked }))}
                                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                  />
                                ) : (
                                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                    wh.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                                  }`}>
                                    {wh.isActive ? '활성' : '비활성'}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {editId === wh.id ? (
                                  <div className="flex justify-end gap-2">
                                    <button
                                      onClick={() => handleSaveEdit(wh)}
                                      disabled={busy || !editForm.name.trim()}
                                      className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                                    >
                                      저장
                                    </button>
                                    <button
                                      onClick={() => setEditId(null)}
                                      className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                                    >
                                      취소
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex justify-end gap-2">
                                    <button
                                      onClick={() => {
                                        setEditId(wh.id)
                                        setEditForm({ name: wh.name, memo: wh.memo ?? '', sortOrder: wh.sortOrder, isActive: wh.isActive })
                                        setAddingInv(null)
                                      }}
                                      disabled={busy}
                                      className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50"
                                    >
                                      수정
                                    </button>
                                    <button
                                      onClick={() => handleDelete(wh)}
                                      disabled={busy}
                                      className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
                                    >
                                      삭제
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))
                        )}

                        {addingInv === inv.id && (
                          <tr className="bg-blue-50">
                            <td className="px-4 py-3 text-sm text-gray-400">{list.length + 1}</td>
                            <td className="px-4 py-3">
                              <input
                                type="text"
                                value={addForm.name}
                                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                                placeholder="위치명 (예: 본사 창고)"
                                autoFocus
                                className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </td>
                            <td className="hidden px-4 py-3 sm:table-cell">
                              <input
                                type="text"
                                value={addForm.memo}
                                onChange={(e) => setAddForm((f) => ({ ...f, memo: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleAdd(inv.id, list)
                                  if (e.key === 'Escape') { setAddingInv(null); setAddForm(emptyForm) }
                                }}
                                placeholder="메모 (선택)"
                                className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </td>
                            <td className="hidden px-4 py-3 text-center md:table-cell">
                              <input
                                type="checkbox"
                                checked={addForm.isActive}
                                onChange={(e) => setAddForm((f) => ({ ...f, isActive: e.target.checked }))}
                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => handleAdd(inv.id, list)}
                                  disabled={busy || !addForm.name.trim()}
                                  className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                                >
                                  추가
                                </button>
                                <button
                                  onClick={() => { setAddingInv(null); setAddForm(emptyForm) }}
                                  className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                                >
                                  취소
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              )
            })}
          </div>
        )}

      </div>
    </div>
  )
}
