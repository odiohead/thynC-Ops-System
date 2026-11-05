'use client'

// 담당 팀 다중 선택 — 체크박스 드롭다운 (2026-11-05, 항목 등록·상세 공용). 프로젝트 필터의 MultiSelectDropdown 패턴을 주간업무 토큰 스타일로.
import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

export interface TeamOption { id: number; name: string }

export default function TeamMultiSelect({
  options,
  value,
  onChange,
  disabled = false,
  className = '',
  placeholder = '담당 팀 (선택)',
}: {
  options: TeamOption[]
  /** 선택된 팀 id (숫자 문자열) — 선택 순서 유지 */
  value: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
  className?: string
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
  const names = value.map((id) => options.find((o) => String(o.id) === id)?.name).filter((n): n is string => !!n)
  const text = names.length === 0 ? placeholder : names.length <= 2 ? names.join(', ') : `${names[0]} 외 ${names.length - 1}`

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 w-full items-center justify-between gap-1 rounded-md border border-border bg-background px-3 text-left text-sm ${names.length ? 'text-foreground' : 'text-muted-foreground'} disabled:cursor-not-allowed disabled:opacity-60`}
        title={names.join(', ') || undefined}
      >
        <span className="truncate">{text}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && !disabled && (
        <div className="absolute left-0 z-30 mt-1 max-h-60 w-full min-w-[12rem] overflow-y-auto rounded-md border border-border bg-background py-1 shadow-lg">
          {options.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">팀 없음</div>}
          {options.map((o) => {
            const id = String(o.id)
            const checked = value.includes(id)
            return (
              <label key={o.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted">
                <input type="checkbox" checked={checked} onChange={() => toggle(id)} className="h-3.5 w-3.5 rounded border-border" />
                <span className="truncate">{o.name}</span>
              </label>
            )
          })}
          {value.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="mt-1 w-full border-t border-border px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted">
              선택 해제
            </button>
          )}
        </div>
      )}
    </div>
  )
}
