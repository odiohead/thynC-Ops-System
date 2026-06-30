'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  useCreateBlockNote,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from '@blocknote/react'
import { BlockNoteView } from '@blocknote/ariakit'
import {
  filterSuggestionItems,
  type PartialBlock,
} from '@blocknote/core'
import {
  getMultiColumnSlashMenuItems,
  multiColumnDropCursor,
  locales as multiColumnLocales,
} from '@blocknote/xl-multi-column'
import { en as coreLocaleEn } from '@blocknote/core/locales'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { wikiSchema } from '@/lib/wiki/wikiSchema'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/ariakit/style.css'

/** 협업 WebSocket 서버 URL 결정 — 로컬은 별도 포트(1234), 운영은 같은 호스트의 /collab (Nginx 프록시) */
function collabWsUrl(): string {
  const env = process.env.NEXT_PUBLIC_WIKI_COLLAB_URL
  if (env) return env
  if (typeof window !== 'undefined') {
    const { protocol, hostname, host } = window.location
    if (hostname === 'localhost' || hostname === '127.0.0.1') return 'ws://localhost:1234'
    return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}/collab`
  }
  return 'ws://localhost:1234'
}

// 기존 페이지 링크 선택 모달
// /api/wiki/search 로 기존 위키 페이지를 검색해 wikiPageLink 블록으로 삽입
// ──────────────────────────────────────────────────────────
type WikiSearchResult = { id: string; title: string; snippet: string | null }

function WikiPageLinkPicker({
  onSelect,
  onClose,
}: {
  onSelect: (page: { id: string; title: string }) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<WikiSearchResult[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const term = q.trim()
    if (!term) {
      setResults([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/wiki/search?q=${encodeURIComponent(term)}`)
        if (!res.ok) {
          if (!cancelled) setResults([])
          return
        }
        const data = await res.json()
        if (!cancelled) setResults((data.results as WikiSearchResult[]) ?? [])
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [q])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b p-3">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
            }}
            placeholder="연결할 페이지 제목·내용 검색…"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {loading && <div className="p-3 text-sm text-gray-400">검색 중…</div>}
          {!loading && q.trim() && results.length === 0 && (
            <div className="p-3 text-sm text-gray-400">검색 결과 없음</div>
          )}
          {!loading && !q.trim() && (
            <div className="p-3 text-sm text-gray-400">제목 또는 본문 내용으로 검색하세요.</div>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => onSelect({ id: r.id, title: r.title })}
              className="block w-full rounded px-3 py-2 text-left hover:bg-blue-50"
            >
              <span className="text-sm">
                <span className="mr-2">📄</span>
                <span className="font-medium text-gray-800">{r.title || '(빈 제목)'}</span>
              </span>
              {r.snippet && (
                <span className="mt-0.5 block truncate text-xs text-gray-400">{r.snippet}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

type CollabConfig = {
  pageId: string
  userName: string
  userColor: string
}

type Props = {
  initialContent?: PartialBlock[]
  editable?: boolean
  onChange?: (blocks: unknown[]) => void
  pageId?: string
  /** 하위페이지/링크 삽입 등 즉시 영속화가 필요할 때 부모의 저장을 호출 */
  onSaveNow?: () => Promise<void>
  /** 설정 시 실시간 동시편집(Yjs) 모드 — 본문은 Y.Doc이 진실의 원천이므로 initialContent 미사용 */
  collab?: CollabConfig
  /** 협업 서버에 일정 시간 내 연결하지 못하면 호출 — 부모가 읽기전용 폴백으로 전환 */
  onCollabUnavailable?: () => void
}

export default function WikiEditor({
  initialContent,
  editable = true,
  onChange,
  pageId,
  onSaveNow,
  collab,
  onCollabUnavailable,
}: Props) {
  const router = useRouter()
  const [linkPickerOpen, setLinkPickerOpen] = useState(false)
  // 링크 삽입 위치 — 모달이 열려 있는 동안 커서가 이동·소실될 수 있으므로 슬래시 클릭 시점에 고정
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingBlockRef = useRef<any>(null)

  // ── 실시간 협업 provider (collab 모드에서만 1회 생성) ──────────
  const [provider] = useState<HocuspocusProvider | null>(() =>
    collab
      ? new HocuspocusProvider({
          url: collabWsUrl(),
          name: collab.pageId,
          document: new Y.Doc(),
        })
      : null,
  )
  const [collabStatus, setCollabStatus] = useState<'connecting' | 'connected' | 'disconnected'>(
    'connecting',
  )
  useEffect(() => {
    if (!provider) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onStatus = (e: any) => setCollabStatus(e.status)
    provider.on('status', onStatus)
    return () => {
      provider.off('status', onStatus)
      provider.destroy()
    }
  }, [provider])

  // 협업 서버에 일정 시간 내 한 번도 연결되지 못하면 폴백(읽기전용 스냅샷)으로 전환 요청
  const collabFailedRef = useRef(false)
  useEffect(() => {
    if (!collab || collabStatus === 'connected') return
    const t = setTimeout(() => {
      // 이 타이머는 collabStatus가 'connected'가 아닐 때만 등록되며,
      // 연결되면 effect cleanup으로 해제된다. 발화 = 제한시간 내 미연결.
      if (!collabFailedRef.current) {
        collabFailedRef.current = true
        onCollabUnavailable?.()
      }
    }, 8000)
    return () => clearTimeout(t)
  }, [collab, collabStatus, onCollabUnavailable])

  const uploadFile = pageId
    ? async (file: File): Promise<string> => {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch(`/api/wiki/upload?pageId=${pageId}`, {
          method: 'POST',
          body: formData,
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `업로드 실패 (${res.status})`)
        }
        const data = await res.json()
        return data.url as string
      }
    : undefined

  const editor = useCreateBlockNote({
    schema: wikiSchema,
    dropCursor: multiColumnDropCursor,
    dictionary: { ...coreLocaleEn, multi_column: multiColumnLocales.ko },
    uploadFile,
    // 협업 모드: Y.Doc 동기화. 비협업: 기존 initialContent
    ...(collab && provider
      ? {
          collaboration: {
            provider: { awareness: provider.awareness ?? undefined },
            fragment: provider.document.getXmlFragment('prosemirror'),
            user: { name: collab.userName || '익명', color: collab.userColor },
            showCursorLabels: 'activity' as const,
          },
        }
      : {
          initialContent:
            initialContent && initialContent.length > 0
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ? (initialContent as any)
              : undefined,
        }),
  })

  // 검색 모달에서 기존 페이지 선택 → wikiPageLink 블록 삽입 (신규 생성 없음)
  const handleLinkSelect = async (page: { id: string; title: string }) => {
    setLinkPickerOpen(false)
    const cursorBlock = pendingBlockRef.current ?? editor.getTextCursorPosition().block
    pendingBlockRef.current = null
    editor.insertBlocks(
      [
        {
          type: 'wikiPageLink',
          props: { pageId: page.id, title: page.title },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any,
      cursorBlock,
      'after',
    )
    // 삽입 블록이 메모리에만 있어 이탈 시 유실되므로 부모의 즉시저장 호출
    onChange?.(editor.document as unknown[])
    if (onSaveNow) {
      await onSaveNow()
      router.refresh()
    }
  }

  return (
    <>
    {collab && (
      <div className="mb-2 flex items-center gap-1.5 text-[11px] text-[var(--wiki-text-muted)]">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            collabStatus === 'connected'
              ? 'bg-green-500'
              : collabStatus === 'connecting'
                ? 'bg-amber-400'
                : 'bg-red-500'
          }`}
        />
        {collabStatus === 'connected'
          ? '실시간 협업 연결됨'
          : collabStatus === 'connecting'
            ? '협업 서버 연결 중…'
            : '협업 연결 끊김 — 재연결 시도 중'}
      </div>
    )}
    <BlockNoteView
      editor={editor}
      editable={editable}
      slashMenu={false}
      onChange={() => {
        if (onChange) onChange(editor.document as unknown[])
      }}
    >
      {/* 슬래시 메뉴: 기본 + "하위 페이지 추가" */}
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) => {
          const items: DefaultReactSuggestionItem[] = [
            ...getDefaultReactSlashMenuItems(editor),
            ...getMultiColumnSlashMenuItems(editor),
          ]
          if (pageId) {
            items.push({
              title: '하위 페이지 추가',
              subtext: '새 자식 페이지를 만들고 본문에 링크 블록 삽입',
              aliases: ['page', 'subpage', 'child', '하위', '페이지', '서브'],
              group: '위키',
              icon: <span>📄</span>,
              onItemClick: async () => {
                const newTitle = window.prompt('하위 페이지 제목을 입력하세요.', '새 페이지')
                if (!newTitle || !newTitle.trim()) return
                try {
                  const res = await fetch('/api/wiki/pages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      title: newTitle.trim(),
                      parentId: pageId,
                      contentJson: [],
                    }),
                  })
                  if (!res.ok) {
                    const err = await res.json().catch(() => ({}))
                    alert(err.error || `하위 페이지 생성 실패 (${res.status})`)
                    return
                  }
                  const { id: newId } = await res.json()
                  const cursor = editor.getTextCursorPosition()
                  editor.insertBlocks(
                    [
                      {
                        type: 'wikiPageLink',
                        props: { pageId: newId, title: newTitle.trim() },
                      },
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ] as any,
                    cursor.block,
                    'after',
                  )
                  // 링크 블록은 에디터 메모리에만 존재 → 저장 전 이탈 시 유실되므로 부모 본문 즉시 저장
                  onChange?.(editor.document as unknown[])
                  if (onSaveNow) await onSaveNow()
                  // 사이드바 트리에 새 하위 페이지 즉시 반영
                  router.refresh()
                } catch (e) {
                  alert((e as Error).message)
                }
              },
            })
          }
          items.push({
            title: '기존 페이지 링크',
            subtext: '이미 있는 위키 페이지를 검색해 링크로 삽입',
            aliases: ['link', 'pagelink', 'ref', '링크', '페이지링크', '참조', '연결'],
            group: '위키',
            icon: <span>🔗</span>,
            onItemClick: () => {
              pendingBlockRef.current = editor.getTextCursorPosition().block
              setLinkPickerOpen(true)
            },
          })
          items.push({
            title: '콜아웃',
            subtext: '아이콘 + 배경색 강조 박스',
            aliases: ['callout', 'note', 'info', '콜아웃', '강조', '안내'],
            group: '기본 블록',
            icon: <span>💡</span>,
            onItemClick: () => {
              const cur = editor.getTextCursorPosition().block
              editor.insertBlocks(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                [{ type: 'callout', props: { emoji: '💡', color: 'blue' } }] as any,
                cur,
                'after',
              )
            },
          })
          items.push({
            title: '구분선',
            subtext: '가로 구분선',
            aliases: ['divider', 'hr', 'rule', '구분', '구분선', '선'],
            group: '기본 블록',
            icon: <span>―</span>,
            onItemClick: () => {
              const cur = editor.getTextCursorPosition().block
              editor.insertBlocks(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                [{ type: 'divider' }] as any,
                cur,
                'after',
              )
            },
          })
          return filterSuggestionItems(items, query)
        }}
      />

      {/* @ 멘션 메뉴: 병원/프로젝트 검색 */}
      <SuggestionMenuController
        triggerCharacter="@"
        getItems={async (query) => {
          try {
            const res = await fetch(`/api/wiki/mention?q=${encodeURIComponent(query)}`)
            if (!res.ok) return []
            const data = await res.json()
            const items: Array<{ type: 'hospital' | 'project'; code: string; label: string }> =
              data.items ?? []
            return items.map<DefaultReactSuggestionItem>((item) => ({
              title: item.label,
              subtext: item.type === 'hospital' ? '병원' : '프로젝트',
              onItemClick: () => {
                editor.insertInlineContent([
                  {
                    type: 'mention',
                    props: { refType: item.type, refCode: item.code, label: item.label },
                  },
                  ' ',
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ] as any)
              },
              aliases: [item.code],
              group: item.type === 'hospital' ? '병원' : '프로젝트',
            }))
          } catch {
            return []
          }
        }}
      />
    </BlockNoteView>
      {linkPickerOpen && (
        <WikiPageLinkPicker
          onSelect={handleLinkSelect}
          onClose={() => {
            pendingBlockRef.current = null
            setLinkPickerOpen(false)
          }}
        />
      )}
    </>
  )
}
