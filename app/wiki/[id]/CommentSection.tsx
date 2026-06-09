'use client'

import { useEffect, useState } from 'react'

type Comment = {
  id: string
  body: string
  createdAt: string
  updatedAt: string
  author: { id: string; name: string }
}

type Props = {
  pageId: string
  currentUserId: string
  currentUserRole: string
}

export default function CommentSection({ pageId, currentUserId, currentUserRole }: Props) {
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const canWrite = currentUserRole !== 'VIEWER'
  const isAdminish = currentUserRole === 'ADMIN' || currentUserRole === 'SUPER_ADMIN'

  const load = async () => {
    setLoading(true)
    const res = await fetch(`/api/wiki/pages/${pageId}/comments`)
    if (res.ok) {
      const data = await res.json()
      setComments(data.comments ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [pageId])

  const post = async () => {
    if (!draft.trim() || posting) return
    setPosting(true)
    setError(null)
    try {
      const res = await fetch(`/api/wiki/pages/${pageId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: draft.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `등록 실패 (${res.status})`)
      }
      const data = await res.json()
      setComments((prev) => [...prev, data.comment])
      setDraft('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '등록 실패')
    } finally {
      setPosting(false)
    }
  }

  const startEdit = (c: Comment) => {
    setEditingId(c.id)
    setEditDraft(c.body)
  }

  const saveEdit = async (commentId: string) => {
    if (!editDraft.trim()) return
    const res = await fetch(`/api/wiki/comments/${commentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: editDraft.trim() }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      alert(err.error || `수정 실패 (${res.status})`)
      return
    }
    const data = await res.json()
    setComments((prev) =>
      prev.map((c) =>
        c.id === commentId
          ? { ...c, body: data.comment.body, updatedAt: data.comment.updatedAt }
          : c,
      ),
    )
    setEditingId(null)
  }

  const remove = async (commentId: string) => {
    if (!confirm('이 댓글을 삭제하시겠습니까?')) return
    const res = await fetch(`/api/wiki/comments/${commentId}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      alert(err.error || `삭제 실패 (${res.status})`)
      return
    }
    setComments((prev) => prev.filter((c) => c.id !== commentId))
  }

  return (
    <div className="mt-8 border-t pt-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">
        💬 댓글 {comments.length > 0 && `(${comments.length})`}
      </h2>

      {loading ? (
        <div className="text-sm text-gray-500">로딩 중...</div>
      ) : comments.length === 0 ? (
        <div className="text-sm text-gray-400 italic mb-4">첫 댓글을 남겨보세요.</div>
      ) : (
        <ul className="space-y-3 mb-4">
          {comments.map((c) => {
            const canEdit = c.author.id === currentUserId || isAdminish
            return (
              <li key={c.id} className="border rounded p-3 bg-gray-50">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                  <span>
                    <span className="font-medium text-gray-700">{c.author.name}</span> ·{' '}
                    {new Date(c.createdAt).toLocaleString('ko-KR')}
                    {c.updatedAt !== c.createdAt && ' (수정됨)'}
                  </span>
                  {canEdit && editingId !== c.id && (
                    <span className="flex gap-2">
                      <button onClick={() => startEdit(c)} className="hover:text-gray-900">
                        수정
                      </button>
                      <button onClick={() => remove(c.id)} className="hover:text-red-600">
                        삭제
                      </button>
                    </span>
                  )}
                </div>
                {editingId === c.id ? (
                  <div>
                    <textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      rows={2}
                      className="w-full px-2 py-1 border rounded text-sm"
                    />
                    <div className="mt-1 flex gap-1">
                      <button
                        onClick={() => saveEdit(c.id)}
                        className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        저장
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-xs px-2 py-0.5 border rounded hover:bg-gray-50"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-gray-900 whitespace-pre-wrap">{c.body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {canWrite && (
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="댓글을 입력하세요. Ctrl+Enter로 등록."
            rows={3}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') post()
            }}
            className="w-full px-3 py-2 border rounded text-sm"
          />
          {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
          <div className="mt-1 text-right">
            <button
              onClick={post}
              disabled={posting || !draft.trim()}
              className="px-4 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {posting ? '등록 중...' : '등록'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
