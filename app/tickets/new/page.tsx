'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { TicketStatus, TicketSeverity } from '@prisma/client'
import RichTextEditor from '@/app/components/RichTextEditor'
import OwnerSelect from '../components/OwnerSelect'
import TicketStatusBadge from '../components/TicketStatusBadge'
import { TICKET_SEVERITY_LABELS } from '@/lib/ticket-shared'

interface Hospital {
  hospitalCode: string
  hospitalName: string
  hiraHospitalName: string
}

interface CtiNode {
  id: number
  parentId: number | null
  level: number
  name: string
  isActive: boolean
  defaultQueue: { id: number; name: string } | null
}

interface Queue {
  id: number
  name: string
  isActive: boolean
  members?: { userId: string; user: { id: string; name: string } }[]
}

interface AppUser {
  id: string
  name: string
  email: string
  isActive: boolean
}

interface ParentTicket {
  id: number
  ticketCode: string
  title: string
  status: TicketStatus
}

const ALL_SEVERITIES = Object.keys(TICKET_SEVERITY_LABELS) as TicketSeverity[]

function isEmptyHtml(html: string): boolean {
  return html.replace(/<[^>]*>|&nbsp;/g, '').trim() === ''
}

function NewTicketForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const parentIdParam = searchParams.get('parentId')
  const parentId = parentIdParam && /^\d+$/.test(parentIdParam) ? Number(parentIdParam) : null
  const [parentTicket, setParentTicket] = useState<ParentTicket | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [ctiNodes, setCtiNodes] = useState<CtiNode[]>([])
  const [queues, setQueues] = useState<Queue[]>([])
  const [users, setUsers] = useState<AppUser[]>([])

  const [title, setTitle] = useState('')
  const [l1Id, setL1Id] = useState('')
  const [l2Id, setL2Id] = useState('')
  const [l3Id, setL3Id] = useState('')
  const [queueId, setQueueId] = useState('') // '' = CTI 기본 큐 사용
  const [severity, setSeverity] = useState<TicketSeverity>('SEV4')
  const [ownerId, setOwnerId] = useState('')
  const [participantIds, setParticipantIds] = useState<string[]>([])
  const [descriptionHtml, setDescriptionHtml] = useState('')

  const [hospital, setHospital] = useState<Hospital | null>(null)
  const [hospitalModalOpen, setHospitalModalOpen] = useState(false)
  const [hospitalSearch, setHospitalSearch] = useState('')
  const [hospitalResults, setHospitalResults] = useState<Hospital[]>([])
  const [hospitalSearching, setHospitalSearching] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canWrite = !!role && role !== 'VIEWER'

  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => setRole(d?.role ?? null))
    fetch('/api/settings/ticket-cti')
      .then((r) => (r.ok ? r.json() : { nodes: [] }))
      .then((d) => setCtiNodes((d.nodes ?? []).filter((n: CtiNode) => n.isActive)))
    fetch('/api/settings/ticket-queues')
      .then((r) => (r.ok ? r.json() : { queues: [] }))
      .then((d) => setQueues((d.queues ?? []).filter((q: Queue) => q.isActive)))
    fetch('/api/users')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setUsers((Array.isArray(d) ? d : []).filter((u: AppUser) => u.isActive)))
    if (parentId != null) {
      fetch(`/api/tickets/${parentId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d?.ticket) setParentTicket(d.ticket) })
    }
  }, [parentId])

  const l1Options = useMemo(() => ctiNodes.filter((n) => n.level === 1), [ctiNodes])
  const l2Options = useMemo(() => ctiNodes.filter((n) => n.level === 2 && String(n.parentId) === l1Id), [ctiNodes, l1Id])
  const l3Options = useMemo(() => ctiNodes.filter((n) => n.level === 3 && String(n.parentId) === l2Id), [ctiNodes, l2Id])
  const selectedL3 = useMemo(() => ctiNodes.find((n) => String(n.id) === l3Id) ?? null, [ctiNodes, l3Id])

  const participants = useMemo(
    () => participantIds.map((id) => users.find((u) => u.id === id)).filter((u): u is AppUser => !!u),
    [participantIds, users]
  )

  /** 배정될 큐(수동 지정 > CTI 기본 큐)의 멤버 — 담당자 셀렉트 상단 그룹 */
  const queueMemberIds = useMemo(() => {
    const effectiveQueueId = queueId ? Number(queueId) : selectedL3?.defaultQueue?.id ?? null
    if (effectiveQueueId == null) return []
    const q = queues.find((qu) => qu.id === effectiveQueueId)
    return (q?.members ?? []).map((m) => m.userId)
  }, [queueId, selectedL3, queues])

  async function searchHospitals() {
    if (!hospitalSearch.trim()) return
    setHospitalSearching(true)
    try {
      const res = await fetch(`/api/hospitals?search=${encodeURIComponent(hospitalSearch)}&limit=20`)
      const data = await res.json()
      setHospitalResults(data.hospitals ?? [])
    } finally {
      setHospitalSearching(false)
    }
  }

  function selectHospital(h: Hospital) {
    setHospital(h)
    setHospitalModalOpen(false)
    setHospitalSearch('')
    setHospitalResults([])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('제목을 입력해주세요.'); return }
    if (!l3Id) { setError('분류(CTI)를 최하위(Item)까지 선택해주세요.'); return }
    setBusy(true)
    setError(null)

    const payload = {
      title: title.trim(),
      ctiId: Number(l3Id),
      ...(queueId ? { queueId: Number(queueId) } : {}),
      severity,
      ...(ownerId ? { ownerId } : {}),
      ...(hospital ? { hospitalCode: hospital.hospitalCode } : {}),
      participantIds,
      ...(isEmptyHtml(descriptionHtml) ? {} : { descriptionHtml }),
      ...(parentId != null ? { parentId } : {}),
    }

    const res = await fetch('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (res.ok) {
      const data = await res.json()
      router.refresh()
      router.push(`/tickets/${data.ticket.ticketCode}`)
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? '저장 실패')
      setBusy(false)
    }
  }

  const inputClass = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'
  const selectClass = inputClass
  const rowClass = 'grid grid-cols-1 gap-1.5 px-6 py-4 sm:grid-cols-3 sm:gap-4'
  const labelClass = 'flex items-center text-sm font-medium text-gray-700'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{parentId != null ? '서브 티켓 생성' : '티켓 생성'}</h1>
          <p className="mt-1 text-sm text-gray-500">분류(CTI)를 선택하면 기본 큐로 자동 배정됩니다.</p>
        </div>

        {parentId != null && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
            <span className="font-medium">Master:</span>
            {parentTicket ? (
              <>
                <span className="font-mono text-xs">{parentTicket.ticketCode}</span>
                <span className="min-w-0 truncate">{parentTicket.title}</span>
                <TicketStatusBadge status={parentTicket.status} />
              </>
            ) : (
              <span>#{parentId} (불러오는 중...)</span>
            )}
            <span className="text-xs text-blue-600 dark:text-blue-400">— 이 티켓의 서브로 생성됩니다.</span>
          </div>
        )}

        {role === 'VIEWER' && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            읽기 전용 권한입니다. 티켓을 생성할 수 없습니다.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="divide-y divide-gray-100">

              {/* 제목 */}
              <div className={rowClass}>
                <label className={labelClass}>Title <span className="ml-1 text-red-500">*</span></label>
                <div className="sm:col-span-2">
                  <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder="티켓 제목" />
                </div>
              </div>

              {/* 분류 (CTI) */}
              <div className={rowClass}>
                <label className="flex items-start pt-2 text-sm font-medium text-gray-700">
                  CTI <span className="ml-1 text-red-500">*</span>
                </label>
                <div className="sm:col-span-2 space-y-2">
                  <select
                    value={l1Id}
                    onChange={(e) => { setL1Id(e.target.value); setL2Id(''); setL3Id('') }}
                    className={selectClass}
                  >
                    <option value="">Category 선택</option>
                    {l1Options.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                  </select>
                  <select
                    value={l2Id}
                    onChange={(e) => { setL2Id(e.target.value); setL3Id('') }}
                    disabled={!l1Id}
                    className={`${selectClass} disabled:bg-gray-50 disabled:text-gray-400`}
                  >
                    <option value="">Type 선택</option>
                    {l2Options.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                  </select>
                  <select
                    value={l3Id}
                    onChange={(e) => setL3Id(e.target.value)}
                    disabled={!l2Id}
                    className={`${selectClass} disabled:bg-gray-50 disabled:text-gray-400`}
                  >
                    <option value="">Item 선택</option>
                    {l3Options.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                  </select>
                </div>
              </div>

              {/* 큐 */}
              <div className={rowClass}>
                <label className={labelClass}>Queue</label>
                <div className="sm:col-span-2">
                  <select value={queueId} onChange={(e) => setQueueId(e.target.value)} className={selectClass}>
                    <option value="">
                      {selectedL3?.defaultQueue
                        ? `기본 큐 사용 — ${selectedL3.defaultQueue.name}`
                        : '기본 큐 사용 (분류 선택 시 자동)'}
                    </option>
                    {queues.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                  </select>
                  {selectedL3 && !selectedL3.defaultQueue && !queueId && (
                    <p className="mt-1.5 text-xs text-amber-600">선택한 분류에 기본 큐가 없습니다. 큐를 직접 지정해주세요.</p>
                  )}
                </div>
              </div>

              {/* 심각도 */}
              <div className={rowClass}>
                <label className={labelClass}>Severity</label>
                <div className="sm:col-span-2">
                  <select value={severity} onChange={(e) => setSeverity(e.target.value as TicketSeverity)} className={selectClass}>
                    {ALL_SEVERITIES.map((s) => <option key={s} value={s}>{TICKET_SEVERITY_LABELS[s]}</option>)}
                  </select>
                </div>
              </div>

              {/* 담당자 */}
              <div className={rowClass}>
                <label className={labelClass}>Assignee</label>
                <div className="sm:col-span-2">
                  <OwnerSelect
                    value={ownerId}
                    onChange={setOwnerId}
                    users={users}
                    memberIds={queueMemberIds}
                    className={selectClass}
                  />
                  <p className="mt-1.5 text-xs text-gray-400">담당자를 지정하면 배정(ASSIGNED) 상태로 생성됩니다.</p>
                </div>
              </div>

              {/* 참여자 */}
              <div className={rowClass}>
                <label className={labelClass}>Participants</label>
                <div className="sm:col-span-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {participants.map((u) => (
                      <span key={u.id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
                        {u.name}
                        <button
                          type="button"
                          onClick={() => setParticipantIds((prev) => prev.filter((id) => id !== u.id))}
                          className="ml-0.5 text-blue-400 hover:text-blue-600"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <select
                      value=""
                      onChange={(e) => {
                        const v = e.target.value
                        if (v) setParticipantIds((prev) => (prev.includes(v) ? prev : [...prev, v]))
                      }}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">+ 참여자 추가</option>
                      {users.filter((u) => !participantIds.includes(u.id)).map((u) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* 병원 */}
              <div className={rowClass}>
                <label className={labelClass}>Hospital</label>
                <div className="sm:col-span-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-h-[38px] flex-1 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                      {hospital ? (
                        <span>
                          {hospital.hospitalName || hospital.hiraHospitalName}
                          <span className="ml-2 font-mono text-xs text-gray-400">({hospital.hospitalCode})</span>
                        </span>
                      ) : (
                        <span className="text-gray-400">선택 없음</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setHospitalModalOpen(true)}
                      className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      {hospital ? '변경' : '병원 선택'}
                    </button>
                    {hospital && (
                      <button
                        type="button"
                        onClick={() => setHospital(null)}
                        className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                      >
                        해제
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* 설명 */}
              <div className="px-6 py-4">
                <label className="mb-2 block text-sm font-medium text-gray-700">Description</label>
                <RichTextEditor
                  value={descriptionHtml}
                  onChange={setDescriptionHtml}
                  placeholder="증상·요청 내용을 입력하세요. 진행 경과는 생성 후 타임라인 코멘트에 남겨주세요."
                />
              </div>

            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => router.push('/tickets')}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={busy || !canWrite}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? '저장 중...' : '티켓 생성'}
            </button>
          </div>
        </form>

        {/* 병원 검색 모달 */}
        {hospitalModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                <h2 className="text-base font-semibold text-gray-900">병원 검색</h2>
                <button
                  type="button"
                  onClick={() => { setHospitalModalOpen(false); setHospitalSearch(''); setHospitalResults([]) }}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
                >
                  ✕
                </button>
              </div>
              <div className="p-5">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={hospitalSearch}
                    onChange={(e) => setHospitalSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchHospitals())}
                    placeholder="병원명 검색..."
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={searchHospitals}
                    disabled={hospitalSearching}
                    className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60"
                  >
                    검색
                  </button>
                </div>
                <div className="mt-3 max-h-72 divide-y divide-gray-100 overflow-y-auto">
                  {hospitalResults.length === 0 ? (
                    <p className="py-8 text-center text-sm text-gray-400">
                      {hospitalSearching ? '검색 중...' : '검색어를 입력하고 검색 버튼을 눌러주세요.'}
                    </p>
                  ) : (
                    hospitalResults.map((h) => (
                      <button
                        key={h.hospitalCode}
                        type="button"
                        onClick={() => selectHospital(h)}
                        className="flex w-full flex-col px-2 py-2.5 text-left hover:bg-blue-50"
                      >
                        <span className="text-sm font-medium text-gray-900">{h.hospitalName || h.hiraHospitalName}</span>
                        <span className="text-xs text-gray-400">{h.hospitalCode}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// useSearchParams 사용 컴포넌트는 Suspense 경계 필요 (Next.js App Router)
export default function NewTicketPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <p className="text-sm text-gray-400">불러오는 중...</p>
        </div>
      }
    >
      <NewTicketForm />
    </Suspense>
  )
}
