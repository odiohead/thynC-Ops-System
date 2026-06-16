'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import type { PartialBlock } from '@blocknote/core'
import { useToast } from '../components/ui/Toast'

// BlockNote는 렌더 중 window를 참조 → SSR 비안전. 클라이언트 전용으로 동적 로드
const WikiEditor = dynamic(() => import('../components/WikiEditor'), { ssr: false })

type Template = { id: string; title: string; icon: string | null }

export default function NewWikiPage() {
  const router = useRouter()
  const toast = useToast()
  const searchParams = useSearchParams()
  const parentId = searchParams.get('parentId')

  const [templates, setTemplates] = useState<Template[]>([])
  const [picking, setPicking] = useState(true) // 시작 방식 선택 단계
  const [seed, setSeed] = useState<PartialBlock[] | undefined>(undefined)

  const [title, setTitle] = useState('')
  const [content, setContent] = useState<unknown[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/wiki/pages?templates=1')
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d) => {
        if (cancelled) return
        const list = (d.templates as Template[]) ?? []
        setTemplates(list)
        if (list.length === 0) setPicking(false) // 템플릿 없으면 바로 빈 페이지
      })
      .catch(() => !cancelled && setPicking(false))
    return () => {
      cancelled = true
    }
  }, [])

  const startBlank = () => {
    setSeed(undefined)
    setPicking(false)
  }

  const startFromTemplate = async (tpl: Template) => {
    try {
      const res = await fetch(`/api/wiki/pages/${tpl.id}`)
      if (!res.ok) {
        toast.error('템플릿을 불러오지 못했습니다')
        return
      }
      const data = await res.json()
      const blocks = Array.isArray(data.page?.contentJson) ? data.page.contentJson : []
      setSeed(blocks as PartialBlock[])
      setContent(blocks)
      setPicking(false)
    } catch {
      toast.error('템플릿을 불러오지 못했습니다')
    }
  }

  const handleSave = async () => {
    if (!title.trim()) {
      setError('제목을 입력하세요.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/wiki/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), contentJson: content, parentId: parentId || null }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `저장 실패 (${res.status})`)
      }
      const { id } = await res.json()
      router.refresh()
      router.push(`/wiki/${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패')
      setSaving(false)
    }
  }

  if (picking) {
    return (
      <div className="wiki-content py-12">
        <h1 className="wiki-page-title mb-6">새 페이지 시작</h1>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            onClick={startBlank}
            className="flex flex-col items-start gap-1 rounded-[10px] border border-[var(--wiki-border)] bg-[var(--wiki-bg)] p-4 text-left transition hover:border-[var(--wiki-accent)] hover:bg-[var(--wiki-hover)]"
          >
            <span className="text-2xl">📄</span>
            <span className="text-sm font-semibold text-[var(--wiki-text)]">빈 페이지</span>
            <span className="text-xs text-[var(--wiki-text-muted)]">처음부터 작성</span>
          </button>
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => startFromTemplate(t)}
              className="flex flex-col items-start gap-1 rounded-[10px] border border-[var(--wiki-border)] bg-[var(--wiki-bg)] p-4 text-left transition hover:border-[var(--wiki-accent)] hover:bg-[var(--wiki-hover)]"
            >
              <span className="text-2xl">{t.icon || '📐'}</span>
              <span className="text-sm font-semibold text-[var(--wiki-text)]">
                {t.title || '제목 없음'}
              </span>
              <span className="text-xs text-[var(--wiki-text-muted)]">템플릿</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="wiki-content py-8">
      {parentId && (
        <div className="mb-3 inline-block rounded-[6px] bg-[var(--wiki-accent-soft)] px-2 py-1 text-xs text-[var(--wiki-accent)]">
          하위 페이지로 추가됩니다
        </div>
      )}
      <div className="mb-5 flex items-start justify-between gap-4">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목 없음"
          autoFocus
          className="wiki-page-title flex-1 border-none bg-transparent py-1 focus:outline-none"
        />
        <div className="flex shrink-0 gap-2 pt-1.5">
          <button
            onClick={() => router.push('/wiki')}
            disabled={saving}
            className="rounded-[6px] border border-[var(--wiki-border)] px-4 py-2 text-sm transition hover:bg-[var(--wiki-hover)] disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-[6px] bg-[var(--wiki-accent)] px-4 py-2 text-sm font-medium text-white transition hover:brightness-95 disabled:opacity-50"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-[6px] border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-2 text-xs text-[var(--wiki-text-muted)]">
        이미지·파일 첨부는 페이지를 먼저 저장한 뒤 가능합니다.
      </div>
      <WikiEditor initialContent={seed} onChange={setContent} />
    </div>
  )
}
