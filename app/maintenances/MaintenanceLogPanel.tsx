'use client'

import { useState, useEffect, useCallback } from 'react'
import RichTextEditor from '@/app/components/RichTextEditor'

interface LogEntry {
  id: number
  authorId: string | null
  content: string
  createdAt: string
  updatedAt: string
  author: { id: string; name: string } | null
}

interface Me {
  userId: string
  role: string
}

function isEmptyHtml(html: string): boolean {
  return html.replace(/<[^>]*>|&nbsp;/g, '').trim() === ''
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

/** 처리 기록 HTML 표시용 최소 스타일 (RichTextEditor의 prose-editor와 동일 규칙) */
const logContentStyle = `
  .mlog-content p { margin: 0.25rem 0; }
  .mlog-content h1 { font-size: 1.5rem; font-weight: 700; margin: 0.75rem 0 0.5rem; }
  .mlog-content h2 { font-size: 1.25rem; font-weight: 600; margin: 0.65rem 0 0.4rem; }
  .mlog-content h3 { font-size: 1.1rem; font-weight: 600; margin: 0.5rem 0 0.35rem; }
  .mlog-content ul { list-style-type: disc; padding-left: 1.5rem; margin: 0.25rem 0; }
  .mlog-content ol { list-style-type: decimal; padding-left: 1.5rem; margin: 0.25rem 0; }
  .mlog-content blockquote { border-left: 3px solid #e5e7eb; padding-left: 1rem; color: #6b7280; margin: 0.5rem 0; }
  .mlog-content code { background: #f3f4f6; border-radius: 0.25rem; padding: 0.1rem 0.3rem; font-size: 0.85em; }
  .mlog-content pre { background: #1f2937; color: #f9fafb; border-radius: 0.5rem; padding: 0.75rem 1rem; margin: 0.5rem 0; overflow-x: auto; }
  .mlog-content pre code { background: none; padding: 0; color: inherit; }
  .mlog-content hr { border-top: 1px solid #e5e7eb; margin: 0.75rem 0; }
  .mlog-content a { color: #2563eb; text-decoration: underline; }
`

export default function MaintenanceLogPanel({ maintenanceId }: { maintenanceId: number }) {
  const [me, setMe] = useState<Me | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [draft, setDraft] = useState('')
  const [composing, setComposing] = useState(false)
  const [busy, setBusy] = useState(false)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const canWrite = !!me && me.role !== 'VIEWER'
  const isAdmin = !!me && (me.role === 'ADMIN' || me.role === 'SUPER_ADMIN')

  const load = useCallback(async () => {
    const res = await fetch(`/api/maintenances/${maintenanceId}/logs`)
    if (res.ok) setLogs((await res.json()).logs ?? [])
    setLoading(false)
  }, [maintenanceId])

  useEffect(() => {
    fetch('/api/auth/me').then(async (r) => {
      if (r.ok) {
        const d = await r.json()
        const u = d?.user ?? d
        if (u?.userId || u?.id) setMe({ userId: u.userId ?? u.id, role: u.role ?? 'VIEWER' })
      }
    })
    void load()
  }, [load])

  function canModify(log: LogEntry): boolean {
    if (!me) return false
    return isAdmin || (log.authorId !== null && log.authorId === me.userId)
  }

  async function handleAdd() {
    if (isEmptyHtml(draft) || busy) return
    setBusy(true); setError(null)
    const res = await fetch(`/api/maintenances/${maintenanceId}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: draft }),
    })
    if (res.ok) {
      setDraft('')
      setComposing(false)
      await load()
    } else {
      setError((await res.json()).error ?? '기록 저장 실패')
    }
    setBusy(false)
  }

  async function handleUpdate(logId: number) {
    if (isEmptyHtml(editDraft) || busy) return
    setBusy(true); setError(null)
    const res = await fetch(`/api/maintenances/${maintenanceId}/logs/${logId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editDraft }),
    })
    if (res.ok) {
      setEditingId(null)
      await load()
    } else {
      setError((await res.json()).error ?? '기록 수정 실패')
    }
    setBusy(false)
  }

  async function handleDelete(logId: number) {
    if (!confirm('이 기록을 삭제하시겠습니까?')) return
    setBusy(true); setError(null)
    const res = await fetch(`/api/maintenances/${maintenanceId}/logs/${logId}`, { method: 'DELETE' })
    if (res.ok) await load()
    else setError((await res.json()).error ?? '기록 삭제 실패')
    setBusy(false)
  }

  return (
    <div>
      <style>{logContentStyle}</style>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">
          처리 기록 <span className="ml-1 font-normal text-gray-400">{logs.length > 0 && `${logs.length}건`}</span>
        </h2>
        {canWrite && !composing && (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            + 기록 추가
          </button>
        )}
      </div>

      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      {composing && (
        <div className="mb-4">
          <RichTextEditor value={draft} onChange={setDraft} placeholder="진행 경과를 입력하세요. 작성자와 시각은 자동으로 기록됩니다." />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => { setComposing(false); setDraft('') }} disabled={busy}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">취소</button>
            <button type="button" onClick={handleAdd} disabled={busy || isEmptyHtml(draft)}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? '저장 중...' : '기록 저장'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="py-4 text-center text-sm text-gray-400">불러오는 중...</p>
      ) : logs.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">아직 처리 기록이 없습니다.</p>
      ) : (
        <ol className="space-y-3">
          {logs.map((log) => (
            <li key={log.id} className="rounded-lg border border-gray-100 bg-gray-50/50 px-4 py-3">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="flex items-baseline gap-2 text-xs">
                  <span className="font-medium text-gray-700">{log.author?.name ?? '(구 비고 이관)'}</span>
                  <span className="text-gray-400">{formatDateTime(log.createdAt)}</span>
                  {log.updatedAt !== log.createdAt && <span className="text-gray-300">수정됨</span>}
                </div>
                {canModify(log) && editingId !== log.id && (
                  <div className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => { setEditingId(log.id); setEditDraft(log.content) }}
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
                <div className="mlog-content text-sm text-gray-800" dangerouslySetInnerHTML={{ __html: log.content }} />
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
