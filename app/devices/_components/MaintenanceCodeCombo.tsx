'use client'

/**
 * 유지보수 코드 자동완성 (§6.1-B 폼 공통) — GROUP C
 * lookupMaintenance(hospitalCode, q) (디바운스 300ms) → 드롭다운 'MNT-202605-0047 · 제목 · 상태'.
 * 선택 → onChange(code, suggestedOccurredOn, basis, hospitalMismatch) — 폼은 업무일자를 §5c 제안으로 채우되 사용자가 이미 고친 값은 유지(출처 툴팁 = OCCURRED_ON_BASIS_LABELS[basis]).
 * `MNT-YYYYMM-NNNN` 정확 입력이면 타 병원 건도 선택 가능 + '다른 병원으로 기록된 건입니다' 경고 배지(hospitalMismatch).
 * 지우면 onChange(null, null, null, false). 병원 문맥이 없으면(hospitalCode null) 정확 코드만 조회한다.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { OCCURRED_ON_BASIS_LABELS, toYmd, type OccurredOnBasis } from '@/lib/deviceRegistryShared'
import { errorMessage, lookupMaintenance } from './api'
import type { MaintenanceLookupItem } from './types'

export interface MaintenanceCodeComboProps {
  /** 폼의 병원(전역 문맥이면 null — 정확 코드만 조회 가능) */
  hospitalCode: string | null
  /** 선택된 코드('' = 없음) */
  value: string
  onChange: (code: string | null, suggestedOccurredOn: string | null, basis: OccurredOnBasis | null, hospitalMismatch: boolean) => void
  disabled?: boolean
  className?: string
  id?: string
}

const EXACT_RE = /^MNT-\d{6}-\d{4}$/i
const DEBOUNCE_MS = 300

export function MaintenanceCodeCombo({ hospitalCode, value, onChange, disabled, className, id }: MaintenanceCodeComboProps) {
  const [text, setText] = useState(value)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<MaintenanceLookupItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<MaintenanceLookupItem | null>(null)
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const reqSeq = useRef(0)
  const lastEmitted = useRef<string | null>(value || null)
  const listId = useId()

  // 외부에서 value가 바뀌면(폼 리셋 등) 입력 동기화
  useEffect(() => {
    if ((value || null) === lastEmitted.current) return
    lastEmitted.current = value || null
    setText(value)
    if (!value) setSelected(null)
  }, [value])

  const q = text.trim()
  const isExact = EXACT_RE.test(q)
  const canSearch = isExact || !!hospitalCode

  // 디바운스 조회 — 열려 있을 때만
  useEffect(() => {
    if (!open || disabled) return
    if (!canSearch) {
      setItems([])
      setError(null)
      return
    }
    const seq = ++reqSeq.current
    setLoading(true)
    const t = window.setTimeout(async () => {
      try {
        const r = await lookupMaintenance(isExact ? null : hospitalCode, q)
        if (seq !== reqSeq.current) return
        setItems(r.data)
        setError(null)
        setHighlight(0)
      } catch (e) {
        if (seq !== reqSeq.current) return
        setItems([])
        setError(errorMessage(e, '유지보수 조회 실패'))
      } finally {
        if (seq === reqSeq.current) setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [open, q, hospitalCode, isExact, canSearch, disabled])

  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.children[highlight] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, highlight])

  const emit = (item: MaintenanceLookupItem | null) => {
    setSelected(item)
    setOpen(false)
    if (item) {
      lastEmitted.current = item.maintenanceCode
      setText(item.maintenanceCode)
      onChange(item.maintenanceCode, item.suggestedOccurredOn, item.basis, item.hospitalMismatch)
    } else {
      lastEmitted.current = null
      setText('')
      onChange(null, null, null, false)
    }
    // 포커스는 옮기지 않는다 — 옵션 클릭은 onMouseDown preventDefault로 입력이 포커스를 유지하고, blur 경로에서 되돌리면 Tab 이동을 방해한다
  }

  /**
   * 입력값을 선택으로 확정 — 정확 코드 일치 결과는 항상 선택. ↵는 하이라이트 항목도 선택하지만,
   * blur(탭 이동)는 부분 검색어로 첫 항목이 선택되는 사고를 막기 위해 정확 일치가 아니면 선택값으로 복귀한다.
   */
  const confirmText = (mode: 'enter' | 'blur') => {
    if (!q) return emit(null)
    const exactHit = items.find((it) => it.maintenanceCode.toUpperCase() === q.toUpperCase())
    if (exactHit) return emit(exactHit)
    if (mode === 'enter' && open && items[highlight]) return emit(items[highlight])
    if (isExact && items.length === 1) return emit(items[0])
    // 미확정 입력 — 선택값으로 복귀
    setText(selected?.maintenanceCode ?? '')
    setOpen(false)
  }

  const mismatch = !!selected && selected.hospitalMismatch && !!value
  const basisTip = useMemo(() => {
    if (!selected?.suggestedOccurredOn || !selected.basis) return null
    return `업무일자 제안 ${selected.suggestedOccurredOn} — ${OCCURRED_ON_BASIS_LABELS[selected.basis]} 기준`
  }, [selected])

  return (
    <div className={cn('relative', className)}>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="유지보수 코드"
          className={cn(
            'h-9 w-full rounded-md border border-input bg-card px-3 pr-9 font-mono text-sm uppercase text-foreground shadow-xs transition-colors placeholder:font-sans placeholder:normal-case placeholder:text-muted-foreground/70',
            'focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50',
            mismatch && 'border-warning/60'
          )}
          placeholder={hospitalCode ? 'MNT-YYYYMM-NNNN 또는 제목 검색' : 'MNT-YYYYMM-NNNN (정확 코드)'}
          value={text}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            const v = e.target.value.toUpperCase()
            setText(v)
            if (!open) setOpen(true)
            // 선택된 코드를 지우면 즉시 해제
            if (!v.trim() && value) {
              lastEmitted.current = null
              setSelected(null)
              onChange(null, null, null, false)
            }
          }}
          onBlur={() => {
            // 옵션 클릭은 onMouseDown preventDefault로 blur 없음
            window.setTimeout(() => {
              if (document.activeElement === inputRef.current) return
              setOpen(false)
              if (q && q.toUpperCase() !== (value || '').toUpperCase()) confirmText('blur')
            }, 0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              if (!open) setOpen(true)
              else setHighlight((h) => Math.min(items.length - 1, h + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlight((h) => Math.max(0, h - 1))
            } else if (e.key === 'Enter') {
              if (e.metaKey || e.ctrlKey) return
              e.preventDefault()
              confirmText('enter')
            } else if (e.key === 'Escape') {
              if (open) {
                e.stopPropagation()
                e.preventDefault()
                setOpen(false)
                setText(selected?.maintenanceCode ?? value ?? '')
              }
            }
          }}
        />
        {value && !disabled ? (
          <button type="button" aria-label="유지보수 코드 지우기" onClick={() => emit(null)} className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground">
            <X size={14} />
          </button>
        ) : (
          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-muted-foreground">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        )}
      </div>

      {/* 선택 요약 · 경고 */}
      {selected && value && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span className="truncate" title={selected.title}>
            {selected.title}
            {selected.statusName ? ` · ${selected.statusName}` : ''}
          </span>
          {basisTip ? (
            <span className="cursor-help underline decoration-dotted" title={basisTip}>
              일자 제안 {selected.suggestedOccurredOn}
            </span>
          ) : (
            <span title="방문·조치·접수 일자가 없어 제안 없음">일자 제안 없음</span>
          )}
          {mismatch && (
            <span className="inline-flex items-center rounded-full bg-warning-subtle px-2 py-0.5 font-medium text-warning-subtle-foreground" title={`${selected.hospitalName} (${selected.hospitalCode})`}>
              다른 병원으로 기록된 건입니다 · {selected.hospitalName}
            </span>
          )}
        </div>
      )}

      {open && !disabled && (
        <ul ref={listRef} id={listId} role="listbox" className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-lg">
          {!canSearch && <li className="px-3 py-2 text-xs text-muted-foreground">병원 문맥이 없습니다 — MNT-YYYYMM-NNNN 정확 코드를 입력하세요</li>}
          {canSearch && loading && items.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">조회 중…</li>}
          {canSearch && !loading && error && <li className="px-3 py-2 text-xs text-destructive">{error}</li>}
          {canSearch && !loading && !error && items.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">{q ? '일치하는 유지보수가 없습니다' : '이 병원의 유지보수가 없습니다'}</li>
          )}
          {items.map((it, idx) => (
            <li
              key={it.id}
              role="option"
              aria-selected={it.maintenanceCode === value}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlight(idx)}
              onClick={() => emit(it)}
              className={cn('cursor-pointer px-3 py-1.5', idx === highlight && 'bg-accent')}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs">{it.maintenanceCode}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {it.statusName ?? ''}
                  {it.suggestedOccurredOn ? ` · ${it.suggestedOccurredOn}` : it.reportedAt ? ` · 접수 ${toYmd(it.reportedAt)}` : ''}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-foreground">{it.title}</span>
                {it.hospitalMismatch && <span className="shrink-0 rounded bg-warning-subtle px-1.5 py-0.5 text-[10px] font-medium text-warning-subtle-foreground">{it.hospitalName}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default MaintenanceCodeCombo
