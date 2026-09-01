'use client'

/**
 * 앵커 기준 플로팅 패널 (GROUP B 소유 — 행 ⋯ 메뉴 · 계약 팝오버 · 드로어 '관리 ▾' 공용)
 * - document.body 포털 + position:fixed → overflow-x-auto 표 안에서도 잘리지 않는다
 * - 바깥 클릭 · ESC · 스크롤/리사이즈 시 onClose
 * - 아래 공간이 부족하면 위로 펼침
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

/** SSR에서는 useLayoutEffect 경고를 피한다(열리기 전엔 아무것도 그리지 않음) */
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export interface RegistryFloatingPanelProps {
  open: boolean
  anchor: HTMLElement | null
  onClose: () => void
  align?: 'left' | 'right'
  className?: string
  children: ReactNode
  /** true면 스크롤해도 닫지 않음(팝오버 안에서 스크롤할 때) */
  keepOnScroll?: boolean
}

export function RegistryFloatingPanel({ open, anchor, onClose, align = 'right', className, children, keepOnScroll = false }: RegistryFloatingPanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null)

  useIsoLayoutEffect(() => {
    if (!open || !anchor) {
      setPos(null)
      return
    }
    const r = anchor.getBoundingClientRect()
    const h = ref.current?.offsetHeight ?? 0
    const spaceBelow = window.innerHeight - r.bottom
    const openUp = h > 0 && spaceBelow < h + 8 && r.top > h + 8
    const top = openUp ? Math.max(8, r.top - h - 4) : r.bottom + 4
    if (align === 'right') setPos({ top, right: Math.max(8, window.innerWidth - r.right) })
    else setPos({ top, left: Math.max(8, r.left) })
  }, [open, anchor, align, children])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node | null
      if (!t) return
      if (ref.current?.contains(t)) return
      if (anchor?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const onScroll = (e: Event) => {
      if (keepOnScroll) return
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, anchor, onClose, keepOnScroll])

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={pos ? { top: pos.top, left: pos.left, right: pos.right } : { top: -9999, left: -9999 }}
      className={cn(
        'fixed z-[70] min-w-[10rem] rounded-md border border-border bg-popover text-popover-foreground shadow-lg',
        !pos && 'invisible',
        className
      )}
    >
      {children}
    </div>,
    document.body
  )
}

export interface MenuItemProps {
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
  children: ReactNode
  title?: string
}

/** 플로팅 패널용 메뉴 항목 */
export function RegistryMenuItem({ onClick, disabled, destructive, children, title }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
        destructive ? 'text-destructive' : 'text-foreground'
      )}
    >
      {children}
    </button>
  )
}

export default RegistryFloatingPanel
