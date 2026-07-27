'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ColorPicker from '@/app/components/ColorPicker'
import { TICKET_STATUS_LABELS, TICKET_STATUS_COLORS, MAPPABLE_TICKET_STATUSES } from '@/lib/ticket-shared'

interface BuildStatus {
  id: number
  label: string
  color: string | null
  sortOrder: number
  usageCount: number
  ticketStatus: string | null
}

// 역방향(티켓 → 프로젝트) 도달 가능 버킷 — 하나도 매핑이 없으면 경고
const REVERSE_BUCKETS: Array<{ statuses: string[]; label: string }> = [
  { statuses: ['OPEN'], label: 'Open/Assigned' },
  { statuses: ['IN_PROGRESS'], label: 'In Progress' },
  { statuses: ['PENDING'], label: 'Pending' },
  { statuses: ['RESOLVED', 'CLOSED'], label: 'Resolved/Closed' },
]

function TicketStatusBadge({ ticketStatus }: { ticketStatus: string | null }) {
  if (!ticketStatus) {
    return (
      <span
        className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
        title="티켓 상태 매핑이 지정되지 않아 코드 기본 규칙(라벨 문자열 매칭)으로 동작합니다. 수정에서 매핑을 지정하세요."
      >
        매핑 미지정
      </span>
    )
  }
  const label = TICKET_STATUS_LABELS[ticketStatus as keyof typeof TICKET_STATUS_LABELS] ?? ticketStatus
  const color = TICKET_STATUS_COLORS[ticketStatus as keyof typeof TICKET_STATUS_COLORS] ?? 'bg-gray-100 text-gray-600'
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{label}</span>
}

function ColorPreview({ color }: { color: string | null }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-block h-4 w-4 shrink-0 rounded-full border border-gray-200"
        style={{ backgroundColor: color ?? '#E5E7EB' }}
      />
      {!color && <span className="text-xs text-gray-400">색상 없음</span>}
    </div>
  )
}

export default function BuildStatusSettingsPage() {
  const router = useRouter()
  const [statuses, setStatuses] = useState<BuildStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editId, setEditId] = useState<number | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editColor, setEditColor] = useState('')
  const [editTicketStatus, setEditTicketStatus] = useState('')

  const [isAdding, setIsAdding] = useState(false)
  const [addLabel, setAddLabel] = useState('')
  const [addColor, setAddColor] = useState('')
  const [addTicketStatus, setAddTicketStatus] = useState('')

  const [busy, setBusy] = useState(false)

  async function fetchStatuses() {
    const res = await fetch('/api/settings/build-status')
    const data = await res.json()
    setStatuses(data.buildStatuses)
    setLoading(false)
  }

  useEffect(() => { fetchStatuses() }, [])

  function showError(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 4000)
  }

  async function handleSaveEdit(bs: BuildStatus) {
    if (!editLabel.trim()) return
    if (!editTicketStatus) { showError('티켓 상태 매핑을 선택해주세요.'); return }
    setBusy(true)
    const res = await fetch(`/api/settings/build-status/${bs.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: editLabel.trim(), color: editColor || null, sortOrder: bs.sortOrder, ticketStatus: editTicketStatus }),
    })
    if (res.ok) {
      router.refresh()
      await fetchStatuses()
      setEditId(null)
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleDelete(bs: BuildStatus) {
    if (!confirm(`'${bs.label}' 구축상태를 삭제하시겠습니까?`)) return
    setBusy(true)
    const res = await fetch(`/api/settings/build-status/${bs.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.refresh()
      await fetchStatuses()
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleAdd() {
    if (!addLabel.trim()) return
    if (!addTicketStatus) { showError('티켓 상태 매핑을 선택해주세요.'); return }
    setBusy(true)
    const nextOrder = statuses.length > 0 ? Math.max(...statuses.map((s) => s.sortOrder)) + 1 : 1
    const res = await fetch('/api/settings/build-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: addLabel.trim(), color: addColor || null, sortOrder: nextOrder, ticketStatus: addTicketStatus }),
    })
    if (res.ok) {
      router.refresh()
      await fetchStatuses()
      setIsAdding(false)
      setAddLabel('')
      setAddColor('')
      setAddTicketStatus('')
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleMove(index: number, direction: 'up' | 'down') {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= statuses.length) return
    const current = statuses[index]
    const target = statuses[targetIndex]
    setBusy(true)
    await Promise.all([
      fetch(`/api/settings/build-status/${current.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: current.label, color: current.color, sortOrder: target.sortOrder }),
      }),
      fetch(`/api/settings/build-status/${target.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: target.label, color: target.color, sortOrder: current.sortOrder }),
      }),
    ])
    router.refresh()
    await fetchStatuses()
    setBusy(false)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">구축상태 관리</h1>
            <p className="mt-1 text-sm text-gray-500">프로젝트에 적용되는 구축상태와 표시 색상을 관리합니다.</p>
          </div>
          {!isAdding && (
            <button
              type="button"
              onClick={() => { setIsAdding(true); setEditId(null) }}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              + 구축상태 추가
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && REVERSE_BUCKETS.some((b) => !statuses.some((s) => s.ticketStatus && b.statuses.includes(s.ticketStatus))) && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            티켓 상태 {REVERSE_BUCKETS.filter((b) => !statuses.some((s) => s.ticketStatus && b.statuses.includes(s.ticketStatus))).map((b) => b.label).join(', ')}에 매핑된 구축상태가 없습니다.
            티켓에서 해당 상태로 전이해도 프로젝트 구축상태는 바뀌지 않습니다.
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-16 px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">순서</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">상태명</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">색상</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <span title="이 상태가 소속되는 티켓 상태 — 프로젝트↔티켓 상태 동기화의 기준">티켓 상태</span>
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr><td colSpan={5} className="py-12 text-center text-sm text-gray-400">불러오는 중...</td></tr>
              ) : statuses.length === 0 ? (
                <tr><td colSpan={5} className="py-12 text-center text-sm text-gray-400">등록된 구축상태가 없습니다.</td></tr>
              ) : (
                statuses.map((bs, index) => (
                  <tr key={bs.id} className="hover:bg-gray-50">
                    {/* 순서 */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className="w-6 text-sm tabular-nums text-gray-500">{index + 1}</span>
                        <div className="flex flex-col">
                          <button onClick={() => handleMove(index, 'up')} disabled={index === 0 || busy}
                            className="rounded px-0.5 text-gray-400 transition-colors hover:text-gray-700 disabled:opacity-30" title="위로">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
                          </button>
                          <button onClick={() => handleMove(index, 'down')} disabled={index === statuses.length - 1 || busy}
                            className="rounded px-0.5 text-gray-400 transition-colors hover:text-gray-700 disabled:opacity-30" title="아래로">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                          </button>
                        </div>
                      </div>
                    </td>

                    {/* 상태명 */}
                    <td className="px-4 py-3">
                      {editId === bs.id ? (
                        <input
                          type="text"
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(bs)
                            if (e.key === 'Escape') setEditId(null)
                          }}
                          autoFocus
                          className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      ) : (
                        <span className="text-sm font-medium text-gray-900">{bs.label}</span>
                      )}
                    </td>

                    {/* 색상 */}
                    <td className="px-4 py-3">
                      {editId === bs.id ? (
                        <ColorPicker value={editColor} onChange={setEditColor} />
                      ) : (
                        <ColorPreview color={bs.color} />
                      )}
                    </td>

                    {/* 티켓 상태 매핑 */}
                    <td className="px-4 py-3">
                      {editId === bs.id ? (
                        <select
                          value={editTicketStatus}
                          onChange={(e) => setEditTicketStatus(e.target.value)}
                          className="rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="">티켓 상태 선택</option>
                          {MAPPABLE_TICKET_STATUSES.map((ts) => (
                            <option key={ts} value={ts}>{TICKET_STATUS_LABELS[ts]}</option>
                          ))}
                        </select>
                      ) : (
                        <TicketStatusBadge ticketStatus={bs.ticketStatus} />
                      )}
                    </td>

                    {/* 액션 */}
                    <td className="px-4 py-3 text-right">
                      {editId === bs.id ? (
                        <div className="flex justify-end gap-2">
                          <button onClick={() => handleSaveEdit(bs)} disabled={busy}
                            className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50">
                            저장
                          </button>
                          <button onClick={() => setEditId(null)}
                            className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100">
                            취소
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => { setEditId(bs.id); setEditLabel(bs.label); setEditColor(bs.color ?? ''); setEditTicketStatus(bs.ticketStatus ?? ''); setIsAdding(false) }}
                            disabled={busy}
                            className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50">
                            수정
                          </button>
                          <button onClick={() => handleDelete(bs)} disabled={busy}
                            className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50">
                            삭제
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}

              {/* 추가 행 */}
              {isAdding && (
                <tr className="bg-blue-50">
                  <td className="px-4 py-3 text-sm text-gray-400">{statuses.length + 1}</td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={addLabel}
                      onChange={(e) => setAddLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAdd()
                        if (e.key === 'Escape') { setIsAdding(false); setAddLabel(''); setAddColor(''); setAddTicketStatus('') }
                      }}
                      placeholder="상태명 입력"
                      autoFocus
                      className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <ColorPicker value={addColor} onChange={setAddColor} />
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={addTicketStatus}
                      onChange={(e) => setAddTicketStatus(e.target.value)}
                      className="rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">티켓 상태 선택</option>
                      {MAPPABLE_TICKET_STATUSES.map((ts) => (
                        <option key={ts} value={ts}>{TICKET_STATUS_LABELS[ts]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={handleAdd} disabled={busy || !addLabel.trim() || !addTicketStatus}
                        className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50">
                        추가
                      </button>
                      <button onClick={() => { setIsAdding(false); setAddLabel(''); setAddColor(''); setAddTicketStatus('') }}
                        className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100">
                        취소
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-gray-400">
          티켓 상태 매핑은 프로젝트↔티켓 상태 동기화의 기준입니다. Open 계열은 담당자가 있으면 Assigned로 자동 판정되며,
          변경은 이후 저장·전이부터 적용됩니다 (기존 티켓 비소급).
        </p>

      </div>
    </div>
  )
}
