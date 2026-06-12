'use client'

import { useRouter } from 'next/navigation'
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
// 커스텀 블록: 파일 첨부 카드
// 기본 file 블록과 type·propSchema가 동일 → 기존 저장 데이터 그대로 호환
// ──────────────────────────────────────────────────────────
const FILE_KIND: Record<string, { label: string; bg: string }> = {
  doc: { label: 'W', bg: 'bg-blue-600' },
  docx: { label: 'W', bg: 'bg-blue-600' },
  xls: { label: 'X', bg: 'bg-green-700' },
  xlsx: { label: 'X', bg: 'bg-green-700' },
  csv: { label: 'X', bg: 'bg-green-700' },
  ppt: { label: 'P', bg: 'bg-orange-600' },
  pptx: { label: 'P', bg: 'bg-orange-600' },
  pdf: { label: 'PDF', bg: 'bg-red-600' },
  hwp: { label: 'H', bg: 'bg-sky-600' },
  hwpx: { label: 'H', bg: 'bg-sky-600' },
  zip: { label: 'ZIP', bg: 'bg-amber-500' },
  rar: { label: 'ZIP', bg: 'bg-amber-500' },
  '7z': { label: 'ZIP', bg: 'bg-amber-500' },
  txt: { label: 'TXT', bg: 'bg-gray-500' },
  md: { label: 'MD', bg: 'bg-gray-500' },
}

function fileExt(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : ''
}

const wikiFileSpec = createReactBlockSpec(
  {
    type: 'file',
    propSchema: {
      backgroundColor: { default: 'default' },
      name: { default: '' },
      url: { default: '' },
      caption: { default: '' },
    },
    content: 'none',
  },
  {
    render: (props) => {
      const { name, url, caption } = props.block.props
      const editor = props.editor

      // 업로드 전(빈 블록): 편집 중이면 파일 선택 버튼, 읽기 모드면 안내만
      if (!url) {
        if (!editor.isEditable) {
          return (
            <div className="my-1 px-3 py-2 text-sm text-gray-400 border border-dashed border-gray-300 rounded-lg">
              📎 첨부된 파일 없음
            </div>
          )
        }
        return (
          <label
            contentEditable={false}
            className="flex items-center gap-2 my-1 px-3 py-2.5 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 cursor-pointer hover:bg-gray-50 hover:border-gray-400"
          >
            <span>📎</span>
            <span>파일 업로드</span>
            <input
              type="file"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file || !editor.uploadFile) return
                try {
                  const uploaded = await editor.uploadFile(file, props.block.id)
                  const newUrl =
                    typeof uploaded === 'string'
                      ? uploaded
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      : String((uploaded as any)?.props?.url ?? '')
                  editor.updateBlock(props.block, {
                    props: { url: newUrl, name: file.name },
                  })
                } catch (err) {
                  alert((err as Error).message)
                }
              }}
            />
          </label>
        )
      }

      const ext = fileExt(name || url)
      const kind = FILE_KIND[ext] ?? { label: '📄', bg: 'bg-gray-400' }
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          contentEditable={false}
          className="group/file flex items-center gap-3 my-1 px-3 py-2.5 border border-gray-200 rounded-lg bg-white shadow-sm hover:bg-gray-50 hover:border-gray-300 no-underline"
        >
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded ${kind.bg} text-white text-[11px] font-bold`}
          >
            {kind.label}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-blue-700 group-hover/file:underline">
              {name || url}
            </span>
            <span className="block text-[11px] text-gray-400">
              <span className="uppercase">{ext || 'FILE'}</span>
              {caption ? ` · ${caption}` : ''}
            </span>
          </span>
          <span className="shrink-0 text-gray-300 group-hover/file:text-gray-600" title="다운로드">
            ⬇
          </span>
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
  blockSpecs: { ...defaultBlockSpecs, file: wikiFileSpec, wikiPageLink: wikiPageLinkSpec },
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
  const router = useRouter()
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
                  // 링크 블록은 에디터 메모리에만 존재 → 저장 전 이탈 시 유실되므로 부모 본문 즉시 저장
                  const saveRes = await fetch(`/api/wiki/pages/${pageId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contentJson: editor.document }),
                  })
                  if (!saveRes.ok) {
                    const err = await saveRes.json().catch(() => ({}))
                    alert(err.error || `부모 페이지 저장 실패 (${saveRes.status})`)
                  }
                  // 사이드바 트리에 새 하위 페이지 즉시 반영
                  router.refresh()
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
