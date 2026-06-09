'use client'

import {
  useCreateBlockNote,
  createReactBlockSpec,
  createReactInlineContentSpec,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from '@blocknote/react'
import { BlockNoteView } from '@blocknote/ariakit'
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  filterSuggestionItems,
  type PartialBlock,
} from '@blocknote/core'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/ariakit/style.css'

// ──────────────────────────────────────────────────────────
// 커스텀 블록: 위키 하위 페이지 링크
// createReactBlockSpec은 팩토리를 반환 → BlockNoteSchema에 넣기 전에 호출
// ──────────────────────────────────────────────────────────
const wikiPageLinkSpec = createReactBlockSpec(
  {
    type: 'wikiPageLink',
    propSchema: {
      pageId: { default: '' },
      title: { default: '' },
    },
    content: 'none',
  },
  {
    render: (props) => {
      const { pageId, title } = props.block.props
      const href = pageId ? `/wiki/${pageId}` : '#'
      return (
        <a
          href={href}
          contentEditable={false}
          className="block my-1 px-3 py-2 border border-gray-200 rounded bg-gray-50 hover:bg-blue-50 text-sm text-gray-800 hover:text-blue-700 no-underline"
        >
          <span className="mr-2">📄</span>
          <span>{title || '(빈 제목)'}</span>
        </a>
      )
    },
  },
)()

// ──────────────────────────────────────────────────────────
// 커스텀 인라인: @ mention (병원/프로젝트)
// ──────────────────────────────────────────────────────────
const mentionSpec = createReactInlineContentSpec(
  {
    type: 'mention',
    propSchema: {
      refType: { default: 'hospital' },
      refCode: { default: '' },
      label: { default: '' },
    },
    content: 'none',
  },
  {
    render: (props) => {
      const { refType, refCode, label } = props.inlineContent.props
      const href = refType === 'project' ? `/projects/${refCode}` : `/hospitals/${refCode}`
      const color = refType === 'project' ? 'text-purple-700' : 'text-blue-700'
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={`${color} font-medium hover:underline mx-0.5`}
        >
          @{label}
        </a>
      )
    },
  },
)

// ──────────────────────────────────────────────────────────
// 스키마: 기본 + 커스텀
// ──────────────────────────────────────────────────────────
const wikiSchema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, wikiPageLink: wikiPageLinkSpec },
  inlineContentSpecs: { ...defaultInlineContentSpecs, mention: mentionSpec },
})

type Props = {
  initialContent?: PartialBlock[]
  editable?: boolean
  onChange?: (blocks: unknown[]) => void
  pageId?: string
}

export default function WikiEditor({
  initialContent,
  editable = true,
  onChange,
  pageId,
}: Props) {
  const editor = useCreateBlockNote({
    schema: wikiSchema,
    initialContent:
      initialContent && initialContent.length > 0
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (initialContent as any)
        : undefined,
    uploadFile: pageId
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
      : undefined,
  })

  return (
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
                } catch (e) {
                  alert((e as Error).message)
                }
              },
            })
          }
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
  )
}
