'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'

interface CtiNode {
  id: number
  parentId: number | null
  level: number
  name: string
  isActive: boolean
  sortOrder: number
  defaultQueue: { id: number; name: string } | null
  _count: { tickets: number; children: number }
}

interface Queue {
  id: number
  name: string
  isActive: boolean
}

const LEVEL_TITLES: Record<number, string> = { 1: 'Category (L1)', 2: 'Type (L2)', 3: 'Item (L3)' }

export default function TicketCtiSettingsPage() {
  const router = useRouter()
  const [nodes, setNodes] = useState<CtiNode[]>([])
  const [queues, setQueues] = useState<Queue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [selL1, setSelL1] = useState<number | null>(null)
  const [selL2, setSelL2] = useState<number | null>(null)

  const [editId, setEditId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [addNames, setAddNames] = useState<Record<number, string>>({ 1: '', 2: '', 3: '' })

  async function fetchNodes() {
    const res = await fetch('/api/settings/ticket-cti')
    const data = await res.json()
    setNodes(data.nodes ?? [])
    setLoading(false)
  }

  useEffect(() => {
    fetchNodes()
    fetch('/api/settings/ticket-queues')
      .then((r) => (r.ok ? r.json() : { queues: [] }))
      .then((d) => setQueues((d.queues ?? []).filter((q: Queue) => q.isActive)))
  }, [])

  // 선택된 노드가 삭제된 경우 선택 해제
  useEffect(() => {
    if (selL1 != null && !nodes.some((n) => n.id === selL1)) setSelL1(null)
    if (selL2 != null && !nodes.some((n) => n.id === selL2)) setSelL2(null)
  }, [nodes, selL1, selL2])

  const l1Nodes = useMemo(() => nodes.filter((n) => n.level === 1), [nodes])
  const l2Nodes = useMemo(() => nodes.filter((n) => n.level === 2 && n.parentId === selL1), [nodes, selL1])
  const l3Nodes = useMemo(() => nodes.filter((n) => n.level === 3 && n.parentId === selL2), [nodes, selL2])

  function showError(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 4000)
  }

  async function refresh() {
    router.refresh()
    await fetchNodes()
  }

  async function handleAdd(level: number, parentId: number | null) {
    const name = (addNames[level] ?? '').trim()
    if (!name) return
    setBusy(true)
    const res = await fetch('/api/settings/ticket-cti', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ...(parentId != null ? { parentId } : {}) }),
    })
    if (res.ok) {
      setAddNames((prev) => ({ ...prev, [level]: '' }))
      await refresh()
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleRename(node: CtiNode) {
    if (!editName.trim()) return
    setBusy(true)
    const res = await fetch(`/api/settings/ticket-cti/${node.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName.trim() }),
    })
    if (res.ok) {
      setEditId(null)
      await refresh()
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleToggleActive(node: CtiNode) {
    setBusy(true)
    const res = await fetch(`/api/settings/ticket-cti/${node.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !node.isActive }),
    })
    if (res.ok) await refresh()
    else showError((await res.json()).error)
    setBusy(false)
  }

  async function handleDelete(node: CtiNode) {
    if (!confirm(`'${node.name}' 분류를 삭제하시겠습니까?`)) return
    setBusy(true)
    const res = await fetch(`/api/settings/ticket-cti/${node.id}`, { method: 'DELETE' })
    if (res.ok) await refresh()
    else showError((await res.json()).error)
    setBusy(false)
  }

  async function handleSetDefaultQueue(node: CtiNode, value: string) {
    setBusy(true)
    const res = await fetch(`/api/settings/ticket-cti/${node.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultQueueId: value ? Number(value) : null }),
    })
    if (res.ok) await refresh()
    else showError((await res.json()).error)
    setBusy(false)
  }

  function renderColumn(
    level: number,
    columnNodes: CtiNode[],
    parentId: number | null,
    parentSelected: boolean,
    selectedId: number | null,
    onSelect: ((id: number) => void) | null,
  ) {
    return (
      <div className="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-gray-500">
            {LEVEL_TITLES[level]} <span className="ml-1 font-normal normal-case text-gray-400">{parentSelected ? `${columnNodes.length}개` : ''}</span>
          </h2>
        </div>

        <div className="min-h-[16rem] flex-1 divide-y divide-gray-100">
          {!parentSelected ? (
            <p className="px-4 py-10 text-center text-sm text-gray-400">
              {level === 2 ? '좌측에서 Category를 선택하세요.' : 'Type을 선택하세요.'}
            </p>
          ) : loading ? (
            <p className="px-4 py-10 text-center text-sm text-gray-400">불러오는 중...</p>
          ) : columnNodes.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-gray-400">등록된 분류가 없습니다.</p>
          ) : (
            columnNodes.map((node) => (
              <div
                key={node.id}
                className={`px-3 py-2.5 ${selectedId === node.id ? 'bg-blue-50' : 'hover:bg-gray-50'} ${onSelect ? 'cursor-pointer' : ''}`}
                onClick={onSelect ? () => onSelect(node.id) : undefined}
              >
                <div className="flex items-center justify-between gap-2">
                  {editId === node.id ? (
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(node)
                        if (e.key === 'Escape') setEditId(null)
                      }}
                      autoFocus
                      className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  ) : (
                    <span className={`min-w-0 truncate text-sm font-medium ${node.isActive ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                      {node.name}
                      {level < 3 && node._count.children > 0 && (
                        <span className="ml-1.5 text-xs font-normal text-gray-400">({node._count.children})</span>
                      )}
                      {node._count.tickets > 0 && (
                        <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-normal text-gray-500">티켓 {node._count.tickets}</span>
                      )}
                    </span>
                  )}
                  <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {editId === node.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleRename(node)}
                          disabled={busy}
                          className="rounded-md bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          저장
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditId(null)}
                          className="rounded-md border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100"
                        >
                          취소
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => { setEditId(node.id); setEditName(node.name) }}
                          disabled={busy}
                          className="rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleActive(node)}
                          disabled={busy}
                          className={`rounded px-1.5 py-0.5 text-xs disabled:opacity-50 ${
                            node.isActive ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'
                          }`}
                          title="활성/비활성 전환"
                        >
                          {node.isActive ? '활성' : '비활성'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(node)}
                          disabled={busy || node._count.children > 0 || node._count.tickets > 0}
                          title={node._count.children > 0 || node._count.tickets > 0 ? '하위 분류 또는 연결된 티켓이 있어 삭제할 수 없습니다. 비활성화하세요.' : undefined}
                          className="rounded px-1.5 py-0.5 text-xs text-red-300 hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          삭제
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Item(L3)에만 기본 큐 지정 */}
                {level === 3 && (
                  <div className="mt-1.5 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <span className="shrink-0 text-xs text-gray-400">Default Queue</span>
                    <select
                      value={node.defaultQueue ? String(node.defaultQueue.id) : ''}
                      onChange={(e) => handleSetDefaultQueue(node, e.target.value)}
                      disabled={busy}
                      className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                    >
                      <option value="">지정 안 함</option>
                      {queues.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* 추가 */}
        {parentSelected && (
          <div className="flex gap-2 border-t border-gray-200 bg-gray-50/50 px-3 py-2.5">
            <input
              type="text"
              value={addNames[level] ?? ''}
              onChange={(e) => setAddNames((prev) => ({ ...prev, [level]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(level, parentId) }}
              placeholder="분류명 입력"
              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => handleAdd(level, parentId)}
              disabled={busy || !(addNames[level] ?? '').trim()}
              className="shrink-0 rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              추가
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">티켓 분류(CTI) 관리</h1>
          <p className="mt-1 text-sm text-gray-500">
            Category → Type → Item 3단 분류를 관리합니다. Item에 기본 큐를 지정하면 티켓 생성 시 해당 큐로 자동 배정됩니다.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {renderColumn(1, l1Nodes, null, true, selL1, (id) => { setSelL1(id); setSelL2(null) })}
          {renderColumn(2, l2Nodes, selL1, selL1 != null, selL2, (id) => setSelL2(id))}
          {renderColumn(3, l3Nodes, selL2, selL2 != null, null, null)}
        </div>

      </div>
    </div>
  )
}
