'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import FavoriteButton from './FavoriteButton'
import { useToast } from '../components/ui/Toast'

type Props = {
  id: string
  title: string
  breadcrumb: { id: string; title: string }[]
  contentHtml: string
  author: string
  lastEditor: string
  updatedAt: string
  favorited: boolean
  currentUserRole: string
  aiExcluded: boolean
}

/**
 * HTML 문서 페이지 뷰어 — BlockNote 편집 대신 sandbox iframe으로 원본 HTML을 렌더링.
 * 편집은 파일 재업로드(교체) 방식. 스크립트 실행은 sandbox로 차단(allow-same-origin은 높이 측정용).
 */
export default function WikiHtmlPageView({
  id,
  title: initialTitle,
  breadcrumb,
  contentHtml,
  author,
  lastEditor,
  updatedAt,
  favorited,
  currentUserRole,
  aiExcluded,
}: Props) {
  const router = useRouter()
  const toast = useToast()
  const editable = currentUserRole !== 'VIEWER'
  const isAdmin = currentUserRole === 'ADMIN' || currentUserRole === 'SUPER_ADMIN'
  const [excluded, setExcluded] = useState(aiExcluded)

  const toggleAiExclude = async () => {
    const next = !excluded
    try {
      const res = await fetch(`/api/wiki/pages/${id}/ai-exclude`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excluded: next }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || '변경 실패')
      }
      setExcluded(next)
      router.refresh()
      toast.success(next ? 'AI 어시스턴트 검색에서 제외했습니다 (하위 포함).' : 'AI 어시스턴트 검색 제외를 해제했습니다.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '변경 실패')
    }
  }

  const [title, setTitle] = useState(initialTitle)
  const [busy, setBusy] = useState(false)
  const [iframeHeight, setIframeHeight] = useState<number>(800)
  const baseUpdatedAtRef = useRef(updatedAt)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const saveTitle = async () => {
    const t = title.trim()
    if (!editable || !t || t === initialTitle) return
    const res = await fetch(`/api/wiki/pages/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: t, baseUpdatedAt: baseUpdatedAtRef.current }),
    })
    if (res.ok) {
      const data = await res.json()
      baseUpdatedAtRef.current = data.updatedAt
      router.refresh()
    } else {
      const err = await res.json().catch(() => ({}))
      toast.error(err.error || '제목 저장에 실패했습니다')
      setTitle(initialTitle)
    }
  }

  const handleReplace = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      toast.error('HTML 문서는 최대 2MB까지 업로드할 수 있습니다')
      return
    }
    const text = await file.text()
    if (!text.trim()) {
      toast.error('빈 파일입니다')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/wiki/pages/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentHtml: text, baseUpdatedAt: baseUpdatedAtRef.current }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `교체 실패 (${res.status})`)
      }
      toast.success('문서를 교체했습니다')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '문서 교체에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  const handleDownload = () => {
    const blob = new Blob([contentHtml], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title || 'document'}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDelete = async () => {
    if (!confirm('이 문서를 휴지통으로 이동할까요?')) return
    setBusy(true)
    try {
      const res = await fetch(`/api/wiki/pages/${id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || '삭제 실패')
      }
      router.refresh()
      router.push('/wiki')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '삭제에 실패했습니다')
      setBusy(false)
    }
  }

  const syncIframeHeight = () => {
    try {
      const doc = iframeRef.current?.contentDocument
      if (!doc) return
      const h = Math.max(doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0)
      if (h > 0) setIframeHeight(Math.min(h + 32, 20000))
    } catch {
      /* cross-origin 등 측정 실패 시 기본 높이 유지 */
    }
  }

  return (
    <div className="wiki-content py-6">
      {/* breadcrumb */}
      {breadcrumb.length > 0 && (
        <nav className="mb-3 flex flex-wrap items-center gap-1 text-xs text-[var(--wiki-text-muted)]">
          {breadcrumb.map((b) => (
            <span key={b.id} className="flex items-center gap-1">
              <Link href={`/wiki/${b.id}`} className="hover:text-[var(--wiki-accent)] hover:underline">
                {b.title || '제목 없음'}
              </Link>
              <span>/</span>
            </span>
          ))}
          <span className="text-[var(--wiki-text)]">{title || '제목 없음'}</span>
        </nav>
      )}

      {/* 헤더 */}
      <div className="mb-1 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-2xl" title="HTML 문서 페이지">🌐</span>
          <input
            type="text"
            value={title}
            readOnly={!editable}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="wiki-page-title w-full border-none bg-transparent py-1 focus:outline-none"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pt-1">
          <FavoriteButton pageId={id} initialFavorited={favorited} />
          <button
            onClick={handleDownload}
            className="rounded-[6px] border border-[var(--wiki-border)] px-2.5 py-1.5 text-xs transition hover:bg-[var(--wiki-hover)]"
            title="HTML 파일 다운로드"
          >
            ⬇ 다운로드
          </button>
          {isAdmin && (
            <button
              onClick={toggleAiExclude}
              className="rounded-[6px] border border-[var(--wiki-border)] px-2.5 py-1.5 text-xs transition hover:bg-[var(--wiki-hover)]"
              title={excluded ? 'AI 어시스턴트 검색 제외를 해제' : 'AI 어시스턴트 검색에서 제외(하위 포함)'}
            >
              {excluded ? '🤖 AI 제외 해제' : '🚫 AI 제외'}
            </button>
          )}
          {editable && (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="rounded-[6px] border border-[var(--wiki-border)] px-2.5 py-1.5 text-xs transition hover:bg-[var(--wiki-hover)] disabled:opacity-50"
                title="새 HTML 파일로 교체"
              >
                ⟳ 파일 교체
              </button>
              <button
                onClick={handleDelete}
                disabled={busy}
                className="rounded-[6px] border border-[var(--wiki-border)] px-2.5 py-1.5 text-xs text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                삭제
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".html,.htm,text/html"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleReplace(f)
                  e.target.value = ''
                }}
              />
            </>
          )}
        </div>
      </div>

      <div className="mb-2 text-xs text-[var(--wiki-text-muted)]">
        HTML 문서 · 작성 {author} · 최근 수정 {lastEditor} ·{' '}
        {new Date(updatedAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}
      </div>
      {excluded && (
        <div className="mb-4 inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
          🚫 이 페이지(및 하위)는 AI 어시스턴트 검색에서 제외됨
        </div>
      )}

      {/* 본문 — sandbox iframe (스크립트 실행 차단) */}
      <iframe
        ref={iframeRef}
        srcDoc={contentHtml}
        sandbox="allow-same-origin"
        title={title || 'HTML 문서'}
        onLoad={syncIframeHeight}
        style={{ height: iframeHeight }}
        className="w-full rounded-[10px] border border-[var(--wiki-border)] bg-white"
      />
    </div>
  )
}
