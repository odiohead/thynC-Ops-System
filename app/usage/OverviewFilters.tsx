'use client'

/**
 * 사용량 대시보드 — 필터 줄 (projects/usage_dashboard_filter_design.md §3.1 · §3.4)
 * 종별(여러 개) · 병원 지정 · 추이 기간. 값은 부모(주소)가 갖고, 여기서는 고르는 화면만 그린다.
 * 필터는 화면 전체에 적용된다 — 계산은 서버(lib/usage/overview.ts)가 고른 병원만으로 다시 한다.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import Modal from '@/app/components/ui/Modal'
import { useUnsavedGuard } from '@/app/components/useUnsavedGuard'
import DateRangeFilter from '@/app/components/ui/DateRangeFilter'
import { TREND_WEEK_OPTIONS, sameTrend, sortTypes, trendLabel, type TrendRange, type ViewFilters } from '@/lib/usage/filters'

export type FilterHospital = { hospitalCode: string; hospitalName: string; type: string; collecting: boolean; tags: string[] }

const btn =
  'flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50'
const md = (date: string) => date.slice(5)

/** 바깥을 누르거나 ESC 로 닫히는 작은 선택 창 */
function Popover({ open, onClose, children, className = '' }: { open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div ref={ref} className={`absolute left-0 top-full z-30 mt-1 min-w-[220px] rounded-lg border border-border bg-card p-1.5 text-card-foreground shadow-lg ${className}`}>
      {children}
    </div>
  )
}

export function FilterBar({
  filters,
  typeOptions,
  firstDate,
  hospitalCount,
  onChange,
  onClear,
}: {
  filters: ViewFilters
  /** 고를 수 있는 종별과 수집 중인 병원 수 */
  typeOptions: { type: string; count: number }[]
  /** 일별 집계가 있는 첫 날 — '전체' 기간의 시작 */
  firstDate: string | null
  /** 지금 조건에 들어온 병원 수 (불러오기 전이면 null) */
  hospitalCount: number | null
  onChange: (patch: Partial<ViewFilters>) => void
  /** 종별 · 병원 지정 · 추이 기간을 기본으로 */
  onClear: () => void
}) {
  const [open, setOpen] = useState<'types' | 'trend' | null>(null)
  const [picker, setPicker] = useState(false)
  const active = filters.types.length > 0 || filters.hospitals.length > 0 || !sameTrend(filters.trend, { kind: 'weeks', weeks: 12 })
  const narrowed = filters.types.length > 0 || filters.hospitals.length > 0

  const toggleType = (t: string) => onChange({ types: filters.types.includes(t) ? filters.types.filter((x) => x !== t) : [...filters.types, t] })
  const typeText = filters.types.length === 0 ? '전체' : filters.types.length === 1 ? filters.types[0] : `${filters.types[0]} 외 ${filters.types.length - 1}`
  const setTrend = (t: TrendRange) => {
    onChange({ trend: t })
    if (t.kind !== 'range') setOpen(null)
  }

  return (
    <div className="flex flex-wrap items-end gap-3" data-testid="overview-filters">
      <div className="relative flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">종별</span>
        <button type="button" className={btn} aria-expanded={open === 'types'} data-testid="filter-types" onClick={() => setOpen(open === 'types' ? null : 'types')}>
          <span className={filters.types.length ? 'text-foreground' : 'text-muted-foreground'}>{typeText}</span>
          <ChevronDown size={14} aria-hidden className="text-muted-foreground" />
        </button>
        <Popover open={open === 'types'} onClose={() => setOpen(null)}>
          {typeOptions.length === 0 && <p className="px-2.5 py-2 text-[13px] text-muted-foreground">고를 종별이 없습니다.</p>}
          {sortTypes(typeOptions).map((o) => {
            const on = filters.types.includes(o.type)
            return (
              <button
                key={o.type}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                data-testid={`filter-type-${o.type}`}
                onClick={() => toggleType(o.type)}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-accent"
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>
                  {on && <Check size={12} aria-hidden />}
                </span>
                <span className="flex-1">{o.type}</span>
                <span className="tabular-nums text-xs text-muted-foreground">{o.count}곳</span>
              </button>
            )
          })}
          {filters.types.length > 0 && (
            <button type="button" onClick={() => onChange({ types: [] })} className="mt-1 w-full rounded-md border-t border-border px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground">
              종별 선택 지우기
            </button>
          )}
        </Popover>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">병원 지정</span>
        <button type="button" className={btn} data-testid="filter-hospitals" onClick={() => setPicker(true)}>
          <span className={filters.hospitals.length ? 'text-foreground' : 'text-muted-foreground'}>{filters.hospitals.length ? `${filters.hospitals.length}곳` : '없음'}</span>
          <ChevronDown size={14} aria-hidden className="text-muted-foreground" />
        </button>
      </div>

      <div className="relative flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">추이 기간</span>
        <button type="button" className={btn} aria-expanded={open === 'trend'} data-testid="filter-trend" onClick={() => setOpen(open === 'trend' ? null : 'trend')}>
          {filters.trend.kind === 'range' ? `${md(filters.trend.from)} ~ ${md(filters.trend.to)}` : trendLabel(filters.trend)}
          <ChevronDown size={14} aria-hidden className="text-muted-foreground" />
        </button>
        <Popover open={open === 'trend'} onClose={() => setOpen(null)} className="min-w-[260px]">
          {TREND_WEEK_OPTIONS.map((w) => (
            <TrendOption key={w} on={filters.trend.kind === 'weeks' && filters.trend.weeks === w} testId={`filter-trend-${w}`} onClick={() => setTrend({ kind: 'weeks', weeks: w })}>
              {w}주{w === 12 && <span className="ml-1.5 text-xs text-muted-foreground">기본</span>}
              {w > 26 && <span className="ml-1.5 text-xs text-muted-foreground">월 단위</span>}
            </TrendOption>
          ))}
          <TrendOption on={filters.trend.kind === 'all'} testId="filter-trend-all" onClick={() => setTrend({ kind: 'all' })}>
            전체{firstDate && <span className="ml-1.5 text-xs text-muted-foreground">{firstDate} ~</span>}
          </TrendOption>
          <div className="mt-1 border-t border-border px-2.5 pb-1.5 pt-2.5">
            <div className="mb-1.5 flex items-center gap-2 text-[13px]">
              <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${filters.trend.kind === 'range' ? 'border-primary' : 'border-border'}`}>
                {filters.trend.kind === 'range' && <span className="h-2 w-2 rounded-full bg-primary" />}
              </span>
              직접 지정
            </div>
            <DateRangeFilter
              label="기간"
              from={filters.trend.kind === 'range' ? filters.trend.from : ''}
              to={filters.trend.kind === 'range' ? filters.trend.to : ''}
              onChange={(from, to) => {
                if (from && to) setTrend({ kind: 'range', from: from <= to ? from : to, to: from <= to ? to : from })
                else if (!from && !to && filters.trend.kind === 'range') setTrend({ kind: 'weeks', weeks: 12 })
              }}
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">26주까지는 주 단위, 그보다 길면 월 단위로 보여 줍니다.{firstDate ? ` 집계는 ${firstDate}부터 있습니다.` : ''}</p>
          </div>
        </Popover>
      </div>

      <p className="flex flex-wrap items-center gap-x-2 pb-2 text-xs text-muted-foreground" data-testid="filter-summary">
        {narrowed && <span className="font-medium text-foreground">병원 {hospitalCount === null ? '—' : hospitalCount.toLocaleString()}곳 기준</span>}
        {active && (
          <button type="button" data-testid="filter-clear" onClick={onClear} className="inline-flex items-center gap-1 rounded underline-offset-2 hover:text-foreground hover:underline">
            <X size={12} aria-hidden />
            필터 지우기
          </button>
        )}
      </p>

      {picker && <HospitalPickerModal selected={filters.hospitals} onClose={() => setPicker(false)} onApply={(codes) => onChange({ hospitals: codes })} />}
    </div>
  )
}

function TrendOption({ on, onClick, children, testId }: { on: boolean; onClick: () => void; children: ReactNode; testId: string }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={on} data-testid={testId} onClick={onClick} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-accent">
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${on ? 'border-primary' : 'border-border'}`}>{on && <span className="h-2 w-2 rounded-full bg-primary" />}</span>
      <span>{children}</span>
    </button>
  )
}

/** 병원 지정 — 이름 검색 · 종별 단위로 담기 · 병원 태그에서 가져오기. [적용]을 눌러야 반영된다 */
function HospitalPickerModal({ selected, onClose, onApply }: { selected: string[]; onClose: () => void; onApply: (codes: string[]) => void }) {
  const [list, setList] = useState<FilterHospital[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set(selected))
  const [q, setQ] = useState('')
  const [onlyPicked, setOnlyPicked] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/usage/filter-hospitals', { cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!alive) return
        if (!r.ok) setError(body.error ?? '병원 목록을 불러오지 못했습니다.')
        else setList(body.hospitals as FilterHospital[])
      })
      .catch(() => alive && setError('병원 목록을 불러오지 못했습니다.'))
    return () => {
      alive = false
    }
  }, [])

  const types = useMemo(() => {
    const m = new Map<string, number>()
    for (const h of list ?? []) m.set(h.type, (m.get(h.type) ?? 0) + 1)
    return sortTypes(Array.from(m.entries()).map(([type, count]) => ({ type, count })))
  }, [list])
  const tags = useMemo(() => {
    const m = new Map<string, number>()
    for (const h of list ?? []) for (const t of h.tags) m.set(t, (m.get(t) ?? 0) + 1)
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ko'))
  }, [list])
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (list ?? []).filter((h) => (!onlyPicked || picked.has(h.hospitalCode)) && (!needle || h.hospitalName.toLowerCase().includes(needle) || h.hospitalCode.toLowerCase().includes(needle)))
  }, [list, q, onlyPicked, picked])
  const known = useMemo(() => new Set((list ?? []).map((h) => h.hospitalCode)), [list])
  /** 목록에 없는 코드(병원 목록에서 사라진 병원)는 적용할 때 버린다 */
  const pickedKnown = list ? Array.from(picked).filter((c) => known.has(c)) : Array.from(picked)
  const notCollecting = (list ?? []).filter((h) => picked.has(h.hospitalCode) && !h.collecting).length

  const toggle = (code: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  const addMany = (codes: string[]) => setPicked((prev) => new Set([...Array.from(prev), ...codes]))
  // 고른 병원이 처음과 달라졌을 때만 닫기 전에 묻는다 (검색어 입력은 '작성 중'으로 치지 않는다)
  const changed = picked.size !== selected.length || selected.some((c) => !picked.has(c))
  const guard = useUnsavedGuard(true, onClose, { dirty: changed })
  const chip = 'rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'

  return (
    <Modal open onClose={guard.requestClose} title="병원 지정" widthClass="max-w-2xl" closeOnBackdrop={false} dialogRef={guard.ref}>
      <div className="flex flex-col gap-3" data-testid="hospital-picker">
        <p className="text-xs text-muted-foreground">고른 병원만으로 화면 전체를 다시 계산합니다. 종별을 함께 고르면 둘 다 만족하는 병원만 남습니다.</p>
        <div className="relative">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="병원 이름 검색"
            aria-label="병원 이름 검색"
            className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>
        {list && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="mr-0.5 text-muted-foreground">한꺼번에 담기</span>
            {types.map((t) => (
              <button key={t.type} type="button" className={chip} data-testid={`picker-type-${t.type}`} onClick={() => addMany(list.filter((h) => h.type === t.type).map((h) => h.hospitalCode))}>
                {t.type} {t.count}
              </button>
            ))}
            {tags.map(([t, n]) => (
              <button key={t} type="button" className={chip} title="병원 태그에서 가져오기" onClick={() => addMany(list.filter((h) => h.tags.includes(t)).map((h) => h.hospitalCode))}>
                #{t} {n}
              </button>
            ))}
          </div>
        )}
        <div className="h-[320px] overflow-y-auto rounded-md border border-border">
          {error && <p className="px-4 py-6 text-center text-sm text-destructive">{error}</p>}
          {!error && !list && <p className="px-4 py-6 text-center text-sm text-muted-foreground">불러오는 중...</p>}
          {list && visible.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">{onlyPicked ? '고른 병원이 없습니다.' : '검색 결과가 없습니다.'}</p>}
          <ul className="divide-y divide-border">
            {visible.map((h) => {
              const on = picked.has(h.hospitalCode)
              return (
                <li key={h.hospitalCode}>
                  <label className="flex cursor-pointer items-center gap-3 px-3.5 py-2 text-[13px] hover:bg-accent/50">
                    <input type="checkbox" checked={on} onChange={() => toggle(h.hospitalCode)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">{h.hospitalName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{h.type}</span>
                    {!h.collecting && <span className="shrink-0 rounded border border-border px-1.5 text-[11px] text-muted-foreground" title="아직 수집을 시작하지 않은 병원입니다 — 수집을 시작하면 화면에 나타납니다">미수집</span>}
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <span data-testid="picker-count">
              고른 병원 <b className="font-semibold text-foreground">{pickedKnown.length}</b>곳
              {notCollecting > 0 && <span className="text-muted-foreground"> (미수집 {notCollecting}곳)</span>}
            </span>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={onlyPicked} onChange={(e) => setOnlyPicked(e.target.checked)} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" />
              고른 병원만 보기
            </label>
            {picked.size > 0 && (
              <button type="button" onClick={() => setPicked(new Set())} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                모두 빼기
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={guard.requestClose} className="h-9 rounded-md border border-border px-3.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground">
              취소
            </button>
            <button
              type="button"
              data-testid="picker-apply"
              disabled={!list}
              onClick={() => {
                onApply(pickedKnown)
                onClose()
              }}
              className="h-9 rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
            >
              적용
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
