'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import type { PartialBlock } from '@blocknote/core'
import { PageSkeleton } from '../components/ui/Skeleton'
import MovePageModal from '../components/MovePageModal'

// BlockNote는 렌더 중 window를 참조 → SSR 비안전. 클라이언트 전용으로 동적 로드
const WikiEditor = dynamic(() => import('../components/WikiEditor'), {
  ssr: false,
  loading: () => <PageSkeleton />,
})
import ReferencePickerModal from './ReferencePickerModal'
import TagPicker, { type Tag } from './TagPicker'
import FavoriteButton from './FavoriteButton'
import VersionHistoryModal from './VersionHistoryModal'
import CommentSection from './CommentSection'
import OverflowMenu from '../components/ui/OverflowMenu'
import WikiModal from '../components/ui/WikiModal'
import EmojiPicker from '../components/ui/EmojiPicker'
import TableOfContents, { extractHeadings, type Heading } from './TableOfContents'
import { useToast } from '../components/ui/Toast'

type Reference = {
  id: string
  refType: 'hospital' | 'project'
  refCode: string
  label: string
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'

type Props = {
  id: string
  title: string
  parentId: string | null
  breadcrumb: { id: string; title: string }[]
  initialContent: PartialBlock[]
  icon: string | null
  coverUrl: string | null
  coverOffsetY: number
  backlinks: { id: string; title: string; icon: string | null }[]
  author: string
  lastEditor: string
  updatedAt: string
  references: Reference[]
  tags: Tag[]
  favorited: boolean
  currentUserId: string
  currentUserRole: string
  currentUserName: string
  /** 프로젝트 이슈노트 보호 등급 — 'root'(시스템 카테고리) | 'issue'(이슈노트 페이지) | null */
  issueProtection: 'root' | 'issue' | null
}

/** 사용자 id로 안정적인 커서 색 생성 (협업 awareness용) */
function colorFromId(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
  return `hsl(${h}, 65%, 45%)`
}

export default function WikiPageView({
  id,
  title: initialTitle,
  parentId,
  breadcrumb,
  initialContent,
  icon: initialIcon,
  coverUrl: initialCoverUrl,
  coverOffsetY: initialCoverOffsetY,
  backlinks,
  author,
  lastEditor,
  updatedAt,
  references,
  tags,
  favorited,
  currentUserId,
  currentUserRole,
  currentUserName,
  issueProtection,
}: Props) {
  const router = useRouter()
  const toast = useToast()
  const editable = currentUserRole !== 'VIEWER'
  const isAdmin = currentUserRole === 'ADMIN' || currentUserRole === 'SUPER_ADMIN'
  // 모든 페이지 실시간 협업 기본. 협업 서버 연결 실패 시 스냅샷 읽기전용으로 폴백.
  const [collabFailed, setCollabFailed] = useState(false)
  const collabActive = !collabFailed

  const [showRefPicker, setShowRefPicker] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [showMove, setShowMove] = useState(false)
  const [showDuplicate, setShowDuplicate] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [duplicating, setDuplicating] = useState(false)

  const [title, setTitle] = useState(initialTitle)
  const [icon, setIcon] = useState<string | null>(initialIcon)
  const [coverUrl, setCoverUrl] = useState<string | null>(initialCoverUrl)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [headings, setHeadings] = useState<Heading[]>(() => extractHeadings(initialContent))

  // 저장 로직은 최신값을 ref로 참조 (디바운스 타이머의 stale closure 방지)
  const titleRef = useRef(initialTitle)
  const contentRef = useRef<unknown[]>(initialContent as unknown[])
  const baseUpdatedAtRef = useRef(updatedAt)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)
  const dirtyRef = useRef(false)

  const coverInputRef = useRef<HTMLInputElement>(null)

  const doSave = useCallback(
    async (extra?: { icon?: string | null; coverUrl?: string | null; coverOffsetY?: number }) => {
      if (!editable) return
      if (inFlightRef.current) {
        dirtyRef.current = true
        return
      }
      inFlightRef.current = true
      setStatus('saving')
      try {
        // 본문(contentJson)은 협업 서버가 Y.Doc에서 저장하므로 제목/메타만 PUT.
        // baseUpdatedAt 생략 → 협업 서버의 잦은 updatedAt 갱신과 충돌(409) 방지.
        const res = await fetch(`/api/wiki/pages/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: titleRef.current, ...extra }),
        })
        if (res.status === 409) {
          setStatus('conflict')
          return
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          setStatus('error')
          toast.error(err.error || `저장 실패 (${res.status})`)
          return
        }
        const data = await res.json()
        if (data.updatedAt) baseUpdatedAtRef.current = data.updatedAt
        setStatus('saved')
      } catch (e) {
        setStatus('error')
        toast.error(e instanceof Error ? e.message : '저장 실패')
      } finally {
        inFlightRef.current = false
        if (dirtyRef.current) {
          dirtyRef.current = false
          void doSave()
        }
      }
    },
    [editable, id, toast],
  )

  const scheduleSave = useCallback(() => {
    if (!editable) return
    setStatus('saving')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void doSave(), 1500)
  }, [editable, doSave])

  // 언마운트 시 대기 중인 저장 flush
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const onTitleChange = (v: string) => {
    setTitle(v)
    titleRef.current = v
    scheduleSave()
  }

  const onContentChange = (blocks: unknown[]) => {
    contentRef.current = blocks
    setHeadings(extractHeadings(blocks))
    // 본문 저장은 협업 서버(Y.Doc)가 담당 → 여기서 자동저장(PUT) 안 함. TOC만 갱신.
  }

  // 에디터 인라인 작업(하위페이지/링크 삽입)에서 즉시 저장
  const saveNow = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    await doSave()
  }, [doSave])

  const handleSelectIcon = (emoji: string | null) => {
    setShowEmoji(false)
    setIcon(emoji)
    void doSave({ icon: emoji })
  }

  const handleCoverFile = async (file: File) => {
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/wiki/upload?pageId=${id}`, { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || `커버 업로드 실패 (${res.status})`)
        return
      }
      const data = await res.json()
      setCoverUrl(data.url)
      void doSave({ coverUrl: data.url })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '커버 업로드 실패')
    }
  }

  const removeCover = () => {
    setCoverUrl(null)
    void doSave({ coverUrl: null })
  }


  const handleDelete = async () => {
    if (!confirm('이 페이지를 삭제하시겠습니까?')) return
    const res = await fetch(`/api/wiki/pages/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast.error(err.error || `삭제 실패 (${res.status})`)
      return
    }
    router.refresh()
    router.push('/wiki')
  }

  const addChild = () => {
    router.push(`/wiki/new?parentId=${id}`)
  }

  const handleSaveAsTemplate = async () => {
    try {
      const dup = await fetch(`/api/wiki/pages/${id}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeChildren: false }),
      })
      const dupData = await dup.json().catch(() => ({}))
      if (!dup.ok) {
        toast.error(dupData.error || '템플릿 저장 실패')
        return
      }
      await fetch(`/api/wiki/pages/${dupData.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isTemplate: true, title: `${title || '제목 없음'} (템플릿)` }),
      })
      toast.success('템플릿으로 저장되었습니다')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '템플릿 저장 실패')
    }
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
        toast.error(data.error || `복제 실패 (${res.status})`)
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
    <div className="pb-24">
      {/* 커버 */}
      {coverUrl ? (
        <div className="group relative h-48 w-full overflow-hidden bg-[var(--wiki-bg-sunken)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={coverUrl}
            alt="커버"
            className="h-full w-full object-cover"
            style={{ objectPosition: `center ${initialCoverOffsetY}%` }}
          />
          {editable && (
            <div className="absolute bottom-2 right-3 hidden gap-1.5 group-hover:flex">
              <button
                onClick={() => coverInputRef.current?.click()}
                className="rounded-[6px] bg-black/55 px-2.5 py-1 text-xs text-white backdrop-blur transition hover:bg-black/70"
              >
                커버 변경
              </button>
              <button
                onClick={removeCover}
                className="rounded-[6px] bg-black/55 px-2.5 py-1 text-xs text-white backdrop-blur transition hover:bg-black/70"
              >
                제거
              </button>
            </div>
          )}
        </div>
      ) : null}

      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleCoverFile(f)
          e.target.value = ''
        }}
      />

      <div className={`wiki-content ${coverUrl ? 'pt-4' : 'pt-7'}`}>
        <div className="flex items-center justify-between gap-3">
          <nav className="flex flex-wrap items-center gap-1 text-sm text-[var(--wiki-text-muted)]">
            <Link href="/wiki" className="transition hover:text-[var(--wiki-text)]">
              위키
            </Link>
            {breadcrumb.map((b) => (
              <span key={b.id} className="flex items-center gap-1">
                <span className="text-[var(--wiki-border-strong)]">/</span>
                <Link href={`/wiki/${b.id}`} className="transition hover:text-[var(--wiki-text)]">
                  {b.title}
                </Link>
              </span>
            ))}
          </nav>
          {/* 제목/메타 저장 상태만 표시 (본문은 협업 서버가 실시간 저장) */}
          {status === 'saving' || status === 'error' ? (
            <SaveIndicator status={status} editable={editable} onRefresh={() => router.refresh()} />
          ) : null}
        </div>

        {/* 아이콘 + 커버 추가 영역 */}
        <div className="relative mt-3 flex items-center gap-2">
          {icon ? (
            <button
              onClick={() => editable && setShowEmoji((s) => !s)}
              className="rounded-[8px] text-5xl leading-none transition hover:bg-[var(--wiki-hover)]"
              title={editable ? '아이콘 변경' : undefined}
            >
              {icon}
            </button>
          ) : (
            editable && (
              <button
                onClick={() => setShowEmoji((s) => !s)}
                className="rounded-[6px] px-2 py-1 text-xs text-[var(--wiki-text-muted)] opacity-70 transition hover:bg-[var(--wiki-hover)] hover:opacity-100"
              >
                😀 아이콘 추가
              </button>
            )
          )}
          {editable && !coverUrl && (
            <button
              onClick={() => coverInputRef.current?.click()}
              className="rounded-[6px] px-2 py-1 text-xs text-[var(--wiki-text-muted)] opacity-70 transition hover:bg-[var(--wiki-hover)] hover:opacity-100"
            >
              🖼️ 커버 추가
            </button>
          )}
          {showEmoji && (
            <div className="absolute left-0 top-full z-40">
              <EmojiPicker onSelect={handleSelectIcon} onClose={() => setShowEmoji(false)} />
            </div>
          )}
        </div>

        {/* 제목 + 액션 */}
        <div className="mt-2 flex items-start justify-between gap-4">
          {editable && issueProtection !== 'root' ? (
            <div className="flex flex-1 items-center gap-2.5">
              <FavoriteButton pageId={id} initialFavorited={favorited} />
              <input
                type="text"
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                placeholder="제목 없음"
                className="wiki-page-title flex-1 border-none bg-transparent py-1 focus:outline-none"
              />
            </div>
          ) : (
            <h1 className="wiki-page-title flex flex-1 items-center gap-2.5">
              <FavoriteButton pageId={id} initialFavorited={favorited} />
              <span>{title || '제목 없음'}</span>
            </h1>
          )}

          <div className="flex shrink-0 items-center gap-2 pt-1.5">
            {editable && issueProtection !== 'root' && (
              <button
                onClick={addChild}
                className="rounded-[6px] border border-[var(--wiki-border)] px-3 py-2 text-sm text-[var(--wiki-text-soft)] transition hover:bg-[var(--wiki-hover)] hover:text-[var(--wiki-text)]"
              >
                + 하위 페이지
              </button>
            )}
            <OverflowMenu
              items={[
                { label: '버전 기록', icon: '🕘', onClick: () => setShowVersions(true) },
                // 프로젝트 이슈노트 보호 — 루트: 이동·복제·템플릿·삭제 전부 숨김,
                // 이슈노트 페이지: 이동·템플릿 숨김, 삭제는 ADMIN 이상만 (서버도 동일 검증)
                ...(editable && issueProtection !== 'root'
                  ? [
                      ...(issueProtection !== 'issue'
                        ? [{ label: '다른 위치로 이동', icon: '📂', onClick: () => setShowMove(true) }]
                        : []),
                      { label: '페이지 복제', icon: '⧉', onClick: () => setShowDuplicate(true) },
                      ...(issueProtection !== 'issue'
                        ? [{ label: '템플릿으로 저장', icon: '📐', onClick: handleSaveAsTemplate }]
                        : []),
                      ...(issueProtection !== 'issue' || isAdmin
                        ? [{ label: '삭제', icon: '🗑', onClick: handleDelete, danger: true }]
                        : []),
                    ]
                  : []),
              ]}
            />
          </div>
        </div>

        <div className="mt-2 text-sm text-[var(--wiki-text-muted)]">
          작성자: {author} · 최근 수정자: {lastEditor} ·{' '}
          {new Date(updatedAt).toLocaleString('ko-KR')}
        </div>

        <div className="mt-3">
          <TagPicker pageId={id} initialTags={tags} onChange={() => router.refresh()} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--wiki-text-muted)]">관련 항목:</span>
          {references.length === 0 && (
            <span className="text-xs text-[var(--wiki-text-muted)]">아직 연결된 항목 없음</span>
          )}
          {references.map((r) => (
            <ReferenceChip key={r.id} pageId={id} reference={r} onRemoved={() => router.refresh()} />
          ))}
          {editable && (
            <button
              onClick={() => setShowRefPicker(true)}
              className="rounded-[4px] border border-dashed border-[var(--wiki-border-strong)] px-2 py-0.5 text-xs text-[var(--wiki-text-soft)] transition hover:bg-[var(--wiki-hover)]"
            >
              + 연결
            </button>
          )}
        </div>

        {status === 'conflict' && (
          <div className="mt-4 flex items-center justify-between rounded-[6px] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <span>다른 곳에서 이 페이지가 수정되었습니다. 최신 내용을 불러오세요.</span>
            <button
              onClick={() => router.refresh()}
              className="ml-3 shrink-0 rounded-[6px] border border-amber-300 bg-white px-3 py-1 text-xs font-medium transition hover:bg-amber-100"
            >
              새로고침
            </button>
          </div>
        )}
      </div>

      <TableOfContents headings={headings} />

      <div className="wiki-content mt-5">
        {collabFailed && (
          <div className="mb-3 rounded-[6px] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            실시간 협업 서버에 연결할 수 없어 <strong>읽기 전용</strong>으로 표시합니다. 잠시 후
            <button
              onClick={() => router.refresh()}
              className="mx-1 rounded border border-amber-300 bg-white px-2 py-0.5 text-xs font-medium transition hover:bg-amber-100"
            >
              새로고침
            </button>
            하면 다시 편집할 수 있습니다.
          </div>
        )}
        {collabActive ? (
          <WikiEditor
            key="collab"
            editable={editable}
            onChange={onContentChange}
            onSaveNow={saveNow}
            pageId={id}
            collab={{ pageId: id, userName: currentUserName, userColor: colorFromId(currentUserId) }}
            onCollabUnavailable={() => setCollabFailed(true)}
          />
        ) : (
          <WikiEditor key="legacy" initialContent={initialContent} editable={false} pageId={id} />
        )}
      </div>

      {backlinks.length > 0 && (
        <div className="wiki-content mt-8 border-t border-[var(--wiki-border)] pt-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--wiki-text-muted)]">
            🔗 이 페이지를 링크한 페이지 ({backlinks.length})
          </h3>
          <ul className="flex flex-wrap gap-2">
            {backlinks.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/wiki/${b.id}`}
                  className="inline-flex items-center gap-1.5 rounded-[6px] border border-[var(--wiki-border)] bg-[var(--wiki-bg)] px-2.5 py-1 text-sm text-[var(--wiki-text-soft)] transition hover:bg-[var(--wiki-hover)] hover:text-[var(--wiki-text)]"
                >
                  <span className="text-sm leading-none">{b.icon || '📄'}</span>
                  <span>{b.title || '제목 없음'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {currentUserId && (
        <div className="wiki-content mt-8 border-t border-[var(--wiki-border)] pt-6">
          <CommentSection
            pageId={id}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
          />
        </div>
      )}

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

      <WikiModal
        open={showDuplicate}
        onClose={() => !duplicating && setShowDuplicate(false)}
        title="페이지 복제"
        width={420}
        footer={
          <>
            <button
              onClick={() => setShowDuplicate(false)}
              disabled={duplicating}
              className="rounded-[6px] border border-[var(--wiki-border)] px-3 py-1.5 text-sm transition hover:bg-[var(--wiki-hover)] disabled:opacity-50"
            >
              취소
            </button>
            <button
              onClick={() => handleDuplicate(false)}
              disabled={duplicating}
              className="rounded-[6px] border border-[var(--wiki-border)] px-3 py-1.5 text-sm transition hover:bg-[var(--wiki-hover)] disabled:opacity-50"
            >
              이 페이지만
            </button>
            <button
              onClick={() => handleDuplicate(true)}
              disabled={duplicating}
              className="rounded-[6px] bg-[var(--wiki-accent)] px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-95 disabled:opacity-50"
            >
              {duplicating ? '복제 중...' : '하위 포함 복제'}
            </button>
          </>
        }
      >
        <div className="px-5 py-4 text-sm text-[var(--wiki-text-soft)]">
          &ldquo;{title}&rdquo; 페이지를 복제합니다. 하위 페이지도 함께 복제할까요?
          <br />
          <span className="text-xs text-[var(--wiki-text-muted)]">
            (댓글·버전 히스토리·첨부 파일은 복사되지 않습니다)
          </span>
        </div>
      </WikiModal>
    </div>
  )
}

function SaveIndicator({
  status,
  editable,
  onRefresh,
}: {
  status: SaveStatus
  editable: boolean
  onRefresh: () => void
}) {
  if (!editable) {
    return <span className="text-xs text-[var(--wiki-text-muted)]">읽기 전용</span>
  }
  if (status === 'saving') return <span className="text-xs text-[var(--wiki-text-muted)]">저장 중…</span>
  if (status === 'saved') return <span className="text-xs text-[var(--wiki-text-muted)]">저장됨 ✓</span>
  if (status === 'error') return <span className="text-xs text-red-500">저장 실패</span>
  if (status === 'conflict')
    return (
      <button onClick={onRefresh} className="text-xs text-amber-600 underline">
        충돌 — 새로고침
      </button>
    )
  return null
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
  const toast = useToast()
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
        toast.error(err.error || `해제 실패 (${res.status})`)
      } else {
        onRemoved()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs ${colorClass}`}>
      <span className="opacity-60">[{typeLabel}]</span>
      <Link href={href} className="hover:underline">
        {reference.label}
      </Link>
      <button
        onClick={remove}
        disabled={busy}
        className="ml-1 text-gray-500 hover:text-red-600"
        aria-label="해제"
      >
        ×
      </button>
    </span>
  )
}
