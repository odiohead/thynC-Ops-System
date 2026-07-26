'use client'

import { useState, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import Link from 'next/link'
import Modal from '@/app/components/ui/Modal'
import StatusBadge from '@/app/components/StatusBadge'

/**
 * 병원 상세 — 상담이력 카드 (AI 어시스턴트 '상담이력 저장'의 산출물).
 *
 * 조회 권한은 서버(`/api/consultations`)가 SEERS 소속으로 강제한다(설계 D3).
 * 403이면 카드 자체를 렌더하지 않아 대웅 소속 계정에는 존재가 드러나지 않는다.
 *
 * 설계: consultation_history_design.md
 */

interface Consultation {
  id: number
  consultationCode: string
  title: string
  content: string
  consultedByName: string
  consultedAt: string
  sessionId: string | null
  consultationType: { id: number; name: string; color: string | null } | null
  consultedBy: { id: string; name: string } | null
}

interface Props {
  hospitalCode: string
  currentUserId: string | null
  isAdmin: boolean
}

function fmt(d: string | null) {
  return d ? d.slice(0, 10) : '-'
}

/** 목록 미리보기용 — 마크다운 장식을 걷어낸 한 줄 발췌 */
function preview(content: string, title: string): string {
  const flat = content
    .split('\n')
    .map((l) => l.replace(/^#{1,6}\s*/, '').replace(/^[-*+]\s+/, '').replace(/[*_`~]/g, '').trim())
    .filter(Boolean)
  const rest = flat.filter((l) => l !== title)
  return (rest.join(' · ') || flat.join(' · ')).slice(0, 90)
}

export default function ConsultationsCard({ hospitalCode, currentUserId, isAdmin }: Props) {
  const [items, setItems] = useState<Consultation[]>([])
  const [allowed, setAllowed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Consultation | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/consultations?hospitalCode=${encodeURIComponent(hospitalCode)}&pageSize=100`,
      )
      if (!res.ok) {
        setAllowed(false)
        return
      }
      const data = await res.json()
      setAllowed(true)
      setItems(data.consultations ?? [])
    } catch {
      setAllowed(false)
    } finally {
      setLoading(false)
    }
  }, [hospitalCode])

  useEffect(() => {
    void load()
  }, [load])

  function openDetail(c: Consultation) {
    setSelected(c)
    setEditing(false)
    setDraft(c.content)
    setError(null)
  }

  function closeDetail() {
    setSelected(null)
    setEditing(false)
    setError(null)
  }

  const canModify = (c: Consultation) => isAdmin || (!!currentUserId && c.consultedBy?.id === currentUserId)

  async function handleSave() {
    if (!selected) return
    if (!draft.trim()) {
      setError('상담 내용을 입력하세요.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/consultations/${selected.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '수정에 실패했습니다.')
        return
      }
      await load()
      setSelected(data.consultation)
      setEditing(false)
    } catch {
      setError('수정에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!selected) return
    if (!confirm(`상담이력 ${selected.consultationCode}을(를) 삭제할까요?`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/consultations/${selected.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || '삭제에 실패했습니다.')
        return
      }
      closeDetail()
      await load()
    } catch {
      setError('삭제에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  if (loading || !allowed) return null

  return (
    <div id="consultations" className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm scroll-mt-20">
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <h2 className="text-sm font-semibold text-gray-700">
          상담이력{items.length > 0 && <span className="ml-1.5 text-xs font-normal text-gray-400">{items.length}건</span>}
        </h2>
        <Link href="/ai-assistant" className="text-xs text-blue-600 hover:underline">
          AI 어시스턴트
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-gray-400">
          저장된 상담이력이 없습니다. AI 어시스턴트에서 상담 정리 후 저장하면 여기에 표시됩니다.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['상담일', '상담유형', '상담자', '제목', '내용'].map((c) => (
                  <th key={c} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {items.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer transition-colors hover:bg-gray-50"
                  onClick={() => openDetail(c)}
                >
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{fmt(c.consultedAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {c.consultationType
                      ? <StatusBadge label={c.consultationType.name} color={c.consultationType.color} />
                      : <span className="text-sm text-gray-400">-</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{c.consultedByName}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-sm text-gray-700">{c.title}</td>
                  <td className="max-w-md truncate px-4 py-3 text-sm text-gray-400">{preview(c.content, c.title)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!selected}
        onClose={closeDetail}
        title={selected ? `상담이력 ${selected.consultationCode}` : ''}
        widthClass="max-w-2xl"
      >
        {selected && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-5 py-3 text-xs text-muted-foreground">
              <span>{fmt(selected.consultedAt)}</span>
              <span>·</span>
              <span>{selected.consultedByName}</span>
              {selected.consultationType && (
                <>
                  <span>·</span>
                  <StatusBadge label={selected.consultationType.name} color={selected.consultationType.color} />
                </>
              )}
              {selected.sessionId && (
                <Link href="/ai-assistant" className="ml-auto text-blue-600 hover:underline">
                  원 대화 열기
                </Link>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {editing ? (
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={16}
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              ) : (
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown>{selected.content}</ReactMarkdown>
                </div>
              )}
              {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            </div>

            {canModify(selected) && (
              <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
                {editing ? (
                  <>
                    <button
                      onClick={handleSave}
                      disabled={busy}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {busy ? '저장 중...' : '저장'}
                    </button>
                    <button
                      onClick={() => { setEditing(false); setDraft(selected.content); setError(null) }}
                      disabled={busy}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                    >
                      취소
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setEditing(true)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    수정
                  </button>
                )}
                <button
                  onClick={handleDelete}
                  disabled={busy}
                  className="ml-auto rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  삭제
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
