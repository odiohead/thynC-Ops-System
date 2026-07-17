'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import type { PartialBlock } from '@blocknote/core'
import '@/app/wiki/wiki-theme.css'

// BlockNote는 렌더 중 window를 참조 → SSR 비안전. 클라이언트 전용으로 동적 로드
const WikiEditor = dynamic(() => import('./WikiEditor'), {
  ssr: false,
  loading: () => (
    <div className="py-8 text-center text-sm text-gray-400">에디터 불러오는 중…</div>
  ),
})

/**
 * 프로젝트 이슈노트 임베드 패널 — 프로젝트 상세 페이지 전용
 *
 * 위키 시스템 카테고리 '프로젝트 이슈노트' 하위 페이지를 프로젝트 상세에 인라인 임베드한다.
 * - 페이지가 없으면 생성 버튼 노출 (USER 이상), 생성 시점에만 위키 페이지 발행 (빈 페이지 양산 방지)
 * - 편집은 위키 상세와 동일한 실시간 협업(Y.Doc) 모드 — 위키에서 동시에 열어도 내용 일치
 * - 협업 서버 연결 실패 시 스냅샷 읽기 전용 폴백 (위키 상세와 동일 동작)
 * - 메인 모듈과의 데이터 교환은 전부 HTTP(/api/wiki/*) — 위키 코드 import는 이 컴포넌트가 유일한 승인 예외
 */

type IssueNotePage = {
  id: string
  title: string
  contentJson: unknown
  updatedAt: string
  collabEnabled: boolean
  lastEditor: { name: string } | null
}

type Me = { userId: string; name: string; role: string }

/** 사용자 id로 안정적인 커서 색 생성 (협업 awareness용 — WikiPageView와 동일 규칙) */
function colorFromId(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
  return `hsl(${h}, 65%, 45%)`
}

export default function ProjectIssueNotePanel({ projectCode }: { projectCode: string }) {
  const [me, setMe] = useState<Me | null>(null)
  const [page, setPage] = useState<IssueNotePage | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collabFailed, setCollabFailed] = useState(false)

  const canWrite = !!me && me.role !== 'VIEWER'

  const load = useCallback(async () => {
    try {
      const [meRes, pageRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch(`/api/wiki/project-issue-notes?projectCode=${encodeURIComponent(projectCode)}`),
      ])
      if (meRes.ok) {
        const meData = await meRes.json()
        // /api/auth/me 응답 형태({user:{...}} 또는 평면)를 모두 수용
        const u = meData?.user ?? meData
        if (u?.userId || u?.id) {
          setMe({ userId: u.userId ?? u.id, name: u.name ?? '', role: u.role ?? 'VIEWER' })
        }
      }
      if (pageRes.ok) {
        const data = await pageRes.json()
        setPage((data?.page as IssueNotePage | null) ?? null)
      } else {
        const err = await pageRes.json().catch(() => ({}))
        setError(err.error || `이슈노트 조회 실패 (${pageRes.status})`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '이슈노트 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [projectCode])

  useEffect(() => {
    void load()
  }, [load])

  const handleCreate = async () => {
    if (creating) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/wiki/project-issue-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectCode }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error || `이슈노트 생성 실패 (${res.status})`)
        return
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '이슈노트 생성 실패')
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return <div className="py-6 text-center text-sm text-gray-400">이슈노트 불러오는 중…</div>
  }

  // ── 페이지 미생성 상태 ─────────────────────────────
  if (!page) {
    return (
      <div className="py-6 text-center">
        {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
        <p className="text-sm text-gray-500">아직 이슈노트가 없습니다.</p>
        {canWrite && (
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
          >
            {creating ? '생성 중...' : '+ 이슈노트 생성'}
          </button>
        )}
        <p className="mt-2 text-xs text-gray-400">
          생성하면 사내위키 &lsquo;프로젝트 이슈노트&rsquo;에 이 프로젝트 전용 페이지가 만들어집니다.
        </p>
      </div>
    )
  }

  // ── 페이지 임베드 (실시간 협업 편집) ─────────────────
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs text-gray-400">
          {page.lastEditor?.name && `최근 수정: ${page.lastEditor.name} · `}
          {new Date(page.updatedAt).toLocaleString('ko-KR')}
        </span>
        <a
          href={`/wiki/${page.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded px-2 py-1 text-xs text-blue-600 transition-colors hover:bg-blue-50"
        >
          위키에서 열기 ↗
        </a>
      </div>

      {collabFailed && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          실시간 협업 서버에 연결할 수 없어 <strong>읽기 전용</strong>으로 표시합니다. 잠시 후
          페이지를 새로고침하면 다시 편집할 수 있습니다.
        </div>
      )}

      <div className="wiki-root rounded-lg border border-gray-100">
        <div className="wiki-content py-2">
          {collabFailed || !me ? (
            <WikiEditor
              key="fallback"
              initialContent={(page.contentJson as PartialBlock[]) ?? []}
              editable={false}
              pageId={page.id}
            />
          ) : (
            <WikiEditor
              key="collab"
              editable={canWrite}
              pageId={page.id}
              collab={{
                pageId: page.id,
                userName: me.name,
                userColor: colorFromId(me.userId),
              }}
              onCollabUnavailable={() => setCollabFailed(true)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
