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

  // 탭: 'mine'(My Tickets, 진입 기본) | 'all'(전체) | 큐 id
  const [tab, setTab] = useState<'mine' | 'all' | number>('mine')
  const [myOpenCount, setMyOpenCount] = useState<number | null>(null)

  // 필터
  const [statuses, setStatuses] = useState<TicketStatus[]>([]) // 빈 배열 = 열린 티켓(open=true)
  const [severity, setSeverity] = useState('')
  const [refType, setRefType] = useState('') // '' 전체 | 'none' 순수 | 'MAINTENANCE' 유지보수
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
    const view: SavedView = {
      name,
      queueId: typeof tab === 'number' ? tab : null,
      statuses,
      severity,
      refType,
      mine: tab === 'mine',
      unassigned,
      q,
    }
    persistViews([...savedViews.filter((v) => v.name !== name), view])
  }

  function applyView(v: SavedView) {
    // 하위호환: 구 뷰의 mine=true → My Tickets 탭, 아니면 큐/전체 탭
    setTab(v.mine ? 'mine' : v.queueId ?? 'all')
    setStatuses(v.statuses ?? [])
    setSeverity(v.severity ?? '')
    setRefType(v.refType ?? '')
    setUnassigned(v.mine ? false : !!v.unassigned)
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
    // My Tickets 탭 뱃지 — 내 열린 티켓 수
    fetch('/api/tickets?mine=true&open=true&pageSize=1')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.total === 'number') setMyOpenCount(d.total) })
  }, [])

  // 검색어 디바운스
  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput.trim()); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [qInput])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (tab === 'mine') params.set('mine', 'true') // My Tickets 탭 — 큐 필터 미적용
    else if (typeof tab === 'number') params.set('queueId', String(tab))
    if (statuses.length > 0) statuses.forEach((s) => params.append('status', s))
    else params.set('open', 'true')
    if (severity) params.set('severity', severity)
    if (refType) params.set('refType', refType)
    if (tab !== 'mine' && unassigned) params.set('unassigned', 'true')
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
  }, [tab, statuses, severity, refType, unassigned, q, page])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilter = statuses.length > 0 || !!severity || !!refType || unassigned || !!q

  function toggleStatus(s: TicketStatus) {
    setPage(1)
    setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))
  }

  const queueTabs = useMemo(
    () => [
      { id: 'mine' as const, name: 'My Tickets' },
      { id: 'all' as const, name: '전체' },
      ...queues.map((qu) => ({ id: qu.id, name: qu.name })),
    ] as { id: 'mine' | 'all' | number; name: string }[],
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push('/tickets/dashboard')}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              대시보드
            </button>
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
        </div>

        {/* 탭 — My Tickets(기본) / 전체 / 큐별 */}
        <div className="mb-4 flex flex-wrap gap-1 border-b border-gray-200">
          {queueTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id)
                if (t.id === 'mine') setUnassigned(false) // My Tickets와 Unassigned는 모순 조합
                setPage(1)
              }}
              className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {t.name}
              {t.id === 'mine' && myOpenCount != null && myOpenCount > 0 && (
                <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                  {myOpenCount}
                </span>
              )}
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
              onClick={() => { setUnassigned((v) => !v); setPage(1) }}
              disabled={tab === 'mine'}
              title={tab === 'mine' ? 'My Tickets 탭에서는 사용할 수 없습니다.' : undefined}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                unassigned ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              Unassigned
            </button>
            {hasFilter && (
              <button
                type="button"
                onClick={() => { setStatuses([]); setSeverity(''); setRefType(''); setUnassigned(false); setQInput(''); setQ(''); setPage(1) }}
                className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100"
              >
                필터 초기화
              </button>
            )}
          </div>
        </div>

        {/* 테이블 — table-fixed로 화면 폭 내 고정(가로스크롤 없음), 좁은 화면은 Hospital/Last Change 숨김 */}
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="w-full table-fixed divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {([
                  ['Ticket #', 'w-[8rem]'],
                  ['Sev', 'w-16'],
                  ['Type', 'w-[5.2rem]'],
                  ['Title', ''],
                  ['Status', 'w-20'],
                  ['Queue', 'w-24'],
                  ['Assignee', 'w-20'],
                  ['Hospital', 'hidden w-28 lg:table-cell'],
                  ['Age', 'w-14'],
                  ['Last Change', 'hidden w-20 xl:table-cell'],
                ] as [string, string][]).map(([label, cls]) => (
                  <th key={label} className={`px-2.5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 ${cls}`}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-sm text-gray-400">불러오는 중...</td>
                </tr>
              ) : tickets.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-sm text-gray-400">
                    {hasFilter ? '조건에 맞는 티켓이 없습니다.' : '등록된 티켓이 없습니다.'}
                  </td>
                </tr>
              ) : (
                tickets.map((t) => (
                  <tr key={t.id} className={`cursor-pointer hover:bg-gray-50 ${rowAccent(t.severity)}`} onClick={() => router.push(`/tickets/${t.ticketCode}`)}>
                    <td className="truncate px-2.5 py-2.5 font-mono text-xs text-blue-600" title={t.ticketCode}>{t.ticketCode}</td>
                    <td className="px-2.5 py-2.5"><TicketSeverityBadge severity={t.severity} short /></td>
                    <td className="px-2.5 py-2.5">
                      {t.refType === 'MAINTENANCE' ? (
                        <span className="inline-flex items-center whitespace-nowrap rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                          유지보수
                        </span>
                      ) : t.refType === 'ETC' ? (
                        <span className="inline-flex items-center whitespace-nowrap rounded-full bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                          기타업무
                        </span>
                      ) : t.refType === 'SITE_VISIT' ? (
                        <span className="inline-flex items-center whitespace-nowrap rounded-full bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                          답사
                        </span>
                      ) : t.refType === 'INSTALL_PLAN' ? (
                        <span className="inline-flex items-center whitespace-nowrap rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                          설치계획
                        </span>
                      ) : t.refType === 'PROJECT' ? (
                        <span className="inline-flex items-center whitespace-nowrap rounded-full bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                          프로젝트
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">-</span>
                      )}
                    </td>
                    <td className="truncate px-2.5 py-2.5 text-sm font-medium text-gray-900" title={t.title}>{t.title}</td>
                    <td className="px-2.5 py-2.5">
                      <TicketStatusBadge status={t.status} />
                      {t.status === 'PENDING' && t.pendingReason && (
                        <span className="mt-0.5 block truncate text-[11px] text-gray-400" title={t.pendingReason.name}>{t.pendingReason.name}</span>
                      )}
                    </td>
                    <td className="truncate px-2.5 py-2.5 text-xs text-gray-700" title={t.queue?.name ?? ''}>{t.queue?.name ?? '-'}</td>
                    <td className="truncate px-2.5 py-2.5 text-xs text-gray-700" title={t.owner?.name ?? ''}>{t.owner?.name ?? '-'}</td>
                    <td className="hidden truncate px-2.5 py-2.5 text-xs text-gray-700 lg:table-cell" title={t.hospital?.hospitalName ?? ''}>{t.hospital?.hospitalName ?? '-'}</td>
                    <td className="whitespace-nowrap px-2.5 py-2.5 text-xs text-gray-500" title={`접수 ${formatDate(t.createdAt)}`}>{timeAgo(t.createdAt)}</td>
                    <td className="hidden whitespace-nowrap px-2.5 py-2.5 text-xs text-gray-500 xl:table-cell" title={`마지막 상태 변경 ${formatDate(t.statusChangedAt)}`}>{timeAgo(t.statusChangedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
