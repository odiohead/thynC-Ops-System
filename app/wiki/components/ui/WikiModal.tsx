'use client'

import { useEffect, useRef } from 'react'

type Props = {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  footer?: React.ReactNode
  width?: number
  /** 상단 정렬(검색형) vs 중앙 정렬 */
  align?: 'top' | 'center'
}

/**
 * 위키 공통 모달. 오버레이 블러 + 라운드 12px + ESC 닫기 + 진입 트랜지션.
 * 기존 개별 모달(MovePage/ReferencePicker/VersionHistory/링크피커)을 점진적으로 이걸로 통일.
 */
export default function WikiModal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 480,
  align = 'center',
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className={`wiki-modal-overlay fixed inset-0 z-[90] flex justify-center px-4 ${
        align === 'top' ? 'items-start pt-24' : 'items-center'
      }`}
      onClick={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="wiki-modal-panel w-full overflow-hidden rounded-[12px] bg-[var(--wiki-bg)] shadow-[var(--wiki-shadow-lg)]"
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-[var(--wiki-border)] px-5 py-3.5">
            <h3 className="text-[15px] font-semibold text-[var(--wiki-text)]">{title}</h3>
            <button
              onClick={onClose}
              className="rounded-[6px] px-1.5 py-0.5 text-[var(--wiki-text-muted)] transition hover:bg-[var(--wiki-hover)] hover:text-[var(--wiki-text)]"
              aria-label="닫기"
            >
              ✕
            </button>
          </div>
        )}
        <div>{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-[var(--wiki-border)] px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
