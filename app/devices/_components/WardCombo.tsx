'use client'

/**
 * 병동 콤보 + 새 병동 (§6.1-B "병동 입력은 모든 폼에서 같은 '콤보 + 새 병동' 컴포넌트, 비활성 병동 미노출") — GROUP C
 * wards가 주어지면 그대로(활성만 표시), 없으면 getWards(hospitalCode)로 로드. 입력값이 기존 병동과 name_norm(normalizeWardName) 일치하면 wardId,
 * 아니면 allowNew일 때 wardName(새 병동 — '(신규)' 배지). 값 비우면 { } (미지정).
 *
 * 키보드: ↑↓ 이동 · ↵ 선택(하이라이트 없으면 입력값 해석) · Esc 닫기(모달 Esc와 분리 — stopPropagation) · blur 시 입력값 해석.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { normalizeWardName } from '@/lib/deviceRegistryShared'
import { errorMessage, getWards } from './api'
import { toWardOption, type WardOption, type WardValue } from './types'

export interface WardComboProps {
  hospitalCode: string
  value: WardValue
  onChange: (value: WardValue) => void
  /** 새 병동명 허용(등록·이동·교체 폼 true) */
  allowNew: boolean
  /** 사전 로드 옵션(summary.wards → toWardOption). 없으면 컴포넌트가 getWards 호출 */
  wards?: WardOption[]
  disabled?: boolean
  placeholder?: string
  autoFocus?: boolean
  className?: string
  id?: string
}

type Item = { kind: 'none' } | { kind: 'ward'; ward: WardOption } | { kind: 'new'; name: string }

function displayOf(value: WardValue, options: readonly WardOption[]): string {
  if (value.wardId != null) return options.find((w) => w.id === value.wardId)?.name ?? ''
  if (value.wardName) return value.wardName
  return ''
}

export function WardCombo({ hospitalCode, value, onChange, allowNew, wards, disabled, placeholder = '병동 선택 또는 입력', autoFocus, className, id }: WardComboProps) {
  const [loaded, setLoaded] = useState<WardOption[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const options = useMemo(() => (wards ?? loaded ?? []).filter((w) => w.isActive), [wards, loaded])

  // 사전 로드가 없을 때만 조회
  useEffect(() => {
    if (wards) return
    let alive = true
    getWards(hospitalCode)
      .then((r) => alive && setLoaded(r.data.map(toWardOption)))
      .catch((e) => alive && setLoadError(errorMessage(e, '병동 목록을 불러오지 못했습니다.')))
    return () => {
      alive = false
    }
  }, [hospitalCode, wards])

  const [open, setOpen] = useState(false)
  const [text, setText] = useState(() => displayOf(value, options))
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const editing = useRef(false)
  const listId = useId()

  // 외부 value 변경(폼 리셋·구 병동 기본값 등) → 표시 텍스트 동기화 (입력 중이 아닐 때)
  useEffect(() => {
    if (editing.current) return
    setText(displayOf(value, options))
  }, [value, options])

  const norm = normalizeWardName(text)
  const exact = useMemo(() => options.find((w) => normalizeWardName(w.name) === norm) ?? null, [options, norm])
  const items = useMemo<Item[]>(() => {
    const matched = norm ? options.filter((w) => normalizeWardName(w.name).includes(norm)) : options
    const list: Item[] = [{ kind: 'none' }, ...matched.slice(0, 50).map((w) => ({ kind: 'ward' as const, ward: w }))]
    if (allowNew && text.trim() && !exact) list.push({ kind: 'new', name: text.trim() })
    return list
  }, [options, norm, allowNew, text, exact])

  useEffect(() => {
    if (!open) return
    // 입력이 있으면 첫 병동(또는 신규)을 하이라이트, 없으면 현재 값
    if (norm) setHighlight(items.length > 1 ? 1 : 0)
    else {
      const idx = value.wardId != null ? items.findIndex((it) => it.kind === 'ward' && it.ward.id === value.wardId) : 0
      setHighlight(idx < 0 ? 0 : idx)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, norm])

  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.children[highlight] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, highlight])

  const commit = (item: Item) => {
    editing.current = false
    if (item.kind === 'none') {
      setText('')
      onChange({})
    } else if (item.kind === 'ward') {
      setText(item.ward.name)
      onChange({ wardId: item.ward.id })
    } else {
      setText(item.name)
      onChange({ wardName: item.name })
    }
    setOpen(false)
  }

  /** 입력값 해석(blur·↵) — 정확 일치 → wardId, 아니면 allowNew면 새 병동, 아니면 이전 값으로 복귀 */
  const resolveText = () => {
    const t = text.trim()
    if (!t) return commit({ kind: 'none' })
    if (exact) return commit({ kind: 'ward', ward: exact })
    if (allowNew) return commit({ kind: 'new', name: t })
    editing.current = false
    setText(displayOf(value, options))
    setOpen(false)
  }

  const isNew = value.wardId == null && !!value.wardName

  return (
    <div className={cn('relative', className)}>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={listId}
          className={cn(
            'h-9 w-full rounded-md border border-input bg-card px-3 pr-16 text-sm text-foreground shadow-xs transition-colors placeholder:text-muted-foreground/70',
            'focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50'
          )}
          placeholder={loadError ?? placeholder}
          value={text}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => {
            editing.current = true
            setOpen(true)
          }}
          onChange={(e) => {
            editing.current = true
            setText(e.target.value)
            if (!open) setOpen(true)
          }}
          onBlur={() => {
            // 옵션 클릭(onMouseDown preventDefault)은 blur를 일으키지 않음
            if (editing.current) resolveText()
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
              if (e.metaKey || e.ctrlKey) return // 폼 제출 단축키는 통과
              e.preventDefault()
              if (open && items[highlight] && (norm || items[highlight].kind !== 'none')) commit(items[highlight])
              else resolveText()
            } else if (e.key === 'Escape') {
              if (open) {
                e.stopPropagation()
                e.preventDefault()
                editing.current = false
                setText(displayOf(value, options))
                setOpen(false)
              }
            } else if (e.key === 'Tab') {
              if (editing.current) resolveText()
            }
          }}
        />
        <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1">
          {isNew && <span className="rounded bg-primary-subtle px-1.5 py-0.5 text-[10px] font-medium text-primary-subtle-foreground">신규</span>}
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" className="text-muted-foreground" aria-hidden="true">
            <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {open && !disabled && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-lg"
        >
          {items.map((it, idx) => {
            const active = idx === highlight
            const selected = it.kind === 'ward' ? value.wardId === it.ward.id : it.kind === 'none' ? value.wardId == null && !value.wardName : false
            return (
              <li
                key={it.kind === 'ward' ? `w${it.ward.id}` : it.kind}
                role="option"
                aria-selected={selected}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(idx)}
                onClick={() => commit(it)}
                className={cn('flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5', active && 'bg-accent', selected && 'font-medium')}
              >
                {it.kind === 'none' && <span className="text-muted-foreground">— 미지정 —</span>}
                {it.kind === 'ward' && (
                  <>
                    <span>{it.ward.name}</span>
                    {it.ward.activeCount != null && <span className="text-xs tabular-nums text-muted-foreground">{it.ward.activeCount}대</span>}
                  </>
                )}
                {it.kind === 'new' && (
                  <span>
                    <span className="text-muted-foreground">새 병동: </span>
                    <span className="font-medium">{it.name}</span>
                    <span className="ml-1.5 rounded bg-primary-subtle px-1.5 py-0.5 text-[10px] font-medium text-primary-subtle-foreground">신규</span>
                  </span>
                )}
              </li>
            )
          })}
          {items.length === 1 && !allowNew && text.trim() && <li className="px-3 py-1.5 text-xs text-muted-foreground">일치하는 병동이 없습니다</li>}
          {options.length === 0 && !text.trim() && (
            <li className="px-3 py-1.5 text-xs text-muted-foreground">{loadError ? loadError : allowNew ? '병동이 없습니다 — 이름을 입력하면 새로 만듭니다' : '병동이 없습니다'}</li>
          )}
        </ul>
      )}
    </div>
  )
}

export default WardCombo
