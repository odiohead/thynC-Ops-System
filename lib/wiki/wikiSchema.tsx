/**
 * 위키 BlockNote 스키마 (커스텀 블록 포함) — 클라이언트(에디터)와 협업 서버가 공유.
 *
 * 실시간 동시편집(Yjs)에서 Y.Doc ↔ BlockNote 블록 변환은 클라이언트와 서버가
 * **완전히 동일한 스키마**를 써야 한다(노드 타입/속성 불일치 시 변환 손상). 그래서
 * 스키마 정의를 한 곳에 두고 양쪽에서 import 한다.
 *
 * 주의: 이 모듈은 협업 서버(Node, ESM)에서도 import 된다. 따라서 @blocknote/ariakit·
 * BlockNoteView 등 브라우저 전용 코드를 import 하지 않는다. render 함수의 JSX는
 * 변환 시 실행되지 않으므로(구조 변환만 사용) Node에서도 안전하다.
 */
import {
  createReactBlockSpec,
  createReactInlineContentSpec,
} from '@blocknote/react'
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
} from '@blocknote/core'
import { withMultiColumn } from '@blocknote/xl-multi-column'

// ──────────────────────────────────────────────────────────
// 커스텀 블록: 위키 하위 페이지 링크
// ──────────────────────────────────────────────────────────
export const wikiPageLinkSpec = createReactBlockSpec(
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

export const wikiFileSpec = createReactBlockSpec(
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
// 커스텀 블록: 콜아웃 (아이콘 + 배경색 박스)
// ──────────────────────────────────────────────────────────
const CALLOUT_COLORS: Record<string, { bg: string; border: string }> = {
  blue: { bg: 'bg-blue-50', border: 'border-blue-200' },
  amber: { bg: 'bg-amber-50', border: 'border-amber-200' },
  green: { bg: 'bg-green-50', border: 'border-green-200' },
  red: { bg: 'bg-red-50', border: 'border-red-200' },
  gray: { bg: 'bg-gray-50', border: 'border-gray-200' },
}

export const calloutSpec = createReactBlockSpec(
  {
    type: 'callout',
    propSchema: {
      emoji: { default: '💡' },
      color: { default: 'blue' },
    },
    content: 'inline',
  },
  {
    render: (props) => {
      const { emoji, color } = props.block.props
      const c = CALLOUT_COLORS[color] ?? CALLOUT_COLORS.blue
      return (
        <div className={`my-1 flex items-start gap-2.5 rounded-[8px] border ${c.bg} ${c.border} px-3 py-2.5`}>
          <button
            contentEditable={false}
            type="button"
            onClick={() => {
              if (!props.editor.isEditable) return
              const next = window.prompt('콜아웃 이모지', emoji || '💡')
              if (next !== null) props.editor.updateBlock(props.block, { props: { emoji: next || '💡' } })
            }}
            className="mt-0.5 shrink-0 text-base leading-none"
            title="이모지 변경"
          >
            {emoji || '💡'}
          </button>
          <div className="min-w-0 flex-1 text-sm leading-relaxed" ref={props.contentRef} />
        </div>
      )
    },
  },
)()

// ──────────────────────────────────────────────────────────
// 커스텀 블록: 구분선
// ──────────────────────────────────────────────────────────
export const dividerSpec = createReactBlockSpec(
  {
    type: 'divider',
    propSchema: {},
    content: 'none',
  },
  {
    render: () => (
      <div contentEditable={false} className="my-2 select-none py-1">
        <hr className="border-t border-[var(--wiki-border-strong)]" />
      </div>
    ),
  },
)()

// ──────────────────────────────────────────────────────────
// 커스텀 인라인: @ mention (병원/프로젝트)
// ──────────────────────────────────────────────────────────
export const mentionSpec = createReactInlineContentSpec(
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
// 스키마: 기본 + 커스텀 (멀티컬럼 포함)
// ──────────────────────────────────────────────────────────
export const wikiSchema = withMultiColumn(
  BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      file: wikiFileSpec,
      wikiPageLink: wikiPageLinkSpec,
      callout: calloutSpec,
      divider: dividerSpec,
    },
    inlineContentSpecs: { ...defaultInlineContentSpecs, mention: mentionSpec },
  }),
)
