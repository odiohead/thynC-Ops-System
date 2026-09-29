'use client'

/**
 * 병원 AS메모 패널 (2026-09-29) — 병원 상세 '부가정보 > AS메모' · AS접수 상세 '1.공통정보' 공용
 * 보기: sanitize된 HTML(weekly-rich 스타일) / 편집: WeeklyRichEditor(Tiptap — 굵게·목록·색·형광펜 등) → PUT 저장 → router.refresh()
 * 편집은 USER 이상(canWrite). 접수 종결 여부와 무관 — 병원 단위 정보
 */
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import WeeklyRichEditor from '@/app/weekly/_components/WeeklyRichEditor'
import { sanitizeRichTextHtml } from '@/lib/richtext'

interface Props { hospitalCode: string; canWrite: boolean; /** 카드 안 서브영역으로 쓸 때 제목 숨김 */ compact?: boolean }
interface Memo { asMemo: string | null; updatedAt: string | null; updatedBy: { id: string; name: string } | null }
const kst = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) : '-')

export default function AsMemoPanel({ hospitalCode, canWrite, compact }: Props) {
  const router = useRouter()
  const [memo, setMemo] = useState<Memo | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const r = await fetch(`/api/hospitals/${hospitalCode}/as-memo`)
    if (r.ok) setMemo(await r.json())
  }, [hospitalCode])
  useEffect(() => { void load() }, [load])

  async function save() {
    setSaving(true); setError('')
    try {
      const r = await fetch(`/api/hospitals/${hospitalCode}/as-memo`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asMemo: draft }) })
      const d = await r.json()
      if (!r.ok) { setError(d.error ?? '저장 실패'); return }
      setMemo(d); setEditing(false); router.refresh()
    } finally { setSaving(false) }
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        {!compact && <h3 className="text-xs font-medium uppercase tracking-wider text-gray-400">AS메모</h3>}
        {compact && <span className="text-xs font-medium uppercase tracking-wider text-gray-400">AS메모</span>}
        {memo?.updatedAt && <span className="text-[11px] text-gray-400">{memo.updatedBy?.name ?? '-'} · {kst(memo.updatedAt)}</span>}
        {canWrite && !editing && (
          <button type="button" onClick={() => { setDraft(memo?.asMemo ?? ''); setEditing(true) }} className="ml-auto rounded-md border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50">
            {memo?.asMemo ? '편집' : '작성'}
          </button>
        )}
      </div>
      {editing ? (
        <div>
          <WeeklyRichEditor initial={draft} onChange={setDraft} placeholder="AS 처리 시 참고할 병원별 메모 (선교체 관행·수거 요령·연락 주의사항 등)" autoFocus minHeightClass="min-h-[8rem]" onEscape={() => setEditing(false)} />
          <div className="mt-2 flex items-center justify-end gap-2">
            {error && <span className="mr-auto text-xs text-red-600">{error}</span>}
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600">취소</button>
            <button type="button" onClick={save} disabled={saving} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">{saving ? '저장 중...' : '저장'}</button>
          </div>
        </div>
      ) : memo === null ? (
        <p className="text-sm text-gray-400">불러오는 중...</p>
      ) : memo.asMemo ? (
        <div className="weekly-rich rounded-md border border-amber-100 bg-amber-50/40 px-3 py-2 text-sm text-gray-800" dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(memo.asMemo) }} />
      ) : (
        <p className="text-sm text-gray-400">AS메모가 없습니다.</p>
      )}
    </div>
  )
}
