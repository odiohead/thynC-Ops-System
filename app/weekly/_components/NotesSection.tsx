'use client'

// 주간 특이사항 보드 — 주차별 N건 자유 기재 (엄격한 관리 항목이 아닌 '그 주에 말할 컨텐츠')
// 부모에서 key={weekYmd}로 렌더해 주차 전환 시 편집 상태가 자동 초기화된다.
import { useState } from 'react'
import CellEditor from './CellEditor'
import RichContent from './RichContent'
import { isEmptyRichText } from '@/lib/richtext'
import type { WeeklyNoteDto } from '@/lib/weekly'

interface Props {
  weekYmd: string
  notes: WeeklyNoteDto[]
  canWrite: boolean
  onChanged: () => void
}

export default function NotesSection({ weekYmd, notes, canWrite, onChanged }: Props) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const call = async (url: string, method: string, body?: unknown): Promise<boolean> => {
    setBusy(true)
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (res.redirected) {
        window.location.href = '/login'
        return false
      }
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        alert(d?.error ?? '저장에 실패했습니다.')
        return false
      }
      return true
    } catch {
      alert('네트워크 오류로 저장하지 못했습니다.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const create = async (content: string) => {
    if (isEmptyRichText(content)) {
      alert('내용을 입력하세요.')
      return
    }
    if (await call('/api/weekly/notes', 'POST', { week: weekYmd, content })) {
      setAdding(false)
      onChanged()
    }
  }

  const update = async (id: number, content: string) => {
    if (isEmptyRichText(content)) {
      alert('내용을 입력하세요.')
      return
    }
    if (await call(`/api/weekly/notes/${id}`, 'PUT', { content })) {
      setEditingId(null)
      onChanged()
    }
  }

  const remove = async (n: WeeklyNoteDto) => {
    if (!confirm('이 특이사항을 삭제합니다.')) return
    if (await call(`/api/weekly/notes/${n.id}`, 'DELETE')) onChanged()
  }

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold">주간 특이사항</h2>
        <span className="text-xs text-muted-foreground">{notes.length}건</span>
      </div>

      {notes.length === 0 && !adding && (
        <div className="px-4 py-5 text-center text-sm text-muted-foreground">
          이번 주 특이사항이 없습니다.
        </div>
      )}

      {notes.map((n) => (
        <div key={n.id} className="border-b border-border px-4 py-2.5 last:border-b-0">
          {editingId === n.id ? (
            <CellEditor
              initial={n.content}
              busy={busy}
              onSave={(c) => update(n.id, c)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div className="flex items-start gap-3">
              {/* 작성자 소속팀 — 내용 앞 필드 (2026-08-20) */}
              <span className="mt-0.5 w-24 shrink-0 truncate rounded bg-muted px-1.5 py-0.5 text-center text-[11px] text-muted-foreground" title={n.createdByTeamName ?? undefined}>
                {n.createdByTeamName ?? '—'}
              </span>
              <RichContent content={n.content} className="min-w-0 flex-1 text-sm" />
              <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {n.createdByName ?? '—'} ·{' '}
                  {new Date(n.updatedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                </span>
                {canWrite && (
                  <>
                    <button className="hover:text-foreground hover:underline" onClick={() => setEditingId(n.id)}>
                      수정
                    </button>
                    <button className="hover:text-destructive hover:underline" onClick={() => remove(n)}>
                      삭제
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      ))}

      {adding && (
        <div className="border-b border-border px-4 py-2.5 last:border-b-0">
          <CellEditor
            initial=""
            busy={busy}
            placeholder="이번 주에 공유할 특이사항·공지 등"
            onSave={create}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {canWrite && !adding && (
        <button
          className="w-full border-t border-border px-4 py-2 text-left text-sm text-muted-foreground hover:bg-accent/40 hover:text-foreground"
          onClick={() => setAdding(true)}
        >
          + 특이사항 추가
        </button>
      )}
    </section>
  )
}
