'use client'

import { useState } from 'react'

interface Props {
  hospitalCode: string
  initialFolderId: string | null
}

function extractFolderId(input: string): string {
  const match = input.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : input.trim()
}

export default function DriveFolderRow({ hospitalCode, initialFolderId }: Props) {
  const [folderId, setFolderId] = useState<string | null>(initialFolderId)
  const [isCreating, setIsCreating] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    setIsCreating(true)
    setError(null)
    try {
      const res = await fetch(`/api/hospitals/${hospitalCode}/drive-folder`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '폴더 생성에 실패했습니다.')
      setFolderId(data.folderId)
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류')
    } finally {
      setIsCreating(false)
    }
  }

  function handleStartEdit() {
    setEditValue(folderId ?? '')
    setIsEditing(true)
    setError(null)
  }

  function handleCancelEdit() {
    setIsEditing(false)
    setError(null)
  }

  async function handleSaveEdit() {
    const parsed = extractFolderId(editValue)
    if (!parsed) {
      setError('폴더 ID 또는 Drive URL을 입력하세요.')
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/hospitals/${hospitalCode}/drive-folder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: parsed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '저장에 실패했습니다.')
      setFolderId(data.folderId)
      setIsEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-gray-400">드라이브 폴더</dt>
      <dd className="mt-1 text-sm text-gray-900">
        {isEditing ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                placeholder="폴더 ID 또는 Drive URL 입력"
                className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
                disabled={isSaving}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') handleCancelEdit(); }}
              />
              <button
                onClick={handleSaveEdit}
                disabled={isSaving}
                className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isSaving ? '저장 중…' : '저장'}
              </button>
              <button
                onClick={handleCancelEdit}
                disabled={isSaving}
                className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                취소
              </button>
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        ) : folderId ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="max-w-[180px] truncate font-mono text-xs text-gray-600" title={folderId}>{folderId}</span>
              <a
                href={`https://drive.google.com/drive/folders/${folderId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                열기
              </a>
              <button
                onClick={handleStartEdit}
                className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                수정
              </button>
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-gray-400">-</span>
              <button
                onClick={handleCreate}
                disabled={isCreating}
                className="flex items-center gap-1.5 rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isCreating && (
                  <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                )}
                {isCreating ? '생성 중…' : '폴더 생성'}
              </button>
              <button
                onClick={handleStartEdit}
                className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                ID 직접 입력
              </button>
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        )}
      </dd>
    </div>
  )
}
