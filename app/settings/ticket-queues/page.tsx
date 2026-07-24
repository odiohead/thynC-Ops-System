'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface QueueMember {
  id: number
  userId: string
  user: { id: string; name: string }
}

interface Queue {
  id: number
  name: string
  description: string | null
  isActive: boolean
  sortOrder: number
  members: QueueMember[]
  _count: { tickets: number }
}

interface AppUser {
  id: string
  name: string
  email: string
  isActive: boolean
}

export default function TicketQueuesSettingsPage() {
  const router = useRouter()
  const [queues, setQueues] = useState<Queue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editId, setEditId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')

  const [isAdding, setIsAdding] = useState(false)
  const [addName, setAddName] = useState('')
  const [addDescription, setAddDescription] = useState('')

  const [busy, setBusy] = useState(false)

  // 멤버 관리 모달
  const [users, setUsers] = useState<AppUser[]>([])
  const [memberQueue, setMemberQueue] = useState<Queue | null>(null)
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [memberSearch, setMemberSearch] = useState('')

  async function fetchQueues() {
    const res = await fetch('/api/settings/ticket-queues')
    const data = await res.json()
    setQueues(data.queues ?? [])
    setLoading(false)
  }

  useEffect(() => {
    fetchQueues()
    fetch('/api/users')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setUsers((Array.isArray(d) ? d : []).filter((u: AppUser) => u.isActive)))
  }, [])

  function openMemberModal(q: Queue) {
    setMemberQueue(q)
    setMemberIds(q.members.map((m) => m.userId))
    setMemberSearch('')
  }

  async function handleSaveMembers() {
    if (!memberQueue) return
    setBusy(true)
    const res = await fetch(`/api/settings/ticket-queues/${memberQueue.id}/members`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: memberIds }),
    })
    if (res.ok) {
      router.refresh()
      await fetchQueues()
      setMemberQueue(null)
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  function showError(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 4000)
  }

  async function handleSaveEdit(q: Queue) {
    if (!editName.trim()) return
    setBusy(true)
    const res = await fetch(`/api/settings/ticket-queues/${q.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName.trim(), description: editDescription.trim() || null }),
    })
    if (res.ok) {
      router.refresh()
      await fetchQueues()
      setEditId(null)
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleToggleActive(q: Queue) {
    setBusy(true)
    const res = await fetch(`/api/settings/ticket-queues/${q.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !q.isActive }),
    })
    if (res.ok) {
      router.refresh()
      await fetchQueues()
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleDelete(q: Queue) {
    if (!confirm(`'${q.name}' 큐를 삭제하시겠습니까?`)) return
    setBusy(true)
    const res = await fetch(`/api/settings/ticket-queues/${q.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.refresh()
      await fetchQueues()
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleAdd() {
    if (!addName.trim()) return
    setBusy(true)
    const nextOrder = queues.length > 0 ? Math.max(...queues.map((q) => q.sortOrder)) + 1 : 1
    const res = await fetch('/api/settings/ticket-queues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: addName.trim(), description: addDescription.trim() || null, sortOrder: nextOrder }),
    })
    if (res.ok) {
      router.refresh()
      await fetchQueues()
      setIsAdding(false)
      setAddName('')
      setAddDescription('')
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleMove(index: number, direction: 'up' | 'down') {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= queues.length) return

    const current = queues[index]
    const target = queues[targetIndex]
    setBusy(true)

    await Promise.all([
      fetch(`/api/settings/ticket-queues/${current.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sortOrder: target.sortOrder }),
      }),
      fetch(`/api/settings/ticket-queues/${target.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sortOrder: current.sortOrder }),
      }),
    ])

    router.refresh()
    await fetchQueues()
    setBusy(false)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">

        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">티켓 큐 관리</h1>
            <p className="mt-1 text-sm text-gray-500">티켓이 배정되는 처리 그룹(큐)을 관리합니다.</p>
          </div>
          {!isAdding && (
            <button
              type="button"
              onClick={() => { setIsAdding(true); setEditId(null) }}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              + 큐 추가
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-16 px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Sort</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Description</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Members</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Active</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Tickets</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-gray-400">불러오는 중...</td>
                </tr>
              ) : queues.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-gray-400">등록된 큐가 없습니다.</td>
                </tr>
              ) : (
                queues.map((q, index) => (
                  <tr key={q.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className="w-6 text-sm tabular-nums text-gray-500">{index + 1}</span>
                        <div className="flex flex-col">
                          <button
                            onClick={() => handleMove(index, 'up')}
                            disabled={index === 0 || busy}
                            className="rounded px-0.5 text-gray-400 transition-colors hover:text-gray-700 disabled:opacity-30"
                            title="위로"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="18 15 12 9 6 15" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleMove(index, 'down')}
                            disabled={index === queues.length - 1 || busy}
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
                      {editId === q.id ? (
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(q)
                            if (e.key === 'Escape') setEditId(null)
                          }}
                          autoFocus
                          className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      ) : (
                        <span className={`text-sm font-medium ${q.isActive ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{q.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editId === q.id ? (
                        <input
                          type="text"
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(q)
                            if (e.key === 'Escape') setEditId(null)
                          }}
                          placeholder="설명 (선택)"
                          className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      ) : (
                        <span className="text-sm text-gray-500">{q.description || '-'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        {q.members.length === 0 ? (
                          <span className="text-xs text-gray-400">없음</span>
                        ) : (
                          q.members.map((m) => (
                            <span key={m.id} className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                              {m.user.name}
                            </span>
                          ))
                        )}
                        <button
                          type="button"
                          onClick={() => openMemberModal(q)}
                          disabled={busy}
                          className="rounded-md border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-50"
                        >
                          멤버 관리
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(q)}
                        disabled={busy}
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                          q.isActive ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                        title="클릭하여 활성/비활성 전환"
                      >
                        {q.isActive ? '활성' : '비활성'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm tabular-nums text-gray-700">{q._count.tickets.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      {editId === q.id ? (
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleSaveEdit(q)}
                            disabled={busy}
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
                              setEditId(q.id)
                              setEditName(q.name)
                              setEditDescription(q.description ?? '')
                              setIsAdding(false)
                            }}
                            disabled={busy}
                            className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50"
                          >
                            수정
                          </button>
                          <button
                            onClick={() => handleDelete(q)}
                            disabled={busy || q._count.tickets > 0}
                            title={q._count.tickets > 0 ? '티켓이 있는 큐는 삭제할 수 없습니다. 비활성화하거나 티켓을 이관하세요.' : undefined}
                            className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}

              {isAdding && (
                <tr className="bg-blue-50">
                  <td className="px-4 py-3 text-sm text-gray-400">{queues.length + 1}</td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={addName}
                      onChange={(e) => setAddName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAdd()
                        if (e.key === 'Escape') { setIsAdding(false); setAddName(''); setAddDescription('') }
                      }}
                      placeholder="큐 이름 입력"
                      autoFocus
                      className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={addDescription}
                      onChange={(e) => setAddDescription(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAdd()
                        if (e.key === 'Escape') { setIsAdding(false); setAddName(''); setAddDescription('') }
                      }}
                      placeholder="설명 (선택)"
                      className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">-</td>
                  <td className="px-4 py-3 text-xs text-gray-400">활성</td>
                  <td className="px-4 py-3 text-sm text-gray-400">0</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={handleAdd}
                        disabled={busy || !addName.trim()}
                        className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                      >
                        추가
                      </button>
                      <button
                        onClick={() => { setIsAdding(false); setAddName(''); setAddDescription('') }}
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

        {/* 멤버 관리 모달 */}
        {memberQueue && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setMemberQueue(null)}>
            <div className="flex max-h-[80dvh] w-full max-w-md flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                <h2 className="text-base font-semibold text-gray-900">
                  큐 멤버 관리 <span className="ml-1 text-sm font-normal text-gray-400">— {memberQueue.name}</span>
                </h2>
                <button
                  type="button"
                  onClick={() => setMemberQueue(null)}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                >
                  ✕
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <input
                  type="text"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="이름 또는 이메일로 검색..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="mt-2 text-xs text-gray-400">선택 {memberIds.length}명 — 이 큐의 담당자 셀렉트에서 상단 그룹으로 우선 표시됩니다.</p>
                <ul className="mt-2 divide-y divide-gray-100">
                  {users
                    .filter((u) => {
                      const s = memberSearch.trim().toLowerCase()
                      if (!s) return true
                      return u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s)
                    })
                    .map((u) => (
                      <li key={u.id}>
                        <label className="flex cursor-pointer items-center gap-3 px-1 py-2 hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={memberIds.includes(u.id)}
                            onChange={() =>
                              setMemberIds((prev) =>
                                prev.includes(u.id) ? prev.filter((id) => id !== u.id) : [...prev, u.id]
                              )
                            }
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-900">{u.name}</span>
                          <span className="text-xs text-gray-400">{u.email}</span>
                        </label>
                      </li>
                    ))}
                  {users.length === 0 && (
                    <li className="py-6 text-center text-sm text-gray-400">활성 사용자가 없습니다.</li>
                  )}
                </ul>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4">
                <button
                  type="button"
                  onClick={() => setMemberQueue(null)}
                  disabled={busy}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleSaveMembers}
                  disabled={busy}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
