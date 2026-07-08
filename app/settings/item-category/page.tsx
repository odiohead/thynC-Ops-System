'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Category {
  id: number
  name: string
  parentId: number | null
  sortOrder: number
  itemCount: number
  childCount: number
}

/** DFS 순서 + 깊이 계산 */
function flattenTree(categories: Category[]): { node: Category; depth: number }[] {
  const byParent = new Map<number | null, Category[]>()
  for (const c of categories) {
    const key = c.parentId
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(c)
  }
  for (const list of Array.from(byParent.values())) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
  }
  const out: { node: Category; depth: number }[] = []
  function walk(parentId: number | null, depth: number) {
    for (const c of byParent.get(parentId) ?? []) {
      out.push({ node: c, depth })
      walk(c.id, depth + 1)
    }
  }
  walk(null, 1)
  return out
}

const DEPTH_LABEL = ['', '대', '중', '소']
const MAX_DEPTH = 3

export default function ItemCategorySettingsPage() {
  const router = useRouter()
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [editId, setEditId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')

  // 추가 대상: parentId (null=대분류 추가)
  const [addParentId, setAddParentId] = useState<number | null | 'none'>('none')
  const [addName, setAddName] = useState('')

  const fetchCategories = useCallback(async () => {
    const res = await fetch('/api/settings/item-category')
    if (res.ok) setCategories((await res.json()).categories)
    setLoading(false)
  }, [])

  useEffect(() => { fetchCategories() }, [fetchCategories])

  function showError(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 5000)
  }

  async function handleAdd() {
    if (!addName.trim() || addParentId === 'none') return
    setBusy(true)
    const siblings = categories.filter((c) => c.parentId === addParentId)
    const nextOrder = siblings.length > 0 ? Math.max(...siblings.map((s) => s.sortOrder)) + 1 : 0
    const res = await fetch('/api/settings/item-category', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: addName.trim(), parentId: addParentId, sortOrder: nextOrder }),
    })
    if (res.ok) {
      router.refresh()
      await fetchCategories()
      setAddParentId('none')
      setAddName('')
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleSaveEdit(cat: Category) {
    if (!editName.trim()) return
    setBusy(true)
    const res = await fetch(`/api/settings/item-category/${cat.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName.trim(), sortOrder: cat.sortOrder }),
    })
    if (res.ok) {
      router.refresh()
      await fetchCategories()
      setEditId(null)
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleDelete(cat: Category) {
    if (!confirm(`'${cat.name}' 분류를 삭제하시겠습니까?`)) return
    setBusy(true)
    const res = await fetch(`/api/settings/item-category/${cat.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.refresh()
      await fetchCategories()
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleMove(cat: Category, direction: 'up' | 'down') {
    const siblings = categories
      .filter((c) => c.parentId === cat.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    const idx = siblings.findIndex((s) => s.id === cat.id)
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= siblings.length) return
    const target = siblings[targetIdx]
    setBusy(true)
    await Promise.all([
      fetch(`/api/settings/item-category/${cat.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cat.name, sortOrder: target.sortOrder }),
      }),
      fetch(`/api/settings/item-category/${target.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: target.name, sortOrder: cat.sortOrder }),
      }),
    ])
    router.refresh()
    await fetchCategories()
    setBusy(false)
  }

  const flat = flattenTree(categories)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">

        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">품목 분류 관리</h1>
            <p className="mt-1 text-sm text-gray-500">대 &gt; 중 &gt; 소 최대 3단계 계층 분류. 품목은 어느 단계에나 연결할 수 있습니다.</p>
          </div>
          {addParentId === 'none' && (
            <button
              type="button"
              onClick={() => { setAddParentId(null); setAddName(''); setEditId(null) }}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              + 대분류 추가
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">분류</th>
                <th className="w-20 px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">단계</th>
                <th className="w-20 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">품목 수</th>
                <th className="w-64 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr><td colSpan={4} className="py-12 text-center text-sm text-gray-400">불러오는 중...</td></tr>
              ) : flat.length === 0 && addParentId === 'none' ? (
                <tr><td colSpan={4} className="py-12 text-center text-sm text-gray-400">등록된 분류가 없습니다.</td></tr>
              ) : (
                flat.map(({ node, depth }) => (
                  <tr key={node.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2" style={{ paddingLeft: (depth - 1) * 24 }}>
                        {depth > 1 && <span className="text-gray-300">└</span>}
                        <div className="flex flex-col">
                          <button onClick={() => handleMove(node, 'up')} disabled={busy} className="rounded px-0.5 text-gray-300 hover:text-gray-600" title="위로">
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
                          </button>
                          <button onClick={() => handleMove(node, 'down')} disabled={busy} className="rounded px-0.5 text-gray-300 hover:text-gray-600" title="아래로">
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                          </button>
                        </div>
                        {editId === node.id ? (
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit(node)
                              if (e.key === 'Escape') setEditId(null)
                            }}
                            autoFocus
                            className="rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        ) : (
                          <span className={`text-sm ${depth === 1 ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{node.name}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{DEPTH_LABEL[depth]}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm tabular-nums text-gray-500">{node.itemCount || '-'}</td>
                    <td className="px-4 py-2.5 text-right">
                      {editId === node.id ? (
                        <div className="flex justify-end gap-2">
                          <button onClick={() => handleSaveEdit(node)} disabled={busy} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">저장</button>
                          <button onClick={() => setEditId(null)} className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100">취소</button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          {depth < MAX_DEPTH && (
                            <button
                              onClick={() => { setAddParentId(node.id); setAddName(''); setEditId(null) }}
                              disabled={busy}
                              className="rounded-md border border-blue-200 px-3 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                            >
                              + 하위
                            </button>
                          )}
                          <button
                            onClick={() => { setEditId(node.id); setEditName(node.name); setAddParentId('none') }}
                            disabled={busy}
                            className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                          >
                            수정
                          </button>
                          <button onClick={() => handleDelete(node)} disabled={busy} className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-500 hover:bg-red-50 disabled:opacity-50">삭제</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* 추가 입력 행 */}
          {addParentId !== 'none' && (
            <div className="border-t border-gray-200 bg-blue-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">
                  {addParentId === null
                    ? '새 대분류:'
                    : `'${categories.find((c) => c.id === addParentId)?.name}' 하위 분류:`}
                </span>
                <input
                  type="text"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAdd()
                    if (e.key === 'Escape') { setAddParentId('none'); setAddName('') }
                  }}
                  placeholder="분류명 입력"
                  autoFocus
                  className="rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button onClick={handleAdd} disabled={busy || !addName.trim()} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">추가</button>
                <button onClick={() => { setAddParentId('none'); setAddName('') }} className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100">취소</button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
