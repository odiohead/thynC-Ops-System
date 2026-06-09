'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import WikiEditor from '../components/WikiEditor'

export default function NewWikiPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const parentId = searchParams.get('parentId')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState<unknown[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        body: JSON.stringify({
          title: title.trim(),
          contentJson: content,
          parentId: parentId || null,
        }),
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

  return (
    <div className="max-w-5xl mx-auto p-6">
      {parentId && (
        <div className="mb-3 text-xs px-2 py-1 inline-block bg-blue-50 text-blue-700 rounded">
          하위 페이지로 추가됩니다
        </div>
      )}
      <div className="mb-6 flex items-center justify-between">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="페이지 제목"
          className="flex-1 text-2xl font-bold border-b border-gray-200 focus:border-blue-500 focus:outline-none py-2"
        />
        <div className="ml-4 flex gap-2">
          <button
            onClick={() => router.push('/wiki')}
            disabled={saving}
            className="px-4 py-2 border rounded hover:bg-gray-50 disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded text-sm">
          {error}
        </div>
      )}

      <div className="mb-2 text-xs text-gray-500">
        이미지·파일 첨부는 페이지를 먼저 저장한 뒤 가능합니다.
      </div>
      <div className="border rounded p-4 min-h-[400px]">
        <WikiEditor onChange={setContent} />
      </div>
    </div>
  )
}
