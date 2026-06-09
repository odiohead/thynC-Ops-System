'use client'

import { useEffect, useRef, useState } from 'react'

export type Tag = { id: string; name: string; color?: string | null }

type Props = {
  pageId: string
  initialTags: Tag[]
  onChange?: () => void
}

export default function TagPicker({ pageId, initialTags, onChange }: Props) {
  const [tags, setTags] = useState<Tag[]>(initialTags)
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Tag[]>([])
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!adding) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const res = await fetch(`/api/wiki/tags?q=${encodeURIComponent(query)}`)
      if (!res.ok) return
      const data = await res.json()
      const existing = new Set(tags.map((t) => t.id))
      setSuggestions((data.tags ?? []).filter((t: Tag) => !existing.has(t.id)).slice(0, 8))
    }, 150)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [query, adding, tags])

  const add = async (payload: { tagId?: string; name?: string }) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/wiki/pages/${pageId}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || `태그 추가 실패 (${res.status})`)
        return
      }
      const data = await res.json()
      if (data.tag) setTags((prev) => [...prev, data.tag])
      setQuery('')
      onChange?.()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (tagId: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/wiki/pages/${pageId}/tags?tagId=${tagId}`, { method: 'DELETE' })
      if (res.ok) {
        setTags((prev) => prev.filter((t) => t.id !== tagId))
        onChange?.()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-gray-500">태그:</span>
      {tags.length === 0 && !adding && (
        <span className="text-xs text-gray-400">없음</span>
      )}
      {tags.map((t) => (
        <span
          key={t.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded border"
          style={
            t.color
              ? { borderColor: t.color, color: t.color, background: `${t.color}10` }
              : { borderColor: '#d1d5db', color: '#374151', background: '#f9fafb' }
          }
        >
          #{t.name}
          <button
            onClick={() => remove(t.id)}
            disabled={busy}
            className="opacity-60 hover:opacity-100"
            aria-label="태그 제거"
          >
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && query.trim()) {
                e.preventDefault()
                add({ name: query.trim() })
              } else if (e.key === 'Escape') {
                setAdding(false)
                setQuery('')
              }
            }}
            onBlur={() => setTimeout(() => setAdding(false), 200)}
            placeholder="태그명 (엔터로 추가)"
            className="text-xs px-2 py-0.5 border rounded w-32"
            autoFocus
          />
          {suggestions.length > 0 && (
            <div className="absolute top-full left-0 mt-1 bg-white border rounded shadow-md text-xs min-w-[120px] z-10">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    add({ tagId: s.id })
                  }}
                  className="block w-full text-left px-2 py-1 hover:bg-blue-50"
                >
                  #{s.name}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={() => {
            setAdding(true)
            setQuery('')
          }}
          className="text-xs px-2 py-0.5 border border-dashed border-gray-300 text-gray-600 rounded hover:bg-gray-50"
        >
          + 태그
        </button>
      )}
    </div>
  )
}
