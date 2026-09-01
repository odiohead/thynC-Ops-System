'use client'

// 검색형 셀렉트 — 수천 건 마스터(병원 등)를 텍스트 필터로 고르는 콤보박스
// (일반 <select>는 3,600개 병원 목록에서 사용 불가 — weekly_ops_design.md §6a '병원 select(검색)')
//
// `onSearch?(q)` (선택, 2026-09 디바이스 원장 §6.1) — 비동기 검색 훅. 지정 시 검색어가 있으면 로컬 `options` 필터 대신
// onSearch(q) 결과(디바운스 250ms, 최신 요청만 반영)를 목록으로 쓴다. 검색어가 비어 있으면 종전처럼 `options`를 보여
// 주므로 기존 호출부(/weekly)는 동작 변화가 없다. 비동기 결과에서 고른 값은 라벨을 내부에 기억해 `options` 밖이어도 표시된다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

export interface SearchSelectOption {
  value: string
  label: string
}

export interface SearchSelectProps {
  value: string // '' = 미지정
  onChange: (value: string) => void
  options: SearchSelectOption[]
  placeholder: string // 검색 input placeholder (예: '병원 검색')
  emptyLabel: string // 미지정 옵션 라벨 (예: '— 병원 미지정 —')
  disabled?: boolean
  className?: string
  /** 비동기 검색(검색어가 있을 때만 호출) — 결과 캡은 호출부 책임(예: 병원 20건) */
  onSearch?: (q: string) => Promise<SearchSelectOption[]>
}

const MAX_RESULTS = 50
const SEARCH_DEBOUNCE_MS = 250

interface AsyncState {
  q: string
  list: SearchSelectOption[]
  loading: boolean
  error: string | null
}

const ASYNC_IDLE: AsyncState = { q: '', list: [], loading: false, error: null }

export default function SearchSelect({ value, onChange, options, placeholder, emptyLabel, disabled, className, onSearch }: SearchSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // 비동기 결과에서 고른 옵션(로컬 options 밖) — 라벨 표시용
  const [asyncPicked, setAsyncPicked] = useState<SearchSelectOption | null>(null)
  const [asyncState, setAsyncState] = useState<AsyncState>(ASYNC_IDLE)
  const onSearchRef = useRef(onSearch)
  onSearchRef.current = onSearch
  const hasSearch = typeof onSearch === 'function'
  const trimmed = query.trim()
  const asyncMode = hasSearch && trimmed.length > 0

  const selectedLabel = useMemo(() => {
    const local = options.find((o) => o.value === value)?.label
    if (local) return local
    if (asyncPicked && asyncPicked.value === value) return asyncPicked.label
    return ''
  }, [options, value, asyncPicked])

  const filtered = useMemo(() => {
    const q = trimmed.toLowerCase()
    const matched = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
    return { list: matched.slice(0, MAX_RESULTS), total: matched.length }
  }, [options, trimmed])

  // 비동기 검색 — 디바운스 + 최신 요청만 반영
  useEffect(() => {
    if (!hasSearch || !open) return
    if (!trimmed) {
      setAsyncState(ASYNC_IDLE)
      return
    }
    let alive = true
    setAsyncState((s) => ({ ...s, loading: true, error: null }))
    const t = window.setTimeout(async () => {
      try {
        const list = await onSearchRef.current!(trimmed)
        if (alive) setAsyncState({ q: trimmed, list, loading: false, error: null })
      } catch (e) {
        if (alive) setAsyncState({ q: trimmed, list: [], loading: false, error: e instanceof Error && e.message ? e.message : '검색에 실패했습니다' })
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [hasSearch, open, trimmed])

  const visible = asyncMode ? asyncState.list : filtered.list
  const asyncLoading = asyncMode && (asyncState.loading || asyncState.q !== trimmed)

  const pick = (v: string, fromAsync = false) => {
    if (fromAsync) setAsyncPicked(asyncState.list.find((o) => o.value === v) ?? null)
    onChange(v)
    setOpen(false)
    setQuery('')
  }

  const openDropdown = () => {
    if (disabled) return
    setQuery('')
    setAsyncState(ASYNC_IDLE)
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
          aria-busy={asyncLoading || undefined}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Escape') {
              e.stopPropagation() // 모달의 useOverlayDismiss(window keydown)까지 버블 → 모달 통째 닫힘 방지
              setOpen(false)
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              if (asyncMode && asyncLoading) return
              if (trimmed && visible.length > 0) pick(visible[0].value, asyncMode)
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
          {visible.map((o) => (
            <button
              key={o.value}
              type="button"
              className={cn(
                'block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-accent/50',
                o.value === value && 'bg-primary/10 font-medium'
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(o.value, asyncMode)
              }}
            >
              {o.label}
            </button>
          ))}
          {asyncMode ? (
            <>
              {asyncLoading && <div className="px-3 py-1.5 text-xs text-muted-foreground">검색 중…</div>}
              {!asyncLoading && asyncState.error && <div className="px-3 py-1.5 text-xs text-destructive">{asyncState.error}</div>}
              {!asyncLoading && !asyncState.error && visible.length === 0 && (
                <div className="px-3 py-1.5 text-sm text-muted-foreground">검색 결과 없음</div>
              )}
            </>
          ) : (
            <>
              {filtered.total > MAX_RESULTS && (
                <div className="px-3 py-1.5 text-xs text-muted-foreground">
                  외 {filtered.total - MAX_RESULTS}건 — 검색어로 좁혀 주세요
                </div>
              )}
              {filtered.total === 0 && <div className="px-3 py-1.5 text-sm text-muted-foreground">검색 결과 없음</div>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
