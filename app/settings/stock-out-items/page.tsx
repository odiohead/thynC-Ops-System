'use client'

/**
 * 출고 품목 관리 (stock_out_request_design.md §4.1 — ADMIN 이상)
 * 출고업무 전용 품목 마스터 — WMS 품목·기기 관리와 독립. 사용 중 품목은 삭제 대신 비활성.
 */
import { useState, useEffect, useCallback } from 'react'

interface StockOutItemRow {
  id: number
  name: string
  itemGroup: 'SYSTEM' | 'WEARABLE'
  wmsModelName: string | null
  sortOrder: number
  isActive: boolean
  _count?: { requestItems: number }
}

const GROUPS: { value: 'SYSTEM' | 'WEARABLE'; label: string }[] = [
  { value: 'SYSTEM', label: '시스템' },
  { value: 'WEARABLE', label: '웨어러블 디바이스' },
]
const GROUP_LABELS: Record<string, string> = { SYSTEM: '시스템', WEARABLE: '웨어러블 디바이스' }

export default function StockOutItemsSettingsPage() {
  const [items, setItems] = useState<StockOutItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [newName, setNewName] = useState('')
  const [newGroup, setNewGroup] = useState<'SYSTEM' | 'WEARABLE'>('SYSTEM')
  const [newWms, setNewWms] = useState('')
  const [newOrder, setNewOrder] = useState('')

  const [editId, setEditId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editGroup, setEditGroup] = useState<'SYSTEM' | 'WEARABLE'>('SYSTEM')
  const [editWms, setEditWms] = useState('')
  const [editOrder, setEditOrder] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/stock-out-items')
    if (res.ok) {
      const d = await res.json()
      setItems(d.items ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  function flash(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 5000)
  }

  async function create() {
    if (!newName.trim()) return
    setBusy(true)
    const res = await fetch('/api/settings/stock-out-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, itemGroup: newGroup, wmsModelName: newWms || null, sortOrder: newOrder !== '' ? Number(newOrder) : 0 }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? '추가에 실패했습니다.'); return }
    setNewName(''); setNewWms(''); setNewOrder('')
    await load()
  }

  function startEdit(it: StockOutItemRow) {
    setEditId(it.id)
    setEditName(it.name)
    setEditGroup(it.itemGroup)
    setEditWms(it.wmsModelName ?? '')
    setEditOrder(String(it.sortOrder))
  }

  async function saveEdit() {
    if (editId == null) return
    setBusy(true)
    const res = await fetch(`/api/settings/stock-out-items/${editId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName, itemGroup: editGroup, wmsModelName: editWms || null, sortOrder: editOrder !== '' ? Number(editOrder) : 0 }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? '수정에 실패했습니다.'); return }
    setEditId(null)
    await load()
  }

  async function toggleActive(it: StockOutItemRow) {
    setBusy(true)
    const res = await fetch(`/api/settings/stock-out-items/${it.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !it.isActive }),
    })
    setBusy(false)
    if (!res.ok) { flash('변경에 실패했습니다.'); return }
    await load()
  }

  async function remove(it: StockOutItemRow) {
    if (!confirm(`'${it.name}' 품목을 삭제하시겠습니까?`)) return
    setBusy(true)
    const res = await fetch(`/api/settings/stock-out-items/${it.id}`, { method: 'DELETE' })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { flash(d.error ?? '삭제에 실패했습니다.'); return }
    await load()
  }

  const input = 'rounded-md border border-gray-300 px-2.5 py-1.5 text-sm'

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="text-xl font-bold text-gray-900">출고 품목 관리</h1>
      <p className="mt-0.5 text-sm text-gray-500">
        출고업무(출고요청)에서 선택하는 품목 목록입니다. 사용 이력이 있는 품목은 삭제 대신 비활성으로 전환하세요.
      </p>

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      {/* 추가 */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
        <select value={newGroup} onChange={(e) => setNewGroup(e.target.value as 'SYSTEM' | 'WEARABLE')} className={input}>
          {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
        <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="품목명" className={`${input} w-44`} />
        <input type="text" value={newWms} onChange={(e) => setNewWms(e.target.value)} placeholder="WMS 모델명 (출고 처리 매핑)" className={`${input} w-48 font-mono`} />
        <input type="number" value={newOrder} onChange={(e) => setNewOrder(e.target.value)} placeholder="순서" className={`${input} w-20`} />
        <button type="button" onClick={create} disabled={busy || !newName.trim()} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">+ 추가</button>
      </div>

      {/* 목록 */}
      <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <p className="py-12 text-center text-sm text-gray-400">불러오는 중...</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['그룹', '품목명', 'WMS 모델명', '순서', '사용', '활성', ''].map((h, i) => (
                  <th key={i} className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((it) => (
                <tr key={it.id} className={it.isActive ? '' : 'bg-gray-50 text-gray-400'}>
                  {editId === it.id ? (
                    <>
                      <td className="px-3 py-2">
                        <select value={editGroup} onChange={(e) => setEditGroup(e.target.value as 'SYSTEM' | 'WEARABLE')} className={input}>
                          {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2"><input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className={`${input} w-40`} /></td>
                      <td className="px-3 py-2"><input type="text" value={editWms} onChange={(e) => setEditWms(e.target.value)} placeholder="WMS 모델명" className={`${input} w-36 font-mono`} /></td>
                      <td className="px-3 py-2"><input type="number" value={editOrder} onChange={(e) => setEditOrder(e.target.value)} className={`${input} w-20`} /></td>
                      <td className="px-3 py-2 text-xs">{it._count?.requestItems ?? 0}건</td>
                      <td className="px-3 py-2" colSpan={2}>
                        <div className="flex gap-1.5">
                          <button type="button" onClick={saveEdit} disabled={busy} className="rounded-md bg-blue-600 px-2.5 py-1 text-xs text-white">저장</button>
                          <button type="button" onClick={() => setEditId(null)} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-600">취소</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">{GROUP_LABELS[it.itemGroup]}</td>
                      <td className="px-3 py-2">{it.name}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{it.wmsModelName ?? <span className="text-red-400">미지정</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">{it.sortOrder}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">{it._count?.requestItems ?? 0}건</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <button
                          type="button"
                          onClick={() => toggleActive(it)}
                          disabled={busy}
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${it.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}
                        >
                          {it.isActive ? '활성' : '비활성'}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <div className="flex justify-end gap-1.5">
                          <button type="button" onClick={() => startEdit(it)} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">수정</button>
                          <button type="button" onClick={() => remove(it)} disabled={busy} className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50">삭제</button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
