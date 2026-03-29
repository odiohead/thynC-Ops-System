'use client'

import { useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'

interface Props {
  value: string
  onChange: (html: string) => void
  placeholder?: string
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      disabled={disabled}
      title={title}
      className={`rounded px-2 py-1 text-sm font-medium transition-colors ${
        active
          ? 'bg-blue-100 text-blue-700'
          : 'text-gray-600 hover:bg-gray-100'
      } disabled:opacity-40`}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span className="mx-1 text-gray-200 select-none">|</span>
}

export default function RichTextEditor({ value, onChange, placeholder = '내용을 입력하세요...' }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-blue-600 underline cursor-pointer' },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder }),
      Typography,
    ],
    content: value || '',
    editable: true,
    editorProps: {
      attributes: {
        class: 'prose-editor px-4 py-3 focus:outline-none',
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML())
    },
  })

  // 외부에서 value가 변경될 때 에디터 내용 동기화 (초기 로드 시)
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    if (value !== current) {
      editor.commands.setContent(value || '', { emitUpdate: false })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  const handleLinkToggle = () => {
    if (!editor) return
    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run()
    } else {
      const url = window.prompt('링크 URL을 입력하세요:')
      if (!url) return
      editor.chain().focus().setLink({ href: url }).run()
    }
  }

  if (!editor) return null

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-200 bg-gray-50 px-3 py-2">
        <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="제목 1">H1</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="제목 2">H2</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="제목 3">H3</ToolbarButton>
        <Divider />
        <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="굵게"><strong>B</strong></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="기울임"><em>I</em></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="밑줄"><span className="underline">U</span></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="취소선"><span className="line-through">S</span></ToolbarButton>
        <Divider />
        <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="순서 없는 목록">≡</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="순서 있는 목록">1.</ToolbarButton>
        <Divider />
        <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="인용구">&ldquo;</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="인라인 코드">{'<>'}</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="코드 블록">{'{ }'}</ToolbarButton>
        <Divider />
        <ToolbarButton onClick={handleLinkToggle} active={editor.isActive('link')} title={editor.isActive('link') ? '링크 해제' : '링크 삽입'}>🔗</ToolbarButton>
        <Divider />
        <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="수평선">—</ToolbarButton>
        <Divider />
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="실행취소">↩</ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="다시실행">↪</ToolbarButton>
      </div>

      {/* 에디터 본문 */}
      <style>{`
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #9ca3af;
          pointer-events: none;
          height: 0;
        }
        .prose-editor { min-height: 160px; }
        .prose-editor h1 { font-size: 1.5rem; font-weight: 700; margin: 0.75rem 0 0.5rem; }
        .prose-editor h2 { font-size: 1.25rem; font-weight: 600; margin: 0.65rem 0 0.4rem; }
        .prose-editor h3 { font-size: 1.1rem;  font-weight: 600; margin: 0.5rem 0 0.35rem; }
        .prose-editor p  { margin: 0.25rem 0; }
        .prose-editor ul { list-style-type: disc;    padding-left: 1.5rem; margin: 0.25rem 0; }
        .prose-editor ol { list-style-type: decimal; padding-left: 1.5rem; margin: 0.25rem 0; }
        .prose-editor blockquote {
          border-left: 3px solid #d1d5db;
          padding-left: 1rem;
          color: #6b7280;
          margin: 0.5rem 0;
        }
        .prose-editor code {
          background: #f3f4f6;
          border-radius: 3px;
          padding: 0.1em 0.3em;
          font-size: 0.875em;
          font-family: monospace;
        }
        .prose-editor pre {
          background: #1f2937;
          color: #f9fafb;
          border-radius: 0.375rem;
          padding: 0.75rem 1rem;
          overflow-x: auto;
          margin: 0.5rem 0;
        }
        .prose-editor pre code {
          background: none;
          padding: 0;
          font-size: 0.85em;
          color: inherit;
        }
        .prose-editor hr {
          border: none;
          border-top: 2px solid #e5e7eb;
          margin: 0.75rem 0;
        }
        .prose-editor a { color: #2563eb; text-decoration: underline; }
      `}</style>

      <div className="bg-white">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
