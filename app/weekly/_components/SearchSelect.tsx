'use client'

// 검색형 셀렉트 — 수천 건 마스터(병원 등)를 텍스트 필터로 고르는 콤보박스
// (일반 <select>는 3,600개 병원 목록에서 사용 불가 — weekly_ops_design.md §6a '병원 select(검색)')
import { useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

export interface SearchSelectOption {
  value: string
  label: string
}

interface Props {
  value: string // '' = 미지정
  onChange: (value: string) => void
  options: SearchSelectOption[]
  placeholder: string // 검색 input placeholder (예: '병원 검색')
  emptyLabel: string // 미지정 옵션 라벨 (예: '— 병원 미지정 —')
  disabled?: boolean
  className?: string
}

const MAX_RESULTS = 50

export default function SearchSelect({ value, onChange, options, placeholder, emptyLabel, disabled, className }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedLabel = useMemo(() => options.find((o) => o.value === value)?.label ?? '', [options, value])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
    return { list: matched.slice(0, MAX_RESULTS), total: matched.length }
  }, [options, query])

  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
    setQuery('')
  }

  const openDropdown = () => {
    if (disabled) return
    setQuery('')
    setOpen(true)
    // 렌더 후 검색 input 포커스
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  return (
    <div className={cn('relative', className)}>
      {open ? (
        <input
          ref={inputRef}
          className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/25"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={() => setOpen(false)}
          aria-label={placeholder}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Escape') {
              e.stopPropagation() // 모달의 useOverlayDismiss(window keydown)까지 버블 → 모달 통째 닫힘 방지
              setOpen(false)
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              if (query.trim() && filtered.list.length > 0) pick(filtered.list[0].value)
            }
          }}
        />
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={openDropdown}
          className={cn(
            'flex h-9 w-full items-center rounded-md border border-input bg-card px-3 text-left text-sm disabled:opacity-60',
            !selectedLabel && 'text-muted-foreground'
          )}
        >
          <span className="min-w-0 flex-1 truncate">{selectedLabel || placeholder}</span>
          <span className="ml-1 text-muted-foreground">▾</span>
        </button>
      )}
      {open && (
        <div
          className="absolute z-50 mt-1 max-h-64 w-full min-w-56 overflow-auto rounded-md border border-border bg-card py-1 shadow-lg"
          onMouseDown={(e) => e.preventDefault()} // 스크롤바 클릭이 input blur(닫힘)를 유발하지 않도록
        >
          {/* onMouseDown: input blur(닫힘)보다 먼저 선택 처리 */}
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent/50"
            onMouseDown={(e) => {
              e.preventDefault()
              pick('')
            }}
          >
            {emptyLabel}
          </button>
          {filtered.list.map((o) => (
            <button
              key={o.value}
              type="button"
              className={cn(
                'block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-accent/50',
                o.value === value && 'bg-primary/10 font-medium'
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(o.value)
              }}
            >
              {o.label}
            </button>
          ))}
          {filtered.total > MAX_RESULTS && (
            <div className="px-3 py-1.5 text-xs text-muted-foreground">
              외 {filtered.total - MAX_RESULTS}건 — 검색어로 좁혀 주세요
            </div>
          )}
          {filtered.total === 0 && <div className="px-3 py-1.5 text-sm text-muted-foreground">검색 결과 없음</div>}
        </div>
      )}
    </div>
  )
}
