'use client'

/**
 * 사용량 대시보드 — 필터 줄 (projects/usage_dashboard_filter_design.md §3.1 · §3.4)
 * 종별(여러 개) · 병원 지정 · 도입 병상(범위) · 추이 기간. 값은 부모(주소)가 갖고, 여기서는 고르는 화면만 그린다.
 * 필터는 화면 전체에 적용된다 — 계산은 서버(lib/usage/overview.ts)가 고른 병원만으로 다시 한다.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import Modal from '@/app/components/ui/Modal'
import { useUnsavedGuard } from '@/app/components/useUnsavedGuard'
import DateRangeFilter from '@/app/components/ui/DateRangeFilter'
import { BED_PRESETS, TREND_WEEK_OPTIONS, bedsLabel, sameBeds, sameTrend, sortTypes, trendLabel, type BedRange, type TrendRange, type ViewFilters } from '@/lib/usage/filters'

export type FilterHospital = { hospitalCode: string; hospitalName: string; type: string; collecting: boolean; tags: string[] }

const btn =
  'flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50'
const md = (date: string) => date.slice(5)

/** 바깥을 누르거나 ESC 로 닫히는 작은 선택 창. 화면 오른쪽을 넘으면 넘는 만큼 왼쪽으로 당겨 연다(좁은 화면) */
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
  useLayoutEffect(() => {
    const el = ref.current
    if (!open || !el) return
    el.style.transform = ''
    const r = el.getBoundingClientRect()
    const over = r.right - (document.documentElement.clientWidth - 8)
    const dx = over > 0 ? Math.min(over, Math.max(0, r.left - 8)) : 0
    if (dx > 0) el.style.transform = `translateX(${-dx}px)`
  }, [open])
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
  bedOptions,
  hospitalCount,
  onChange,
  onClear,
}: {
  filters: ViewFilters
  /** 고를 수 있는 종별과 수집 중인 병원 수 */
  typeOptions: { type: string; count: number }[]
  /** 일별 집계가 있는 첫 날 — '전체' 기간의 시작 */
  firstDate: string | null
  /** 도입 병상 범위 조절의 끝(가장 큰 도입 병상 수)과 값이 비어 있는 병원 수 (불러오기 전이면 null) */
  bedOptions: { max: number; missing: number } | null
  /** 지금 조건에 들어온 병원 수 (불러오기 전이면 null) */
  hospitalCount: number | null
  onChange: (patch: Partial<ViewFilters>) => void
  /** 종별 · 병원 지정 · 도입 병상 · 추이 기간을 기본으로 */
  onClear: () => void
}) {
  const [open, setOpen] = useState<'types' | 'beds' | 'trend' | null>(null)
  const [picker, setPicker] = useState(false)
  const narrowed = filters.types.length > 0 || filters.hospitals.length > 0 || filters.beds !== null
  const active = narrowed || !sameTrend(filters.trend, { kind: 'weeks', weeks: 12 })

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
        <span className="text-xs font-medium text-muted-foreground">도입 병상</span>
        <button type="button" className={btn} aria-expanded={open === 'beds'} data-testid="filter-beds" onClick={() => setOpen(open === 'beds' ? null : 'beds')}>
          <span className={filters.beds ? 'text-foreground' : 'text-muted-foreground'}>{bedsLabel(filters.beds)}</span>
          <ChevronDown size={14} aria-hidden className="text-muted-foreground" />
        </button>
        <Popover open={open === 'beds'} onClose={() => setOpen(null)} className="w-[300px] max-w-[calc(100vw-1rem)] p-3">
          <BedRangePanel value={filters.beds} max={bedOptions?.max ?? 0} missing={bedOptions?.missing ?? 0} onCommit={(beds) => onChange({ beds })} />
        </Popover>
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

/** 범위 조절 막대의 손잡이 두 개 — 겹쳐 놓은 range 입력 둘. 막대는 눌리지 않고 손잡이만 잡힌다 */
const thumb =
  'pointer-events-none absolute inset-x-0 top-0 h-5 w-full cursor-pointer appearance-none bg-transparent focus:outline-none ' +
  '[&::-webkit-slider-runnable-track]:h-5 [&::-webkit-slider-runnable-track]:bg-transparent ' +
  '[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:mt-0.5 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-card [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-md ' +
  '[&:focus-visible::-webkit-slider-thumb]:ring-2 [&:focus-visible::-webkit-slider-thumb]:ring-primary/40 ' +
  '[&::-moz-range-track]:bg-transparent ' +
  '[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-card [&::-moz-range-thumb]:bg-primary'

/**
 * 도입 병상 범위 — 손잡이 두 개로 최소 · 최대를 끌어 정하거나, 빠른 선택을 누르거나, 숫자를 적는다.
 * 오른쪽 손잡이를 끝까지 두면 '그 이상 전부'(상한 없음), 둘 다 끝이면 범위 없음.
 * 끄는 동안은 여기서만 값을 갖고 있다가 멈추면 반영한다(끌 때마다 다시 계산하지 않게).
 */
function BedRangePanel({ value, max, missing, onCommit }: { value: BedRange | null; max: number; missing: number; onCommit: (b: BedRange | null) => void }) {
  // 막대의 끝: 가장 큰 도입 병상 수. 저장된 범위가 그보다 크면 거기까지 늘린다
  const top = Math.max(max, value?.min ?? 0, value?.max ?? 0)
  const draftOf = (v: BedRange | null): [number, number] => [v?.min ?? 0, v?.max ?? top]
  const rangeOf = ([lo, hi]: [number, number]): BedRange | null => (lo <= 0 && hi >= top ? null : { min: lo, max: hi >= top ? null : hi })
  const [draft, setDraft] = useState<[number, number]>(draftOf(value))
  const [text, setText] = useState<[string, string]>(['', ''])
  const applied = draftOf(value)
  const appliedKey = `${applied[0]}-${applied[1]}`
  useEffect(() => {
    setDraft(applied)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedKey])
  useEffect(() => setText([String(draft[0]), draft[1] >= top ? '' : String(draft[1])]), [draft, top])
  // 멈춘 뒤에 반영
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit
  useEffect(() => {
    if (`${draft[0]}-${draft[1]}` === appliedKey) return
    const t = setTimeout(() => onCommitRef.current(rangeOf(draft)), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, appliedKey])

  const [lo, hi] = draft
  const pct = (n: number) => (top > 0 ? (Math.min(n, top) / top) * 100 : 0)
  const typed = (which: 0 | 1) => {
    const raw = text[which].trim()
    const n = raw === '' ? (which === 0 ? 0 : top) : Math.round(Number(raw))
    if (!Number.isFinite(n) || n < 0) return setText([String(lo), hi >= top ? '' : String(hi)])
    setDraft(which === 0 ? [Math.min(n, hi), hi] : [lo, Math.max(Math.min(n, top), lo)])
  }
  const num = 'h-8 w-20 rounded-md border border-border bg-card px-2 text-right text-[13px] tabular-nums text-foreground placeholder:text-muted-foreground'
  const current = rangeOf(draft)

  return (
    <div className="flex flex-col gap-3" data-testid="beds-panel">
      <div className="flex flex-wrap gap-1.5">
        {BED_PRESETS.map((p) => {
          const on = sameBeds(current, p.range)
          return (
            <button
              key={p.label}
              type="button"
              aria-pressed={on}
              data-testid={`beds-preset-${p.label}`}
              onClick={() => onCommit(on ? null : p.range)}
              className={`rounded-full border px-2.5 py-1 text-xs tabular-nums transition-colors ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'}`}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between text-[13px]">
          <span className="font-medium tabular-nums text-foreground" data-testid="beds-readout">
            {bedsLabel(current)}
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">0 ~ {top.toLocaleString()}병상</span>
        </div>
        <div className="relative h-5">
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
          <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary" style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }} />
          <input
            type="range"
            min={0}
            max={top}
            step={1}
            value={lo}
            disabled={top === 0}
            aria-label="도입 병상 최소"
            data-testid="beds-min"
            onChange={(e) => setDraft([Math.min(Number(e.target.value), hi), hi])}
            className={thumb}
            style={{ zIndex: lo > top / 2 ? 2 : 1 }}
          />
          <input
            type="range"
            min={0}
            max={top}
            step={1}
            value={Math.min(hi, top)}
            disabled={top === 0}
            aria-label="도입 병상 최대"
            data-testid="beds-max"
            onChange={(e) => setDraft([lo, Math.max(Number(e.target.value), lo)])}
            className={thumb}
            style={{ zIndex: lo > top / 2 ? 1 : 2 }}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={top}
          value={text[0]}
          aria-label="최소 병상"
          data-testid="beds-min-input"
          onChange={(e) => setText([e.target.value, text[1]])}
          onBlur={() => typed(0)}
          onKeyDown={(e) => e.key === 'Enter' && typed(0)}
          className={num}
        />
        <span>~</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={top}
          value={text[1]}
          placeholder="제한 없음"
          aria-label="최대 병상"
          data-testid="beds-max-input"
          onChange={(e) => setText([text[0], e.target.value])}
          onBlur={() => typed(1)}
          onKeyDown={(e) => e.key === 'Enter' && typed(1)}
          className={num}
        />
        <span>병상</span>
        {value && (
          <button type="button" data-testid="beds-clear" onClick={() => onCommit(null)} className="ml-auto text-xs underline-offset-2 hover:text-foreground hover:underline">
            지우기
          </button>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        병원 정보의 도입 병상 수 기준입니다. 오른쪽 끝까지 두면 그 이상 전부입니다.
        {missing > 0 && ` 도입 병상이 비어 있는 병원 ${missing}곳은 범위를 정하면 빠집니다.`}
      </p>
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
