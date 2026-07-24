'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { TicketStatus, TicketSeverity } from '@prisma/client'
import { TICKET_STATUS_LABELS, TICKET_SEVERITY_LABELS } from '@/lib/ticket-shared'
import TicketStatusBadge from './components/TicketStatusBadge'
import TicketSeverityBadge from './components/TicketSeverityBadge'

interface Queue {
  id: number
  name: string
  isActive: boolean
  _count?: { tickets: number }
}

interface TicketListItem {
  id: number
  ticketCode: string
  title: string
  status: TicketStatus
  severity: TicketSeverity
  refType: string | null
  createdAt: string
  statusChangedAt: string
  queue: { id: number; name: string } | null
  owner: { id: string; name: string } | null
  hospital: { hospitalCode: string; hospitalName: string } | null
  pendingReason: { id: number; name: string } | null
}

/** 저장된 필터(뷰) — localStorage 'ticket-saved-views' */
interface SavedView {
  name: string
  queueId: number | null
  statuses: TicketStatus[]
  severity: string
  refType?: string
  mine: boolean
  unassigned: boolean
  q: string
}

const SAVED_VIEWS_KEY = 'ticket-saved-views'

function loadSavedViews(): SavedView[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(SAVED_VIEWS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const ALL_STATUSES = Object.keys(TICKET_STATUS_LABELS) as TicketStatus[]
const ALL_SEVERITIES = Object.keys(TICKET_SEVERITY_LABELS) as TicketSeverity[]
const PAGE_SIZE = 30

function formatDate(val: string | null): string {
  if (!val) return '-'
  return val.slice(0, 10)
}

/** 상대 경과 시간 (예: '5시간', '3일') */
function timeAgo(iso: string | null): string {
  if (!iso) return '-'
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diffMin < 1) return '방금'
  if (diffMin < 60) return `${diffMin}분`
  const h = Math.floor(diffMin / 60)
  if (h < 24) return `${h}시간`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}일`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}개월`
  return `${Math.floor(mo / 12)}년`
}

/** Sev 시각 규율 — SEV1/2 행 좌측 액센트 (배지 색은 ticket-shared 유지) */
function rowAccent(sev: TicketSeverity): string {
  if (sev === 'SEV1') return 'border-l-4 border-l-red-500 bg-red-50/60 hover:bg-red-100/50 dark:bg-red-900/10'
  if (sev === 'SEV2') return 'border-l-4 border-l-orange-400'
  return ''
}

export default function TicketsPage() {
  const router = useRouter()
  const [role, setRole] = useState<string | null>(null)
  const [queues, setQueues] = useState<Queue[]>([])
  const [tickets, setTickets] = useState<TicketListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  // 필터
  const [queueId, setQueueId] = useState<number | null>(null) // null = 전체
  const [statuses, setStatuses] = useState<TicketStatus[]>([]) // 빈 배열 = 열린 티켓(open=true)
  const [severity, setSeverity] = useState('')
  const [refType, setRefType] = useState('') // '' 전체 | 'none' 순수 | 'MAINTENANCE' 유지보수
  const [mine, setMine] = useState(false)
  const [unassigned, setUnassigned] = useState(false)
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)

  // 저장된 필터(뷰)
  const [savedViews, setSavedViews] = useState<SavedView[]>([])

  const canWrite = !!role && role !== 'VIEWER'

  useEffect(() => { setSavedViews(loadSavedViews()) }, [])

  function persistViews(views: SavedView[]) {
    setSavedViews(views)
    try { localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views)) } catch { /* 무시 */ }
  }

  function saveCurrentView() {
    const name = prompt('저장할 뷰 이름을 입력하세요.')?.trim()
    if (!name) return
    const view: SavedView = { name, queueId, statuses, severity, refType, mine, unassigned, q }
    persistViews([...savedViews.filter((v) => v.name !== name), view])
  }

  function applyView(v: SavedView) {
    setQueueId(v.queueId ?? null)
    setStatuses(v.statuses ?? [])
    setSeverity(v.severity ?? '')
    setRefType(v.refType ?? '')
    setMine(!!v.mine)
    setUnassigned(!!v.unassigned)
    setQInput(v.q ?? '')
    setQ(v.q ?? '')
    setPage(1)
  }

  function deleteView(name: string) {
    if (!confirm(`'${name}' 뷰를 삭제하시겠습니까?`)) return
    persistViews(savedViews.filter((v) => v.name !== name))
  }

  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => setRole(d?.role ?? null))
    fetch('/api/settings/ticket-queues')
      .then((r) => (r.ok ? r.json() : { queues: [] }))
      .then((d) => setQueues((d.queues ?? []).filter((qu: Queue) => qu.isActive)))
  }, [])

  // 검색어 디바운스
  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput.trim()); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [qInput])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (queueId != null) params.set('queueId', String(queueId))
    if (statuses.length > 0) statuses.forEach((s) => params.append('status', s))
    else params.set('open', 'true')
    if (severity) params.set('severity', severity)
    if (refType) params.set('refType', refType)
    if (mine) params.set('mine', 'true')
    else if (unassigned) params.set('unassigned', 'true')
    if (q) params.set('q', q)
    params.set('page', String(page))
    params.set('pageSize', String(PAGE_SIZE))

    fetch(`/api/tickets?${params}`)
      .then((r) => (r.ok ? r.json() : { tickets: [], total: 0 }))
      .then((d) => {
        setTickets(d.tickets ?? [])
        setTotal(d.total ?? 0)
      })
      .finally(() => setLoading(false))
  }, [queueId, statuses, severity, refType, mine, unassigned, q, page])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilter = statuses.length > 0 || !!severity || !!refType || mine || unassigned || !!q

  function toggleStatus(s: TicketStatus) {
    setPage(1)
    setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))
  }

  const queueTabs = useMemo(
    () => [{ id: null as number | null, name: '전체' }, ...queues.map((qu) => ({ id: qu.id as number | null, name: qu.name }))],
    [queues]
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">티켓</h1>
            <p className="mt-1 text-sm text-gray-500">
              총 {total.toLocaleString()}건{statuses.length === 0 ? ' (Open Tickets)' : ''}
            </p>
          </div>
          {canWrite && (
            <button
              type="button"
              onClick={() => router.push('/tickets/new')}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              + 티켓 생성
            </button>
          )}
        </div>

        {/* 큐 탭 */}
        <div className="mb-4 flex flex-wrap gap-1 border-b border-gray-200">
          {queueTabs.map((tab) => (
            <button
              key={tab.id ?? 'all'}
              type="button"
              onClick={() => { setQueueId(tab.id); setPage(1) }}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                queueId === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {tab.name}
            </button>
          ))}
        </div>

        {/* 저장된 필터(뷰) */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-gray-500">Saved Views</span>
          {savedViews.length === 0 && <span className="text-xs text-gray-400">없음</span>}
          {savedViews.map((v) => (
            <span key={v.name} className="inline-flex items-center overflow-hidden rounded-full border border-gray-300 bg-white text-xs font-medium text-gray-600">
              <button
                type="button"
                onClick={() => applyView(v)}
                className="px-3 py-1 transition-colors hover:bg-blue-50 hover:text-blue-700"
                title="이 뷰의 필터 적용"
              >
                {v.name}
              </button>
              <button
                type="button"
                onClick={() => deleteView(v.name)}
                className="border-l border-gray-200 px-1.5 py-1 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500"
                title="뷰 삭제"
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={saveCurrentView}
            className="rounded-full border border-dashed border-gray-300 px-3 py-1 text-xs text-gray-500 transition-colors hover:border-blue-400 hover:text-blue-600"
          >
            + 현재 필터 저장
          </button>
        </div>

        {/* 필터 바 */}
        <div className="mb-4 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-gray-500">Status</span>
            {ALL_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  statuses.includes(s)
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'
                }`}
              >
                {TICKET_STATUS_LABELS[s]}
              </button>
            ))}
            {statuses.length === 0 && (
              <span className="text-xs text-gray-400">(선택 없음 = 해결·종결 제외 전체)</span>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <input
              type="text"
              placeholder="티켓번호·제목 검색..."
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-52"
            />
            <select
              value={severity}
              onChange={(e) => { setSeverity(e.target.value); setPage(1) }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Severity 전체</option>
              {ALL_SEVERITIES.map((s) => (
                <option key={s} value={s}>{TICKET_SEVERITY_LABELS[s]}</option>
              ))}
            </select>
            <select
              value={refType}
              onChange={(e) => { setRefType(e.target.value); setPage(1) }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Type 전체</option>
              <option value="none">순수 티켓</option>
              <option value="MAINTENANCE">유지보수</option>
              <option value="ETC">기타업무</option>
              <option value="SITE_VISIT">답사</option>
              <option value="INSTALL_PLAN">설치계획</option>
              <option value="PROJECT">프로젝트</option>
            </select>
            <button
              type="button"
              onClick={() => { setMine((v) => !v); setUnassigned(false); setPage(1) }}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                mine ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              My Tickets
            </button>
            <button
              type="button"
              onClick={() => { setUnassigned((v) => !v); setMine(false); setPage(1) }}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                unassigned ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              Unassigned
            </button>
            {hasFilter && (
              <button
                type="button"
                onClick={() => { setStatuses([]); setSeverity(''); setRefType(''); setMine(false); setUnassigned(false); setQInput(''); setQ(''); setPage(1) }}
                className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100"
              >
                필터 초기화
              </button>
            )}
          </div>
        </div>

        {/* 테이블 */}
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['Ticket #', 'Sev', 'Type', 'Title', 'Status', 'Queue', 'Assignee', 'Hospital', 'Created', 'Age', 'Last Change'].map((label) => (
                    <th key={label} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-sm text-gray-400">불러오는 중...</td>
                  </tr>
                ) : tickets.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-sm text-gray-400">
                      {hasFilter ? '조건에 맞는 티켓이 없습니다.' : '등록된 티켓이 없습니다.'}
                    </td>
                  </tr>
                ) : (
                  tickets.map((t) => (
                    <tr key={t.id} className={`cursor-pointer hover:bg-gray-50 ${rowAccent(t.severity)}`} onClick={() => router.push(`/tickets/${t.ticketCode}`)}>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-blue-600">{t.ticketCode}</td>
                      <td className="whitespace-nowrap px-4 py-3"><TicketSeverityBadge severity={t.severity} short /></td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {t.refType === 'MAINTENANCE' ? (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                            유지보수
                          </span>
                        ) : t.refType === 'ETC' ? (
                          <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                            기타업무
                          </span>
                        ) : t.refType === 'SITE_VISIT' ? (
                          <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                            답사
                          </span>
                        ) : t.refType === 'INSTALL_PLAN' ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                            설치계획
                          </span>
                        ) : t.refType === 'PROJECT' ? (
                          <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                            프로젝트
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">-</span>
                        )}
                      </td>
                      <td className="max-w-md truncate px-4 py-3 text-sm font-medium text-gray-900">{t.title}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <TicketStatusBadge status={t.status} />
                        {t.status === 'PENDING' && t.pendingReason && (
                          <span className="ml-1.5 text-xs text-gray-400">{t.pendingReason.name}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{t.queue?.name ?? '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{t.owner?.name ?? '-'}</td>
                      <td className="max-w-[12rem] truncate px-4 py-3 text-sm text-gray-700">{t.hospital?.hospitalName ?? '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{formatDate(t.createdAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500" title="접수 후 경과">{timeAgo(t.createdAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500" title="마지막 상태 변경 후 경과">{timeAgo(t.statusChangedAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 페이지네이션 */}
        {total > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              이전
            </button>
            <span className="text-sm text-gray-600">{page} / {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              다음
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
