'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { PartialBlock } from '@blocknote/core'
import WikiEditor from '../components/WikiEditor'
import MovePageModal from '../components/MovePageModal'
import ReferencePickerModal from './ReferencePickerModal'
import TagPicker, { type Tag } from './TagPicker'
import FavoriteButton from './FavoriteButton'
import VersionHistoryModal from './VersionHistoryModal'
import CommentSection from './CommentSection'

type Reference = {
  id: string
  refType: 'hospital' | 'project'
  refCode: string
  label: string
}

type Props = {
  id: string
  title: string
  parentId: string | null
  breadcrumb: { id: string; title: string }[]
  initialContent: PartialBlock[]
  author: string
  lastEditor: string
  updatedAt: string
  references: Reference[]
  tags: Tag[]
  favorited: boolean
  currentUserId: string
  currentUserRole: string
}

export default function WikiPageView({
  id,
  title: initialTitle,
  parentId,
  breadcrumb,
  initialContent,
  author,
  lastEditor,
  updatedAt,
  references,
  tags,
  favorited,
  currentUserId,
  currentUserRole,
}: Props) {
  const [showRefPicker, setShowRefPicker] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [showMove, setShowMove] = useState(false)
  const [showDuplicate, setShowDuplicate] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(initialTitle)
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
      const res = await fetch(`/api/wiki/pages/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), contentJson: content }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `저장 실패 (${res.status})`)
      }
      setEditing(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('이 페이지를 삭제하시겠습니까?')) return
    const res = await fetch(`/api/wiki/pages/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      alert(err.error || `삭제 실패 (${res.status})`)
      return
    }
    router.refresh()
    router.push('/wiki')
  }

  const addChild = () => {
    router.push(`/wiki/new?parentId=${id}`)
  }

  const handleDuplicate = async (includeChildren: boolean) => {
    if (duplicating) return
    setDuplicating(true)
    try {
      const res = await fetch(`/api/wiki/pages/${id}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeChildren }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data.error || `복제 실패 (${res.status})`)
        return
      }
      setShowDuplicate(false)
      router.refresh()
      router.push(`/wiki/${data.id}`)
    } finally {
      setDuplicating(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <nav className="mb-3 text-sm text-gray-500 flex items-center gap-1 flex-wrap">
        <Link href="/wiki" className="hover:underline">
          위키
        </Link>
        {breadcrumb.map((b) => (
          <span key={b.id} className="flex items-center gap-1">
            <span className="text-gray-300">/</span>
            <Link href={`/wiki/${b.id}`} className="hover:underline">
              {b.title}
            </Link>
          </span>
        ))}
      </nav>

      <div className="mb-6 flex items-center justify-between">
        {editing ? (
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1 text-2xl font-bold border-b border-gray-200 focus:border-blue-500 focus:outline-none py-2"
          />
        ) : (
          <h1 className="flex-1 flex items-center gap-2 text-2xl font-bold">
            <FavoriteButton pageId={id} initialFavorited={favorited} />
            <span>{title}</span>
          </h1>
        )}

        <div className="ml-4 flex gap-2">
          {editing ? (
            <>
              <button
                onClick={() => {
                  setEditing(false)
                  setTitle(initialTitle)
                  setError(null)
                }}
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
            </>
          ) : (
            <>
              <button
                onClick={() => setShowVersions(true)}
                className="px-3 py-2 text-sm border rounded hover:bg-gray-50"
                title="버전 히스토리"
              >
                🕘 버전
              </button>
              <button
                onClick={addChild}
                className="px-4 py-2 border rounded hover:bg-gray-50"
              >
                + 하위 페이지
              </button>
              <button
                onClick={() => setShowMove(true)}
                className="px-3 py-2 text-sm border rounded hover:bg-gray-50"
                title="다른 위치로 이동"
              >
                📂 이동
              </button>
              <button
                onClick={() => setShowDuplicate(true)}
                className="px-3 py-2 text-sm border rounded hover:bg-gray-50"
                title="페이지 복제"
              >
                ⧉ 복제
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 border border-red-300 text-red-600 rounded hover:bg-red-50"
              >
                삭제
              </button>
              <button
                onClick={() => setEditing(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                편집
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mb-3 text-sm text-gray-500">
        작성자: {author} · 최근 수정자: {lastEditor} ·{' '}
        {new Date(updatedAt).toLocaleString('ko-KR')}
      </div>

      <div className="mb-2">
        <TagPicker pageId={id} initialTags={tags} onChange={() => router.refresh()} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">관련 항목:</span>
        {references.length === 0 && (
          <span className="text-xs text-gray-400">아직 연결된 항목 없음</span>
        )}
        {references.map((r) => (
          <ReferenceChip
            key={r.id}
            pageId={id}
            reference={r}
            onRemoved={() => router.refresh()}
          />
        ))}
        <button
          onClick={() => setShowRefPicker(true)}
          className="text-xs px-2 py-0.5 border border-dashed border-gray-300 text-gray-600 rounded hover:bg-gray-50"
        >
          + 연결
        </button>
      </div>

      {showRefPicker && (
        <ReferencePickerModal
          pageId={id}
          onClose={() => setShowRefPicker(false)}
          onAdded={() => router.refresh()}
        />
      )}

      {showVersions && (
        <VersionHistoryModal pageId={id} onClose={() => setShowVersions(false)} />
      )}

      {showMove && (
        <MovePageModal
          pageId={id}
          currentParentId={parentId}
          onClose={() => setShowMove(false)}
          onMoved={() => router.refresh()}
        />
      )}

      {showDuplicate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !duplicating && setShowDuplicate(false)}
        >
          <div
            className="w-[400px] bg-white rounded-lg shadow-xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-gray-800 mb-2">페이지 복제</h3>
            <p className="text-sm text-gray-600 mb-4">
              &ldquo;{title}&rdquo; 페이지를 복제합니다. 하위 페이지도 함께 복제할까요?
              <br />
              <span className="text-xs text-gray-400">
                (댓글·버전 히스토리·첨부 파일은 복사되지 않습니다)
              </span>
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDuplicate(false)}
                disabled={duplicating}
                className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={() => handleDuplicate(false)}
                disabled={duplicating}
                className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
              >
                이 페이지만
              </button>
              <button
                onClick={() => handleDuplicate(true)}
                disabled={duplicating}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {duplicating ? '복제 중...' : '하위 포함 복제'}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded text-sm">
          {error}
        </div>
      )}

      <div className="border rounded p-4 min-h-[400px]">
        <WikiEditor
          initialContent={initialContent}
          editable={editing}
          onChange={editing ? setContent : undefined}
          pageId={id}
        />
      </div>

      {!editing && currentUserId && (
        <CommentSection
          pageId={id}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
        />
      )}
    </div>
  )
}

function ReferenceChip({
  pageId,
  reference,
  onRemoved,
}: {
  pageId: string
  reference: Reference
  onRemoved: () => void
}) {
  const [busy, setBusy] = useState(false)
  const href =
    reference.refType === 'hospital'
      ? `/hospitals/${reference.refCode}`
      : `/projects/${reference.refCode}`
  const colorClass =
    reference.refType === 'hospital'
      ? 'bg-blue-50 text-blue-800 border-blue-200'
      : 'bg-purple-50 text-purple-800 border-purple-200'
  const typeLabel = reference.refType === 'hospital' ? '병원' : '프로젝트'

  const remove = async () => {
    if (!confirm(`"${reference.label}" 연결을 해제하시겠습니까?`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/wiki/pages/${pageId}/references/${reference.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || `해제 실패 (${res.status})`)
      } else {
        onRemoved()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs border rounded ${colorClass}`}>
      <span className="opacity-60">[{typeLabel}]</span>
      <Link href={href} className="hover:underline">
        {reference.label}
      </Link>
      <button
        onClick={remove}
        disabled={busy}
        className="text-gray-500 hover:text-red-600 ml-1"
        aria-label="해제"
      >
        ×
      </button>
    </span>
  )
}
