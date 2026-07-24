'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { TicketStatus, TicketSeverity } from '@prisma/client'
import { TICKET_TRANSITIONS, TICKET_STATUS_LABELS, TICKET_SEVERITY_LABELS } from '@/lib/ticket-shared'
import TicketStatusBadge from '../components/TicketStatusBadge'
import TicketSeverityBadge from '../components/TicketSeverityBadge'
import TicketLogPanel from '../components/TicketLogPanel'
import OwnerSelect from '../components/OwnerSelect'
import RichTextEditor from '@/app/components/RichTextEditor'

interface UserRef { id: string; name: string }

interface TicketDetail {
  id: number
  ticketCode: string
  title: string
  descriptionHtml: string | null
  status: TicketStatus
  severity: TicketSeverity
  queueId: number
  ctiId: number | null
  ownerId: string | null
  pendingNote: string | null
  hospitalCode: string | null
  resolvedAt: string | null
  closedAt: string | null
  reopenCount: number
  createdAt: string
  queue: { id: number; name: string } | null
  cti: { id: number; name: string; level: number; parentId: number | null } | null
  owner: UserRef | null
  creator: UserRef | null
  hospital: { hospitalCode: string; hospitalName: string } | null
  pendingReason: { id: number; name: string } | null
  participants: { user: UserRef }[]
  parent: { id: number; ticketCode: string; title: string; status: TicketStatus } | null
  children: TicketChild[]
  refType: string | null
  maintenance: {
    id: number
    maintenanceCode: string | null
    reporterName: string | null
    isRemote: boolean
    reportedAt: string | null
  } | null
  etcTask: {
    id: number
    etcTaskCode: string | null
    reportedAt: string | null
    hospitals: { hospital: { hospitalCode: string; hospitalName: string } }[]
  } | null
  siteVisit: {
    id: number
    siteVisitCode: string | null
    requestDate: string | null
    visitDate: string | null
    replyDate: string | null
    daewoongUser: { name: string } | null
  } | null
  installPlan: {
    id: number
    planCode: string | null
    requestDate: string | null
    writeStatus: string
    replyStatus: string
    replyDate: string | null
  } | null
  project: {
    id: number
    projectCode: string
    projectName: string
    startDate: string | null
    endDateExpected: string | null
    buildStatus: { label: string } | null
  } | null
}

interface TicketChild {
  id: number
  ticketCode: string
  title: string
  status: TicketStatus
  severity: TicketSeverity
  ownerId: string | null
}

interface TicketSearchItem {
  id: number
  ticketCode: string
  title: string
  status: TicketStatus
  severity: TicketSeverity
}

interface CtiNode { id: number; parentId: number | null; level: number; name: string }
interface QueueMember { userId: string; user: UserRef }
interface Queue { id: number; name: string; isActive: boolean; members?: QueueMember[] }
interface AppUser { id: string; name: string; isActive: boolean }
interface PendingReason { id: number; name: string; isActive: boolean }
interface Me { userId: string; role: string }

const ALL_SEVERITIES = Object.keys(TICKET_SEVERITY_LABELS) as TicketSeverity[]

function formatDateTime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

const labelClass = 'text-xs font-medium uppercase tracking-wider text-gray-400'
const infoSelectClass = 'mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none disabled:opacity-50'

const descContentStyle = `
  .tdesc-content p { margin: 0.25rem 0; }
  .tdesc-content ul { list-style-type: disc; padding-left: 1.5rem; margin: 0.25rem 0; }
  .tdesc-content ol { list-style-type: decimal; padding-left: 1.5rem; margin: 0.25rem 0; }
  .tdesc-content blockquote { border-left: 3px solid #e5e7eb; padding-left: 1rem; color: #6b7280; margin: 0.5rem 0; }
  .tdesc-content code { background: #f3f4f6; border-radius: 0.25rem; padding: 0.1rem 0.3rem; font-size: 0.85em; }
  .tdesc-content pre { background: #1f2937; color: #f9fafb; border-radius: 0.5rem; padding: 0.75rem 1rem; margin: 0.5rem 0; overflow-x: auto; }
  .tdesc-content a { color: #2563eb; text-decoration: underline; }
`

export default function TicketDetailPage() {
  const params = useParams()
  const router = useRouter()
  // 티켓번호(TK-…) 또는 숫자 id — GET API가 둘 다 허용
  const code = params.code as string

  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [queues, setQueues] = useState<Queue[]>([])
  const [users, setUsers] = useState<AppUser[]>([])
  const [reasons, setReasons] = useState<PendingReason[]>([])
  const [ctiNodes, setCtiNodes] = useState<CtiNode[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [logsRefresh, setLogsRefresh] = useState(0)

  // PENDING 전이 인라인 입력
  const [pendingOpen, setPendingOpen] = useState(false)
  const [pendingReasonId, setPendingReasonId] = useState('')
  const [pendingNote, setPendingNote] = useState('')

  // 제목·설명 수정
  const [editOpen, setEditOpen] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')

  // 기존 티켓 연결(서브로 편입) 검색
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkQ, setLinkQ] = useState('')
  const [linkResults, setLinkResults] = useState<TicketSearchItem[]>([])
  const [linkSearching, setLinkSearching] = useState(false)

  const canWrite = !!me && me.role !== 'VIEWER'
  const isAdmin = !!me && (me.role === 'ADMIN' || me.role === 'SUPER_ADMIN')

  const load = useCallback(async () => {
    const res = await fetch(`/api/tickets/${encodeURIComponent(code)}`)
    if (res.ok) {
      setTicket((await res.json()).ticket)
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? '티켓을 불러올 수 없습니다.')
    }
    setLoading(false)
  }, [code])

  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d?.id) setMe({ userId: d.id, role: d.role ?? 'VIEWER' })
    })
    fetch('/api/settings/ticket-queues')
      .then((r) => (r.ok ? r.json() : { queues: [] }))
      .then((d) => setQueues(d.queues ?? []))
    fetch('/api/users')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setUsers(Array.isArray(d) ? d : []))
    fetch('/api/settings/ticket-pending-reasons')
      .then((r) => (r.ok ? r.json() : { reasons: [] }))
      .then((d) => setReasons(d.reasons ?? []))
    fetch('/api/settings/ticket-cti')
      .then((r) => (r.ok ? r.json() : { nodes: [] }))
      .then((d) => setCtiNodes(d.nodes ?? []))
    void load()
  }, [load])

  const ctiPath = useMemo(() => {
    if (!ticket?.cti) return '-'
    const byId = new Map(ctiNodes.map((n) => [n.id, n]))
    let cur = byId.get(ticket.cti.id)
    if (!cur) return ticket.cti.name
    const parts: string[] = []
    while (cur) {
      parts.unshift(cur.name)
      cur = cur.parentId != null ? byId.get(cur.parentId) : undefined
    }
    return parts.join(' > ')
  }, [ticket, ctiNodes])

  const userNames = useMemo(() => {
    const map: Record<string, string> = {}
    users.forEach((u) => { map[u.id] = u.name })
    return map
  }, [users])
  const queueNames = useMemo(() => {
    const map: Record<string, string> = {}
    queues.forEach((q) => { map[String(q.id)] = q.name })
    return map
  }, [queues])
  const ctiNames = useMemo(() => {
    const map: Record<string, string> = {}
    ctiNodes.forEach((n) => { map[String(n.id)] = n.name })
    return map
  }, [ctiNodes])

  /** 현재 티켓 큐의 멤버 userId — 담당자 셀렉트 상단 그룹 */
  const queueMemberIds = useMemo(() => {
    if (!ticket) return []
    const q = queues.find((qu) => qu.id === ticket.queueId)
    return (q?.members ?? []).map((m) => m.userId)
  }, [ticket, queues])

  /** 공통 mutation — 성공 시 재조회 + 타임라인 갱신 + router.refresh(), 실패 시 API 오류 alert */
  const mutate = useCallback(async (url: string, init: RequestInit): Promise<boolean> => {
    setBusy(true)
    const res = await fetch(url, init)
    if (res.ok) {
      await load()
      setLogsRefresh((k) => k + 1)
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      alert(data.error ?? '처리에 실패했습니다.')
    }
    setBusy(false)
    return res.ok
  }, [load, router])

  async function doTransition(to: TicketStatus) {
    if (!ticket) return
    if (to === 'PENDING') {
      setPendingOpen(true)
      return
    }
    if (to === 'CLOSED' && !confirm('티켓을 종결하시겠습니까?')) return
    await mutate(`/api/tickets/${ticket.id}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to }),
    })
  }

  async function submitPending() {
    if (!ticket) return
    if (!pendingReasonId) { alert('대기 사유를 선택하세요.'); return }
    const ok = await mutate(`/api/tickets/${ticket.id}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: 'PENDING',
        pendingReasonId: Number(pendingReasonId),
        ...(pendingNote.trim() ? { pendingNote: pendingNote.trim() } : {}),
      }),
    })
    if (ok) {
      setPendingOpen(false)
      setPendingReasonId('')
      setPendingNote('')
    }
  }

  function openEdit() {
    if (!ticket) return
    setEditTitle(ticket.title)
    setEditDesc(ticket.descriptionHtml ?? '')
    setEditOpen(true)
  }

  async function saveEdit() {
    if (!ticket) return
    const title = editTitle.trim()
    if (!title) { alert('제목을 입력하세요.'); return }
    const ok = await mutate(`/api/tickets/${ticket.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, descriptionHtml: editDesc }),
    })
    if (ok) setEditOpen(false)
  }

  async function changeOwner(ownerId: string) {
    if (!ticket) return
    await mutate(`/api/tickets/${ticket.id}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId: ownerId || null }),
    })
  }

  async function changeQueue(queueId: string) {
    if (!ticket || !queueId) return
    await mutate(`/api/tickets/${ticket.id}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queueId: Number(queueId) }),
    })
  }

  async function changeSeverity(severity: string) {
    if (!ticket) return
    await mutate(`/api/tickets/${ticket.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ severity }),
    })
  }

  async function setParticipants(userIds: string[]) {
    if (!ticket) return
    await mutate(`/api/tickets/${ticket.id}/participants`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds }),
    })
  }

  async function unsetParent() {
    if (!ticket) return
    if (!confirm('마스터 연결을 해제하시겠습니까?')) return
    await mutate(`/api/tickets/${ticket.id}/parent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId: null }),
    })
  }

  async function linkChild(childId: number) {
    if (!ticket) return
    const ok = await mutate(`/api/tickets/${childId}/parent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId: ticket.id }),
    })
    if (ok) {
      setLinkOpen(false)
      setLinkQ('')
      setLinkResults([])
    }
  }

  async function searchLinkTargets() {
    if (!ticket || !linkQ.trim()) return
    setLinkSearching(true)
    try {
      const sp = new URLSearchParams({ q: linkQ.trim(), pageSize: '10' })
      const res = await fetch(`/api/tickets?${sp}`)
      const data = res.ok ? await res.json() : { tickets: [] }
      const childIds = new Set(ticket.children.map((c) => c.id))
      // 자기 자신·종결 티켓·이미 서브인 티켓 제외 (그 외 규칙 위반은 API 400 alert)
      setLinkResults(
        ((data.tickets ?? []) as TicketSearchItem[]).filter(
          (t) => t.id !== ticket.id && t.status !== 'CLOSED' && !childIds.has(t.id)
        )
      )
    } finally {
      setLinkSearching(false)
    }
  }

  async function handleDeleteTicket() {
    if (!ticket) return
    if (!confirm(`${ticket.ticketCode} 티켓을 삭제하시겠습니까? 타임라인도 함께 삭제됩니다.`)) return
    setBusy(true)
    const res = await fetch(`/api/tickets/${ticket.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.refresh()
      router.push('/tickets')
    } else {
      const data = await res.json().catch(() => ({}))
      alert(data.error ?? '삭제에 실패했습니다.')
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">불러오는 중...</p>
      </div>
    )
  }

  if (error || !ticket) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-red-500">{error ?? '오류가 발생했습니다.'}</p>
      </div>
    )
  }

  const transitions = TICKET_TRANSITIONS[ticket.status] ?? []
  const participantIds = ticket.participants.map((p) => p.user.id)
  const activeUsers = users.filter((u) => u.isActive)
  // 나에게 배정 — 이미 본인이거나 해결/종결이면 숨김 (API도 거부)
  const canAssignToMe =
    canWrite && !!me && ticket.ownerId !== me.userId &&
    ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <style>{descContentStyle}</style>

        {/* 헤더 */}
        <div className="mb-4">
          <div className="flex items-center gap-2">
            <Link href="/tickets" className="text-xs text-blue-600 hover:underline">← 티켓 목록</Link>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-gray-400">{ticket.ticketCode}</span>
            <TicketStatusBadge status={ticket.status} />
            <TicketSeverityBadge severity={ticket.severity} short />
            {ticket.refType === 'MAINTENANCE' && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                유지보수
              </span>
            )}
            {ticket.refType === 'ETC' && (
              <span className="inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                기타업무
              </span>
            )}
            {ticket.refType === 'SITE_VISIT' && (
              <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                답사
              </span>
            )}
            {ticket.refType === 'INSTALL_PLAN' && (
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                설치계획
              </span>
            )}
            {ticket.refType === 'PROJECT' && (
              <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                프로젝트
              </span>
            )}
            {ticket.reopenCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
                Reopened {ticket.reopenCount}
              </span>
            )}
          </div>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">{ticket.title}</h1>
        </div>

        {/* 상단 액션 바 — 항상 같은 자리 */}
        {canWrite && (
          <div className="mb-4 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              {canAssignToMe && (
                <button
                  type="button"
                  onClick={() => me && changeOwner(me.userId)}
                  disabled={busy}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  나에게 배정
                </button>
              )}
              {transitions.length === 0 ? (
                <span className="text-sm text-gray-400">종결된 티켓입니다. 더 이상 전이할 수 없습니다.</span>
              ) : (
                transitions.map((to) => (
                  <button
                    key={to}
                    type="button"
                    onClick={() => doTransition(to)}
                    disabled={busy}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  >
                    → {TICKET_STATUS_LABELS[to]}
                  </button>
                ))
              )}
            </div>
            {pendingOpen && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="mb-2 text-sm font-medium text-amber-800">대기(PENDING) 전환 — 사유를 선택하세요</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select
                    value={pendingReasonId}
                    onChange={(e) => setPendingReasonId(e.target.value)}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">사유 선택</option>
                    {reasons.filter((r) => r.isActive).map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={pendingNote}
                    onChange={(e) => setPendingNote(e.target.value)}
                    placeholder="메모 (선택)"
                    className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={submitPending}
                      disabled={busy || !pendingReasonId}
                      className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      대기 전환
                    </button>
                    <button
                      type="button"
                      onClick={() => { setPendingOpen(false); setPendingReasonId(''); setPendingNote('') }}
                      disabled={busy}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                    >
                      취소
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 연결된 업무 — 유지보수 편입 티켓 */}
        {ticket.refType === 'MAINTENANCE' && ticket.maintenance && (
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              유지보수
            </span>
            <span className="font-mono text-xs">{ticket.maintenance.maintenanceCode ?? `MNT-${String(ticket.maintenance.id).padStart(4, '0')}`}</span>
            <span className="text-xs text-amber-800 dark:text-amber-300">
              신고자 {ticket.maintenance.reporterName || '-'}
              {' · '}{ticket.maintenance.isRemote ? '원격' : '방문'}
              {' · '}접수일 {ticket.maintenance.reportedAt ? ticket.maintenance.reportedAt.slice(0, 10) : '-'}
            </span>
            <Link
              href={`/maintenances/${ticket.maintenance.id}`}
              className="ml-auto shrink-0 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-700 dark:bg-transparent dark:text-amber-300 dark:hover:bg-amber-900/40"
            >
              유지보수 상세로 이동 →
            </Link>
          </div>
        )}

        {/* Linked Work — 기타업무 편입 티켓 */}
        {ticket.refType === 'ETC' && ticket.etcTask && (
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 dark:border-violet-800 dark:bg-violet-900/20 dark:text-violet-200">
            <span className="inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
              기타업무
            </span>
            <span className="font-mono text-xs">{ticket.etcTask.etcTaskCode ?? `ETC-${String(ticket.etcTask.id).padStart(4, '0')}`}</span>
            <span className="text-xs text-violet-800 dark:text-violet-300">
              병원 {ticket.etcTask.hospitals.length === 0
                ? '-'
                : `${ticket.etcTask.hospitals[0].hospital.hospitalName}${ticket.etcTask.hospitals.length > 1 ? ` 외 ${ticket.etcTask.hospitals.length - 1}곳` : ''}`}
              {' · '}접수일 {ticket.etcTask.reportedAt ? ticket.etcTask.reportedAt.slice(0, 10) : '-'}
            </span>
            <Link
              href={`/etc-tasks/${ticket.etcTask.id}`}
              className="ml-auto shrink-0 rounded-md border border-violet-300 bg-white px-2.5 py-1 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-100 dark:border-violet-700 dark:bg-transparent dark:text-violet-300 dark:hover:bg-violet-900/40"
            >
              기타업무 상세로 이동 →
            </Link>
          </div>
        )}

        {/* Linked Work — 답사 편입 티켓 */}
        {ticket.refType === 'SITE_VISIT' && ticket.siteVisit && (
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-200">
            <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
              답사
            </span>
            <span className="font-mono text-xs">{ticket.siteVisit.siteVisitCode ?? `SV-${String(ticket.siteVisit.id).padStart(5, '0')}`}</span>
            <span className="text-xs text-sky-800 dark:text-sky-300">
              요청일 {ticket.siteVisit.requestDate ? ticket.siteVisit.requestDate.slice(0, 10) : '-'}
              {' · '}방문일 {ticket.siteVisit.visitDate ? ticket.siteVisit.visitDate.slice(0, 10) : '-'}
              {' · '}회신일 {ticket.siteVisit.replyDate ? ticket.siteVisit.replyDate.slice(0, 10) : '-'}
              {' · '}대웅담당자 {ticket.siteVisit.daewoongUser?.name ?? '-'}
            </span>
            <Link
              href={`/site-visits/${ticket.siteVisit.id}`}
              className="ml-auto shrink-0 rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-100 dark:border-sky-700 dark:bg-transparent dark:text-sky-300 dark:hover:bg-sky-900/40"
            >
              답사 상세로 이동 →
            </Link>
          </div>
        )}

        {/* Linked Work — 설치계획 편입 티켓 */}
        {ticket.refType === 'INSTALL_PLAN' && ticket.installPlan && (
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              설치계획
            </span>
            <span className="font-mono text-xs">{ticket.installPlan.planCode ?? `#${ticket.installPlan.id}`}</span>
            <span className="text-xs text-emerald-800 dark:text-emerald-300">
              요청일 {ticket.installPlan.requestDate ? ticket.installPlan.requestDate.slice(0, 10) : '-'}
              {' · '}작성 {ticket.installPlan.writeStatus || '-'}
              {' · '}회신 {ticket.installPlan.replyStatus || '-'}
              {' · '}회신일 {ticket.installPlan.replyDate ? ticket.installPlan.replyDate.slice(0, 10) : '-'}
            </span>
            <Link
              href={`/install-plans/${ticket.installPlan.id}`}
              className="ml-auto shrink-0 rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-700 dark:bg-transparent dark:text-emerald-300 dark:hover:bg-emerald-900/40"
            >
              설치계획 상세로 이동 →
            </Link>
          </div>
        )}

        {/* Linked Work — 프로젝트 편입 티켓 */}
        {ticket.refType === 'PROJECT' && ticket.project && (
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-200">
            <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
              프로젝트
            </span>
            <span className="font-mono text-xs">{ticket.project.projectCode}</span>
            <span className="text-xs text-rose-800 dark:text-rose-300">
              {ticket.project.projectName}
              {' · '}공사상태 {ticket.project.buildStatus?.label ?? '-'}
              {' · '}구축시작 {ticket.project.startDate ? ticket.project.startDate.slice(0, 10) : '-'}
              {' · '}완료예정 {ticket.project.endDateExpected ? ticket.project.endDateExpected.slice(0, 10) : '-'}
            </span>
            <Link
              href={`/projects/${ticket.project.projectCode}`}
              className="ml-auto shrink-0 rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100 dark:border-rose-700 dark:bg-transparent dark:text-rose-300 dark:hover:bg-rose-900/40"
            >
              프로젝트 상세로 이동 →
            </Link>
          </div>
        )}

        {/* 기본정보 패널 — 상단 가로 그리드 */}
        <div className="mb-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <h2 className="text-sm font-semibold text-gray-700">Details</h2>
            {isAdmin && (
              <button
                type="button"
                onClick={handleDeleteTicket}
                disabled={busy}
                className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                티켓 삭제
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 px-6 py-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">

            <div>
              <p className={labelClass}>Assignee</p>
              {canWrite ? (
                <OwnerSelect
                  value={ticket.ownerId ?? ''}
                  onChange={changeOwner}
                  users={activeUsers}
                  memberIds={queueMemberIds}
                  disabled={busy}
                  className={infoSelectClass}
                />
              ) : (
                <p className="mt-1 text-sm text-gray-900">{ticket.owner?.name ?? 'Unassigned'}</p>
              )}
            </div>

            <div>
              <p className={labelClass}>Queue</p>
              {canWrite ? (
                <select
                  value={String(ticket.queueId)}
                  onChange={(e) => changeQueue(e.target.value)}
                  disabled={busy}
                  className={infoSelectClass}
                  title="큐 이관"
                >
                  {queues.filter((q) => q.isActive || q.id === ticket.queueId).map((q) => (
                    <option key={q.id} value={q.id}>{q.name}</option>
                  ))}
                </select>
              ) : (
                <p className="mt-1 text-sm text-gray-900">{ticket.queue?.name ?? '-'}</p>
              )}
            </div>

            <div>
              <p className={labelClass}>Severity</p>
              {canWrite ? (
                <select
                  value={ticket.severity}
                  onChange={(e) => changeSeverity(e.target.value)}
                  disabled={busy}
                  className={infoSelectClass}
                >
                  {ALL_SEVERITIES.map((s) => <option key={s} value={s}>{TICKET_SEVERITY_LABELS[s]}</option>)}
                </select>
              ) : (
                <p className="mt-1 text-sm text-gray-900">{TICKET_SEVERITY_LABELS[ticket.severity]}</p>
              )}
            </div>

            <div>
              <p className={labelClass}>CTI</p>
              <p className="mt-1 text-sm text-gray-900">{ctiPath}</p>
            </div>

            <div className="sm:col-span-2">
              <p className={labelClass}>Participants</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {ticket.participants.length === 0 && !canWrite && <span className="text-sm text-gray-400">-</span>}
                {ticket.participants.map((p) => (
                  <span key={p.user.id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                    {p.user.name}
                    {canWrite && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setParticipants(participantIds.filter((uid) => uid !== p.user.id))}
                        className="ml-0.5 text-blue-400 hover:text-blue-600 disabled:opacity-50"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
                {canWrite && (
                  <select
                    value=""
                    disabled={busy}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v && !participantIds.includes(v)) setParticipants([...participantIds, v])
                    }}
                    className="rounded-md border border-gray-300 px-1.5 py-0.5 text-xs text-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                  >
                    <option value="">+ 추가</option>
                    {activeUsers.filter((u) => !participantIds.includes(u.id)).map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div>
              <p className={labelClass}>Hospital</p>
              <p className="mt-1 text-sm text-gray-900">
                {ticket.hospital ? (
                  <Link href={`/hospitals/${ticket.hospital.hospitalCode}`} className="text-blue-600 hover:underline">
                    {ticket.hospital.hospitalName}
                  </Link>
                ) : '-'}
              </p>
            </div>

            <div>
              <p className={labelClass}>Created by</p>
              <p className="mt-1 text-sm text-gray-900">{ticket.creator?.name ?? '-'}</p>
            </div>

            <div>
              <p className={labelClass}>Created</p>
              <p className="mt-1 text-sm text-gray-900">{formatDateTime(ticket.createdAt)}</p>
            </div>

            <div>
              <p className={labelClass}>Resolved</p>
              <p className="mt-1 text-sm text-gray-900">{formatDateTime(ticket.resolvedAt)}</p>
            </div>

            <div>
              <p className={labelClass}>Closed</p>
              <p className="mt-1 text-sm text-gray-900">{formatDateTime(ticket.closedAt)}</p>
            </div>

            {ticket.parent && (
              <div className="sm:col-span-2">
                <p className={labelClass}>Master</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  <Link href={`/tickets/${ticket.parent.ticketCode}`} className="text-blue-600 hover:underline">
                    <span className="font-mono text-xs">{ticket.parent.ticketCode}</span>
                    <span className="ml-1">{ticket.parent.title}</span>
                  </Link>
                  <TicketStatusBadge status={ticket.parent.status} />
                  {canWrite && (
                    <button
                      type="button"
                      onClick={unsetParent}
                      disabled={busy}
                      className="rounded-md border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50"
                    >
                      마스터 해제
                    </button>
                  )}
                </p>
              </div>
            )}

            {ticket.status === 'PENDING' && (
              <div className="sm:col-span-2">
                <p className={labelClass}>Pending Reason</p>
                <p className="mt-1 text-sm text-gray-900">
                  {ticket.pendingReason?.name ?? '-'}
                  {ticket.pendingNote && <span className="ml-2 text-xs text-gray-500">— {ticket.pendingNote}</span>}
                </p>
              </div>
            )}

          </div>
        </div>

        {/* 설명 */}
        <div className="mb-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <h2 className="text-sm font-semibold text-gray-700">Description</h2>
            {canWrite && !editOpen && ticket.status !== 'CLOSED' && (
              <button
                onClick={openEdit}
                disabled={busy}
                className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                제목·설명 수정
              </button>
            )}
          </div>
          {editOpen ? (
            <div className="space-y-3 px-6 py-5">
              <div>
                <label className={labelClass}>Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className={labelClass}>Description</label>
                <div className="mt-1">
                  <RichTextEditor value={editDesc} onChange={setEditDesc} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setEditOpen(false)}
                  disabled={busy}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  onClick={saveEdit}
                  disabled={busy}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  저장
                </button>
              </div>
            </div>
          ) : ticket.descriptionHtml ? (
            <div className="tdesc-content px-6 py-5 text-sm text-gray-800" dangerouslySetInnerHTML={{ __html: ticket.descriptionHtml }} />
          ) : (
            <div className="px-6 py-5 text-sm text-gray-400">설명이 없습니다.</div>
          )}
        </div>

        {/* 서브 티켓 — 서브 티켓 자신에게는 표시하지 않음 (2레벨 고정) */}
        {!ticket.parent && (
          <div className="mb-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-700">
                Sub-tickets
                {ticket.children.length > 0 ? (
                  <span className="ml-1 font-normal text-gray-400">{ticket.children.length}건</span>
                ) : (
                  <span className="ml-1 font-normal text-gray-400">없음</span>
                )}
              </h2>
              {canWrite && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => router.push(`/tickets/new?parentId=${ticket.id}`)}
                    disabled={busy}
                    className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                  >
                    + 서브 티켓 생성
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLinkOpen((v) => !v); setLinkQ(''); setLinkResults([]) }}
                    disabled={busy}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    기존 티켓 연결
                  </button>
                </div>
              )}
            </div>

            {linkOpen && (
              <div className="border-t border-gray-100 bg-gray-50/50 px-6 py-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={linkQ}
                    onChange={(e) => setLinkQ(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchLinkTargets())}
                    placeholder="티켓번호·제목 검색..."
                    className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={searchLinkTargets}
                    disabled={linkSearching || !linkQ.trim()}
                    className="rounded-lg bg-gray-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60"
                  >
                    검색
                  </button>
                </div>
                <div className="mt-2 max-h-56 divide-y divide-gray-100 overflow-y-auto">
                  {linkResults.length === 0 ? (
                    <p className="py-4 text-center text-xs text-gray-400">
                      {linkSearching ? '검색 중...' : '검색 결과에서 선택하면 이 티켓의 서브로 연결됩니다. (종결 티켓 제외)'}
                    </p>
                  ) : (
                    linkResults.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => linkChild(t.id)}
                        disabled={busy}
                        className="flex w-full items-center gap-2 px-2 py-2 text-left hover:bg-blue-50 disabled:opacity-50"
                      >
                        <span className="font-mono text-xs text-blue-600">{t.ticketCode}</span>
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{t.title}</span>
                        <TicketStatusBadge status={t.status} />
                        <TicketSeverityBadge severity={t.severity} short />
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {ticket.children.length > 0 && (
              <div className="overflow-x-auto border-t border-gray-100">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Ticket #', 'Title', 'Status', 'Sev', 'Assignee'].map((label) => (
                        <th key={label} className="whitespace-nowrap px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {ticket.children.map((c) => (
                      <tr key={c.id} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-4 py-2">
                          <Link href={`/tickets/${c.ticketCode}`} className="font-mono text-sm text-blue-600 hover:underline">
                            {c.ticketCode}
                          </Link>
                        </td>
                        <td className="max-w-xs truncate px-4 py-2 text-sm text-gray-900">{c.title}</td>
                        <td className="whitespace-nowrap px-4 py-2"><TicketStatusBadge status={c.status} /></td>
                        <td className="whitespace-nowrap px-4 py-2"><TicketSeverityBadge severity={c.severity} short /></td>
                        <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-700">
                          {c.ownerId ? userNames[c.ownerId] ?? '-' : 'Unassigned'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 타임라인 */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <TicketLogPanel
            ticketId={ticket.id}
            refreshToken={logsRefresh}
            me={me}
            userNames={userNames}
            queueNames={queueNames}
            ctiNames={ctiNames}
          />
        </div>

      </div>
    </div>
  )
}
