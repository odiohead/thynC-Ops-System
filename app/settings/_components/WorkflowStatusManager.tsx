'use client'

/**
 * 워크플로 상태코드 관리 공용 컴포넌트 (ticket_status_map_design.md §6)
 * 유지보수/기타업무/답사/설치계획 상태 페이지가 공유 — 상태명·색상·순서 + 티켓 상태 매핑.
 * 매핑은 도메인↔티켓 상태 동기화(lib/ticketDomain.ts)의 단일 소스이며,
 * 신규 상태 추가 시 매핑을 강제해 "이름 모르는 상태 → 조용히 접수 처리" 결함을 차단한다.
 */

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import ColorPicker from '@/app/components/ColorPicker'
import { TICKET_STATUS_LABELS, TICKET_STATUS_COLORS, MAPPABLE_TICKET_STATUSES } from '@/lib/ticket-shared'

interface StatusCode {
  id: number
  name: string
  order: number
  color: string | null
  ticketStatus: string | null
  ticketPendingReasonId: number | null
}

interface PendingReason {
  id: number
  name: string
  isActive: boolean
}

// 매핑 선택지는 5종 — ASSIGNED는 OPEN 계열에서 owner 유무로 엔진이 자동 판정
const MAPPABLE = MAPPABLE_TICKET_STATUSES
// 역방향(티켓 → 도메인) 도달 가능 버킷 — 하나도 매핑이 없으면 경고
const REVERSE_BUCKETS: Array<{ key: string; statuses: string[]; label: string }> = [
  { key: 'OPEN', statuses: ['OPEN'], label: 'Open/Assigned' },
  { key: 'IN_PROGRESS', statuses: ['IN_PROGRESS'], label: 'In Progress' },
  { key: 'PENDING', statuses: ['PENDING'], label: 'Pending' },
  { key: 'CLOSED', statuses: ['RESOLVED', 'CLOSED'], label: 'Resolved/Closed' },
]

function ColorPreview({ color }: { color: string | null }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-block h-4 w-4 rounded-full border border-gray-200 shrink-0"
        style={{ backgroundColor: color ?? '#E5E7EB' }}
      />
      {!color && <span className="text-xs text-gray-400">색상 없음</span>}
    </div>
  )
}

function TicketStatusCell({ sc, reasons }: { sc: StatusCode; reasons: PendingReason[] }) {
  if (!sc.ticketStatus) {
    return (
      <span
        className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
        title="티켓 상태 매핑이 지정되지 않아 코드 기본 규칙(이름 매칭)으로 동작합니다. 수정에서 매핑을 지정하세요."
      >
        매핑 미지정
      </span>
    )
  }
  const label = TICKET_STATUS_LABELS[sc.ticketStatus as keyof typeof TICKET_STATUS_LABELS] ?? sc.ticketStatus
  const color = TICKET_STATUS_COLORS[sc.ticketStatus as keyof typeof TICKET_STATUS_COLORS] ?? 'bg-gray-100 text-gray-600'
  const reasonName = sc.ticketStatus === 'PENDING' && sc.ticketPendingReasonId
    ? reasons.find((r) => r.id === sc.ticketPendingReasonId)?.name
    : null
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{label}</span>
      {reasonName && <span className="text-xs text-gray-400">· {reasonName}</span>}
    </span>
  )
}

function MappingSelects({
  ticketStatus, pendingReasonId, reasons, onStatusChange, onReasonChange,
}: {
  ticketStatus: string
  pendingReasonId: number | ''
  reasons: PendingReason[]
  onStatusChange: (v: string) => void
  onReasonChange: (v: number | '') => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <select
        value={ticketStatus}
        onChange={(e) => onStatusChange(e.target.value)}
        className="rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="">티켓 상태 선택</option>
        {MAPPABLE.map((s) => (
          <option key={s} value={s}>{TICKET_STATUS_LABELS[s]}</option>
        ))}
      </select>
      {ticketStatus === 'PENDING' && (
        <select
          value={pendingReasonId}
          onChange={(e) => onReasonChange(e.target.value ? Number(e.target.value) : '')}
          className="rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">대기 사유 (기본: 기타)</option>
          {reasons.filter((r) => r.isActive).map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      )}
    </div>
  )
}

export default function WorkflowStatusManager({
  apiPath, title, description, entityLabel,
}: {
  apiPath: string       // 예: '/api/settings/maintenance-status'
  title: string         // 예: '유지보수 상태 관리'
  description: string
  entityLabel: string   // 예: '유지보수 상태'
}) {
  const router = useRouter()
  const [statuses, setStatuses] = useState<StatusCode[]>([])
  const [reasons, setReasons] = useState<PendingReason[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editId, setEditId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [editTicketStatus, setEditTicketStatus] = useState('')
  const [editReasonId, setEditReasonId] = useState<number | ''>('')

  const [isAdding, setIsAdding] = useState(false)
  const [addName, setAddName] = useState('')
  const [addColor, setAddColor] = useState('')
  const [addTicketStatus, setAddTicketStatus] = useState('')
  const [addReasonId, setAddReasonId] = useState<number | ''>('')

  const [busy, setBusy] = useState(false)

  const fetchStatuses = useCallback(async () => {
    const res = await fetch(apiPath)
    const data = await res.json()
    setStatuses(data.statusCodes)
    setLoading(false)
  }, [apiPath])

  useEffect(() => {
    fetchStatuses()
    fetch('/api/settings/ticket-pending-reasons')
      .then((r) => (r.ok ? r.json() : { reasons: [] }))
      .then((d) => setReasons(d.reasons ?? []))
      .catch(() => {})
  }, [fetchStatuses])

  function showError(msg: string) {
    setError(msg)
    setTimeout(() => setError(null), 4000)
  }

  // 역방향 도달 버킷 중 매핑이 비는 곳 경고
  const missingBuckets = REVERSE_BUCKETS.filter(
    (b) => !statuses.some((s) => s.ticketStatus && b.statuses.includes(s.ticketStatus))
  )

  async function handleSaveEdit(sc: StatusCode) {
    if (!editName.trim()) return
    if (!editTicketStatus) { showError('티켓 상태 매핑을 선택해주세요.'); return }
    setBusy(true)
    const res = await fetch(`${apiPath}/${sc.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editName.trim(),
        order: sc.order,
        color: editColor || null,
        ticketStatus: editTicketStatus,
        ticketPendingReasonId: editTicketStatus === 'PENDING' && editReasonId ? editReasonId : null,
      }),
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

  async function handleDelete(sc: StatusCode) {
    if (!confirm(`'${sc.name}' ${entityLabel}를 삭제하시겠습니까?`)) return
    setBusy(true)
    const res = await fetch(`${apiPath}/${sc.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.refresh()
      await fetchStatuses()
    } else {
      showError((await res.json()).error)
    }
    setBusy(false)
  }

  async function handleAdd() {
    if (!addName.trim()) return
    if (!addTicketStatus) { showError('티켓 상태 매핑을 선택해주세요.'); return }
    setBusy(true)
    const nextOrder = statuses.length > 0 ? Math.max(...statuses.map((s) => s.order)) + 1 : 1
    const res = await fetch(apiPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: addName.trim(),
        order: nextOrder,
        color: addColor || null,
        ticketStatus: addTicketStatus,
        ticketPendingReasonId: addTicketStatus === 'PENDING' && addReasonId ? addReasonId : null,
      }),
    })
    if (res.ok) {
      router.refresh()
      await fetchStatuses()
      setIsAdding(false)
      setAddName('')
      setAddColor('')
      setAddTicketStatus('')
      setAddReasonId('')
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
      fetch(`${apiPath}/${current.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: current.name, order: target.order, color: current.color }),
      }),
      fetch(`${apiPath}/${target.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: target.name, order: current.order, color: target.color }),
      }),
    ])

    router.refresh()
    await fetchStatuses()
    setBusy(false)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">

        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
            <p className="mt-1 text-sm text-gray-500">{description}</p>
          </div>
          {!isAdding && (
            <button
              type="button"
              onClick={() => { setIsAdding(true); setEditId(null) }}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              + 상태 추가
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && missingBuckets.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            티켓 상태 {missingBuckets.map((b) => b.label).join(', ')}에 매핑된 {entityLabel}가 없습니다.
            티켓에서 해당 상태로 전이해도 업무 상태는 바뀌지 않습니다.
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
                  <span title="이 상태가 소속되는 티켓 상태 — 업무↔티켓 상태 동기화의 기준">티켓 상태</span>
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-sm text-gray-400">불러오는 중...</td>
                </tr>
              ) : statuses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-sm text-gray-400">등록된 {entityLabel}가 없습니다.</td>
                </tr>
              ) : (
                statuses.map((sc, index) => (
                  <tr key={sc.id} className="hover:bg-gray-50">
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
                            disabled={index === statuses.length - 1 || busy}
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
                      {editId === sc.id ? (
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(sc)
                            if (e.key === 'Escape') setEditId(null)
                          }}
                          autoFocus
                          className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      ) : (
                        <span className="text-sm font-medium text-gray-900">{sc.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editId === sc.id ? (
                        <ColorPicker value={editColor} onChange={setEditColor} />
                      ) : (
                        <ColorPreview color={sc.color} />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editId === sc.id ? (
                        <MappingSelects
                          ticketStatus={editTicketStatus}
                          pendingReasonId={editReasonId}
                          reasons={reasons}
                          onStatusChange={(v) => { setEditTicketStatus(v); if (v !== 'PENDING') setEditReasonId('') }}
                          onReasonChange={setEditReasonId}
                        />
                      ) : (
                        <TicketStatusCell sc={sc} reasons={reasons} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editId === sc.id ? (
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleSaveEdit(sc)}
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
                              setEditId(sc.id)
                              setEditName(sc.name)
                              setEditColor(sc.color ?? '')
                              setEditTicketStatus(sc.ticketStatus ?? '')
                              setEditReasonId(sc.ticketPendingReasonId ?? '')
                              setIsAdding(false)
                            }}
                            disabled={busy}
                            className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50"
                          >
                            수정
                          </button>
                          <button
                            onClick={() => handleDelete(sc)}
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

              {isAdding && (
                <tr className="bg-blue-50">
                  <td className="px-4 py-3 text-sm text-gray-400">{statuses.length + 1}</td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={addName}
                      onChange={(e) => setAddName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAdd()
                        if (e.key === 'Escape') { setIsAdding(false); setAddName(''); setAddColor(''); setAddTicketStatus(''); setAddReasonId('') }
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
                    <MappingSelects
                      ticketStatus={addTicketStatus}
                      pendingReasonId={addReasonId}
                      reasons={reasons}
                      onStatusChange={(v) => { setAddTicketStatus(v); if (v !== 'PENDING') setAddReasonId('') }}
                      onReasonChange={setAddReasonId}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={handleAdd}
                        disabled={busy || !addName.trim() || !addTicketStatus}
                        className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                      >
                        추가
                      </button>
                      <button
                        onClick={() => { setIsAdding(false); setAddName(''); setAddColor(''); setAddTicketStatus(''); setAddReasonId('') }}
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

        <p className="mt-3 text-xs text-gray-400">
          티켓 상태 매핑은 업무↔티켓 상태 동기화의 기준입니다. Open 계열은 담당자가 있으면 Assigned로 자동 판정되며,
          변경은 이후 저장·전이부터 적용됩니다 (기존 티켓 비소급).
        </p>

      </div>
    </div>
  )
}
