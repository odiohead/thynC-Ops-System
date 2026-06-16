'use client'

import { useEffect, useRef, useState } from 'react'

export type OverflowItem = {
  label: string
  icon?: string
  onClick: () => void
  danger?: boolean
}

/**
 * "⋯" 오버플로 메뉴. 페이지 헤더 액션(버전/이동/복제/삭제 등)을 하나로 묶는다.
 */
export default function OverflowMenu({ items }: { items: OverflowItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-[6px] border border-[var(--wiki-border)] text-[var(--wiki-text-soft)] transition hover:bg-[var(--wiki-hover)] hover:text-[var(--wiki-text)]"
        title="더보기"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="wiki-modal-panel absolute right-0 z-30 mt-1 min-w-[180px] overflow-hidden rounded-[8px] border border-[var(--wiki-border)] bg-[var(--wiki-bg)] py-1 shadow-[var(--wiki-shadow-md)]"
        >
          {items.map((item, i) => (
            <button
              key={i}
              role="menuitem"
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-[var(--wiki-hover)] ${
                item.danger ? 'text-red-600' : 'text-[var(--wiki-text)]'
              }`}
            >
              {item.icon && <span className="w-4 text-center">{item.icon}</span>}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
