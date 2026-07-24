'use client'

import { useState, useEffect, useCallback } from 'react'
import type { TicketStatus, TicketSeverity } from '@prisma/client'
import RichTextEditor from '@/app/components/RichTextEditor'
import { TICKET_STATUS_LABELS, TICKET_SEVERITY_LABELS } from '@/lib/ticket-shared'

interface LogEntry {
  id: number
  logType: string
  authorId: string | null
  contentHtml: string | null
  payload: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  author: { id: string; name: string } | null
}

interface Me { userId: string; role: string }

interface Props {
  ticketId: number
  /** 부모에서 mutation 후 증가시키면 재조회 */
  refreshToken?: number
  /** 미전달 시 패널이 자체 로드 (유지보수 상세 등 단독 사용) */
  me?: Me | null
  userNames?: Record<string, string>
  queueNames?: Record<string, string>
  ctiNames?: Record<string, string>
}

function isEmptyHtml(html: string): boolean {
  return html.replace(/<[^>]*>|&nbsp;/g, '').trim() === ''
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

/** 코멘트 HTML 표시용 최소 스타일 (MaintenanceLogPanel과 동일 규칙) */
const logContentStyle = `
  .tlog-content p { margin: 0.25rem 0; }
  .tlog-content h1 { font-size: 1.5rem; font-weight: 700; margin: 0.75rem 0 0.5rem; }
  .tlog-content h2 { font-size: 1.25rem; font-weight: 600; margin: 0.65rem 0 0.4rem; }
  .tlog-content h3 { font-size: 1.1rem; font-weight: 600; margin: 0.5rem 0 0.35rem; }
  .tlog-content ul { list-style-type: disc; padding-left: 1.5rem; margin: 0.25rem 0; }
  .tlog-content ol { list-style-type: decimal; padding-left: 1.5rem; margin: 0.25rem 0; }
  .tlog-content blockquote { border-left: 3px solid #e5e7eb; padding-left: 1rem; color: #6b7280; margin: 0.5rem 0; }
  .tlog-content code { background: #f3f4f6; border-radius: 0.25rem; padding: 0.1rem 0.3rem; font-size: 0.85em; }
  .tlog-content pre { background: #1f2937; color: #f9fafb; border-radius: 0.5rem; padding: 0.75rem 1rem; margin: 0.5rem 0; overflow-x: auto; }
  .tlog-content pre code { background: none; padding: 0; color: inherit; }
  .tlog-content hr { border-top: 1px solid #e5e7eb; margin: 0.75rem 0; }
  .tlog-content a { color: #2563eb; text-decoration: underline; }
`

export default function TicketLogPanel({
  ticketId,
  refreshToken = 0,
  me: meProp,
  userNames: userNamesProp,
  queueNames: queueNamesProp,
  ctiNames: ctiNamesProp,
}: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 단독 사용 시 자체 로드 폴백
  const [selfMe, setSelfMe] = useState<Me | null>(null)
  const [selfUserNames, setSelfUserNames] = useState<Record<string, string>>({})
  const [selfQueueNames, setSelfQueueNames] = useState<Record<string, string>>({})
  const [selfCtiNames, setSelfCtiNames] = useState<Record<string, string>>({})

  const me = meProp !== undefined ? meProp : selfMe
  const userNames = userNamesProp ?? selfUserNames
  const queueNames = queueNamesProp ?? selfQueueNames
  const ctiNames = ctiNamesProp ?? selfCtiNames

  useEffect(() => {
    if (meProp === undefined) {
      fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => {
        if (d?.id) setSelfMe({ userId: d.id, role: d.role ?? 'VIEWER' })
      })
    }
    if (!userNamesProp) {
      fetch('/api/users').then((r) => (r.ok ? r.json() : [])).then((d) => {
        const map: Record<string, string> = {}
        ;(Array.isArray(d) ? d : []).forEach((u: { id: string; name: string }) => { map[u.id] = u.name })
        setSelfUserNames(map)
      })
    }
    if (!queueNamesProp) {
      fetch('/api/settings/ticket-queues').then((r) => (r.ok ? r.json() : { queues: [] })).then((d) => {
        const map: Record<string, string> = {}
        ;(d.queues ?? []).forEach((q: { id: number; name: string }) => { map[String(q.id)] = q.name })
        setSelfQueueNames(map)
      })
    }
    if (!ctiNamesProp) {
      fetch('/api/settings/ticket-cti').then((r) => (r.ok ? r.json() : { nodes: [] })).then((d) => {
        const map: Record<string, string> = {}
        ;(d.nodes ?? []).forEach((n: { id: number; name: string }) => { map[String(n.id)] = n.name })
        setSelfCtiNames(map)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [draft, setDraft] = useState('')
  const [composing, setComposing] = useState(false)
  const [busy, setBusy] = useState(false)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const canWrite = !!me && me.role !== 'VIEWER'
  const isAdmin = !!me && (me.role === 'ADMIN' || me.role === 'SUPER_ADMIN')

  const load = useCallback(async () => {
    const res = await fetch(`/api/tickets/${ticketId}/logs`)
    if (res.ok) setLogs((await res.json()).logs ?? [])
    setLoading(false)
  }, [ticketId])

  useEffect(() => { void load() }, [load, refreshToken])

  function canModify(log: LogEntry): boolean {
    if (!me || log.logType !== 'comment') return false
    return isAdmin || (log.authorId !== null && log.authorId === me.userId)
  }

  /** 시스템 이벤트 payload → 한 줄 요약 */
  function summarize(log: LogEntry): string {
    const p = (log.payload ?? {}) as Record<string, unknown>
    const un = (v: unknown) => (v == null ? 'Unassigned' : userNames[String(v)] ?? String(v))
    const qn = (v: unknown) => (v == null ? '-' : queueNames[String(v)] ?? `#${v}`)
    const cn = (v: unknown) => (v == null ? '-' : ctiNames[String(v)] ?? `#${v}`)
    const sl = (v: unknown) => TICKET_STATUS_LABELS[v as TicketStatus] ?? String(v)
    const vl = (v: unknown) => TICKET_SEVERITY_LABELS[v as TicketSeverity] ?? String(v)
    switch (log.logType) {
      case 'created':
        return '티켓 생성'
      case 'status_change': {
        let s = `Status ${sl(p.from)} → ${sl(p.to)}`
        if (p.auto) s += ' (자동)'
        if (p.reopen) s += ' (Reopened)'
        if (p.pendingReason) s += ` · Reason: ${p.pendingReason}${p.pendingNote ? ` — ${p.pendingNote}` : ''}`
        return s
      }
      case 'assign':
        return `Owner ${un(p.from)} → ${un(p.to)}`
      case 'queue_transfer':
        return `Queue ${qn(p.from)} → ${qn(p.to)}`
      case 'sev_change':
        return `Severity ${vl(p.from)} → ${vl(p.to)}`
      case 'cti_change':
        return `CTI ${cn(p.from)} → ${cn(p.to)}`
      case 'link': {
        const parentCode = p.parentCode ? String(p.parentCode) : p.parentId != null ? `#${p.parentId}` : ''
        const childCode = p.childCode ? String(p.childCode) : p.childId != null ? `#${p.childId}` : ''
        switch (p.event) {
          case 'parent_set': return `Master 지정 → ${parentCode}`
          case 'parent_unset': return `Master 해제${parentCode ? ` (${parentCode})` : ''}`
          case 'child_added': return `Sub-ticket 추가 ← ${childCode}`
          case 'child_removed': return `Sub-ticket 제외${childCode ? ` (${childCode})` : ''}`
          default: return 'Master-Sub 연결 변경'
        }
      }
      default:
        return log.logType
    }
  }

  async function handleAdd() {
    if (isEmptyHtml(draft) || busy) return
    setBusy(true); setError(null)
    const res = await fetch(`/api/tickets/${ticketId}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: draft }),
    })
    if (res.ok) {
      setDraft('')
      setComposing(false)
      await load()
    } else {
      setError((await res.json()).error ?? '코멘트 저장 실패')
    }
    setBusy(false)
  }

  async function handleUpdate(logId: number) {
    if (isEmptyHtml(editDraft) || busy) return
    setBusy(true); setError(null)
    const res = await fetch(`/api/tickets/${ticketId}/logs/${logId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editDraft }),
    })
    if (res.ok) {
      setEditingId(null)
      await load()
    } else {
      setError((await res.json()).error ?? '코멘트 수정 실패')
    }
    setBusy(false)
  }

  async function handleDelete(logId: number) {
    if (!confirm('이 코멘트를 삭제하시겠습니까?')) return
    setBusy(true); setError(null)
    const res = await fetch(`/api/tickets/${ticketId}/logs/${logId}`, { method: 'DELETE' })
    if (res.ok) await load()
    else setError((await res.json()).error ?? '코멘트 삭제 실패')
    setBusy(false)
  }

  const commentCount = logs.filter((l) => l.logType === 'comment').length

  return (
    <div>
      <style>{logContentStyle}</style>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">
          Timeline <span className="ml-1 font-normal text-gray-400">{commentCount > 0 && `Comments ${commentCount}`}</span>
        </h2>
        {canWrite && !composing && (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            + 코멘트 작성
          </button>
        )}
      </div>

      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      {loading ? (
        <p className="py-4 text-center text-sm text-gray-400">불러오는 중...</p>
      ) : logs.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">아직 기록이 없습니다.</p>
      ) : (
        <ol className="space-y-2">
          {logs.map((log) =>
            log.logType === 'comment' ? (
              <li key={log.id} className="rounded-lg border border-gray-100 bg-gray-50/50 px-4 py-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-baseline gap-2 text-xs">
                    <span className="font-medium text-gray-700">{log.author?.name ?? '-'}</span>
                    <span className="text-gray-400">{formatDateTime(log.createdAt)}</span>
                    {log.updatedAt !== log.createdAt && <span className="text-gray-300">수정됨</span>}
                  </div>
                  {canModify(log) && editingId !== log.id && (
                    <div className="flex shrink-0 gap-1">
                      <button type="button" onClick={() => { setEditingId(log.id); setEditDraft(log.contentHtml ?? '') }}
                        className="rounded px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600">수정</button>
                      <button type="button" onClick={() => handleDelete(log.id)}
                        className="rounded px-2 py-0.5 text-xs text-red-300 hover:bg-red-50 hover:text-red-500">삭제</button>
                    </div>
                  )}
                </div>
                {editingId === log.id ? (
                  <div>
                    <RichTextEditor value={editDraft} onChange={setEditDraft} />
                    <div className="mt-2 flex justify-end gap-2">
                      <button type="button" onClick={() => setEditingId(null)} disabled={busy}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">취소</button>
                      <button type="button" onClick={() => handleUpdate(log.id)} disabled={busy || isEmptyHtml(editDraft)}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                        {busy ? '저장 중...' : '수정 저장'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="tlog-content text-sm text-gray-800" dangerouslySetInnerHTML={{ __html: log.contentHtml ?? '' }} />
                )}
              </li>
            ) : (
              <li key={log.id} className="flex flex-wrap items-baseline gap-x-2 px-1 py-1 text-xs text-gray-400">
                <span className="text-gray-300">•</span>
                <span className="text-gray-500">{summarize(log)}</span>
                <span>· {log.author?.name ?? '시스템'}</span>
                <span>· {formatDateTime(log.createdAt)}</span>
              </li>
            )
          )}
        </ol>
      )}

      {composing && (
        <div className="mt-4">
          <RichTextEditor value={draft} onChange={setDraft} placeholder="코멘트를 입력하세요. 작성자와 시각은 자동으로 기록됩니다." />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => { setComposing(false); setDraft('') }} disabled={busy}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">취소</button>
            <button type="button" onClick={handleAdd} disabled={busy || isEmptyHtml(draft)}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? '등록 중...' : '코멘트 등록'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
