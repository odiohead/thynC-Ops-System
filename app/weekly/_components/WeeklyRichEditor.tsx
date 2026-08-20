'use client'

// 주간업무 전용 컴팩트 리치 에디터 (Tiptap) — 금주 진행 셀·주간 특이사항 공용 (2026-08-20)
// 마크다운 입력 규칙(**굵게**, - 목록, 1. 목록 등) + 글자색·형광펜 지원. 저장 형식은 HTML 문자열.
// 기존 plain text 데이터는 plainToHtml로 승격해 편집한다.
import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { TextStyle, Color, BackgroundColor } from '@tiptap/extension-text-style'

/** plain text(구 데이터) → 문단 HTML 승격. 이미 HTML이면 그대로 */
export function toEditableHtml(content: string): string {
  if (!content || content.trimStart().startsWith('<')) return content
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return content
    .split('\n')
    .map((line) => (line.trim() ? `<p>${esc(line)}</p>` : '<p></p>'))
    .join('')
}

const TEXT_COLORS: { label: string; value: string | null }[] = [
  { label: '기본', value: null },
  { label: '빨강', value: '#dc2626' },
  { label: '주황', value: '#ea580c' },
  { label: '갈색', value: '#a16207' },
  { label: '초록', value: '#16a34a' },
  { label: '파랑', value: '#2563eb' },
  { label: '보라', value: '#7c3aed' },
  { label: '회색', value: '#6b7280' },
]

const HIGHLIGHT_COLORS: { label: string; value: string | null }[] = [
  { label: '없음', value: null },
  { label: '노랑', value: '#fef08a' },
  { label: '초록', value: '#bbf7d0' },
  { label: '파랑', value: '#bfdbfe' },
  { label: '분홍', value: '#fbcfe8' },
  { label: '주황', value: '#fed7aa' },
]

interface Props {
  initial: string
  placeholder?: string
  onChange: (html: string) => void
  onEscape?: () => void
}

function ToolBtn({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void
  active?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      className={`rounded px-1.5 py-0.5 text-xs font-medium transition-colors ${
        active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

/** 색상 팔레트 드롭다운 — 글자색/형광펜 공용 */
function ColorMenu({
  title,
  icon,
  colors,
  onPick,
}: {
  title: string
  icon: React.ReactNode
  colors: { label: string; value: string | null }[]
  onPick: (color: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={title}
        onMouseDown={(e) => {
          e.preventDefault()
          setOpen((v) => !v)
        }}
        className="rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {icon}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 flex gap-1 rounded-md border border-border bg-popover p-1.5 shadow-md">
          {colors.map((c) => (
            <button
              key={c.label}
              type="button"
              title={c.label}
              onMouseDown={(e) => {
                e.preventDefault()
                onPick(c.value)
                setOpen(false)
              }}
              className="h-5 w-5 rounded border border-border text-[10px] leading-none"
              style={c.value ? { backgroundColor: c.value } : undefined}
            >
              {!c.value && '×'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function WeeklyRichEditor({ initial, placeholder, onChange, onEscape }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false }),
      TextStyle,
      Color,
      BackgroundColor,
      Placeholder.configure({ placeholder: placeholder ?? '내용을 입력하세요' }),
    ],
    content: toEditableHtml(initial),
    autofocus: 'end',
    editorProps: {
      attributes: { class: 'weekly-rich' },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Escape' && !event.isComposing && onEscape) {
          onEscape()
          return true
        }
        return false
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML())
    },
    immediatelyRender: false,
  })

  if (!editor) return <div className="min-h-[5rem] rounded-md border border-border bg-card" />

  return (
    <div className="weekly-rich-editor overflow-hidden rounded-md border border-input bg-card focus-within:ring-2 focus-within:ring-ring">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/50 px-1.5 py-1">
        <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="굵게 (**텍스트**)">
          <strong>B</strong>
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="기울임">
          <em>I</em>
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="밑줄">
          <span className="underline">U</span>
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="취소선">
          <span className="line-through">S</span>
        </ToolBtn>
        <span className="mx-0.5 select-none text-border">|</span>
        <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="목록 (- 입력)">
          ≡
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="번호 목록 (1. 입력)">
          1.
        </ToolBtn>
        <span className="mx-0.5 select-none text-border">|</span>
        <ColorMenu
          title="글자색"
          icon={<span style={{ color: '#dc2626' }}>A</span>}
          colors={TEXT_COLORS}
          onPick={(c) =>
            c ? editor.chain().focus().setColor(c).run() : editor.chain().focus().unsetColor().run()
          }
        />
        <ColorMenu
          title="형광펜"
          icon={<span className="rounded-sm bg-yellow-200 px-0.5 text-foreground dark:text-background">A</span>}
          colors={HIGHLIGHT_COLORS}
          onPick={(c) =>
            c
              ? editor.chain().focus().setBackgroundColor(c).run()
              : editor.chain().focus().unsetBackgroundColor().run()
          }
        />
        <span className="mx-0.5 select-none text-border">|</span>
        <ToolBtn onClick={() => editor.chain().focus().unsetAllMarks().run()} title="서식 지우기">
          지우기
        </ToolBtn>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
