'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// ⚠️ 절대 import 금지: '@/app/wiki/*', '@/lib/wiki/*'
// 위키 모듈과는 HTTP fetch로만 통신 (CLAUDE.md 절대 규칙 #7)

type Page = {
  id: string
  title: string
  updatedAt: string
  isPublished: boolean
  author?: { name: string } | null
  lastEditor?: { name: string } | null
}

export default function RelatedWikiPagesCard({ hospitalCode }: { hospitalCode: string }) {
  const [pages, setPages] = useState<Page[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/wiki/pages?refType=hospital&refCode=${encodeURIComponent(hospitalCode)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setPages(data.pages ?? [])
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '조회 실패')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [hospitalCode])

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
        관련 위키 로딩 중...
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        위키 조회 실패: {error}
      </div>
    )
  }
  if (pages.length === 0) return null

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">관련 위키 ({pages.length})</h3>
      </div>
      <ul className="divide-y">
        {pages.map((p) => (
          <li key={p.id} className="py-2">
            <Link
              href={`/wiki/${p.id}`}
              className="text-sm text-blue-700 hover:underline"
              target="_blank"
            >
              {p.title}
            </Link>
            <div className="text-xs text-gray-500 mt-0.5">
              {p.lastEditor?.name ?? p.author?.name ?? '-'} ·{' '}
              {new Date(p.updatedAt).toLocaleString('ko-KR')}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
