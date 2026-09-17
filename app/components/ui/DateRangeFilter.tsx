'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * 날짜 범위 필터 (2026-09-16, AS접수 목록 요청) — 유지보수 방문일 캘린더 선택기(MaintenanceVisitPicker)의 월 달력을
 * 목록 필터용으로 개선한 버전: 버튼 → 팝오버 달력에서 시작·종료일 클릭(호버 미리보기), 프리셋(오늘·7일·30일·이번 달·지난 달),
 * 직접 입력(YYYY-MM-DD)·초기화. 값은 부모가 소유(from/to 문자열, 빈 문자열 = 미지정).
 */
interface Props {
  label: string
  from: string
  to: string
  onChange: (from: string, to: string) => void
  className?: string
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`
function todayKst() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}
function addDays(base: string, delta: number) {
  const d = new Date(`${base}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())

type Preset = { label: string; range: () => [string, string] }
const PRESETS: Preset[] = [
  { label: '오늘', range: () => { const t = todayKst(); return [t, t] } },
  { label: '최근 7일', range: () => { const t = todayKst(); return [addDays(t, -6), t] } },
  { label: '최근 30일', range: () => { const t = todayKst(); return [addDays(t, -29), t] } },
  { label: '이번 달', range: () => { const t = todayKst(); const [y, m] = t.split('-').map(Number); return [ymd(y, m - 1, 1), ymd(y, m - 1, new Date(y, m, 0).getDate())] } },
  { label: '지난 달', range: () => { const t = todayKst(); const [y, m] = t.split('-').map(Number); const d = new Date(y, m - 2, 1); const yy = d.getFullYear(); const mm = d.getMonth(); return [ymd(yy, mm, 1), ymd(yy, mm, new Date(yy, mm + 1, 0).getDate())] } },
]

export default function DateRangeFilter({ label, from, to, onChange, className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const today = todayKst()
  const [viewYear, setViewYear] = useState(() => Number((from || today).slice(0, 4)))
  const [viewMonth, setViewMonth] = useState(() => Number((from || today).slice(5, 7)) - 1)
  const [pendingStart, setPendingStart] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [fromInput, setFromInput] = useState(from)
  const [toInput, setToInput] = useState(to)

  // 열 때: 시작일(없으면 종료일·오늘) 월로 이동, 입력칸 동기화. 닫을 때: 진행 중 선택 초기화
  useEffect(() => {
    if (open) {
      const anchor = from || to || today
      setViewYear(Number(anchor.slice(0, 4)))
      setViewMonth(Number(anchor.slice(5, 7)) - 1)
      setFromInput(from)
      setToInput(to)
    } else {
      setPendingStart(null)
      setHovered(null)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setFromInput(from); setToInput(to) }, [from, to])

  // 바깥 클릭·ESC로 닫기
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const apply = (f: string, t: string) => {
    if (f && t && f > t) [f, t] = [t, f]
    onChange(f, t)
  }
  const onDayClick = (day: string) => {
    if (!pendingStart) { setPendingStart(day); return }
    apply(pendingStart, day)
    setPendingStart(null)
    setHovered(null)
  }
  const applyInputs = () => {
    const f = fromInput.trim(); const t = toInput.trim()
    if ((f && !isYmd(f)) || (t && !isYmd(t))) { setFromInput(from); setToInput(to); return }
    apply(f, t)
  }
  const navigateMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1)
    setViewYear(d.getFullYear()); setViewMonth(d.getMonth())
  }

  const firstDow = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const cellState = (day: string) => {
    const inRange = !!from && !!to && from <= day && day <= to
    const isEdge = day === from || day === to
    let preview = false
    if (pendingStart) {
      const other = hovered ?? pendingStart
      const lo = pendingStart < other ? pendingStart : other
      const hi = pendingStart < other ? other : pendingStart
      preview = day >= lo && day <= hi
    }
    return { inRange, isEdge, preview, pending: pendingStart === day }
  }

  const active = !!(from || to)
  const summary = !active ? '전체' : from && to ? (from === to ? from : `${from} ~ ${to}`) : from ? `${from} ~` : `~ ${to}`
  const activePreset = PRESETS.find((p) => { const [f, t] = p.range(); return f === from && t === to })?.label

  return (
    <div ref={wrapRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors ${active ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
        title={`${label} 기간 지정`}
      >
        <span className="text-xs text-gray-400">{label}</span>
        <span className={active ? 'font-medium' : 'text-gray-500'}>{activePreset ?? summary}</span>
        {active && (
          <span
            role="button"
            aria-label={`${label} 기간 해제`}
            onClick={(e) => { e.stopPropagation(); onChange('', ''); setOpen(false) }}
            className="ml-0.5 rounded px-0.5 text-blue-400 hover:bg-blue-100 hover:text-blue-700"
          >
            ×
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-[320px] rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
          {/* 프리셋 */}
          <div className="mb-2 flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => { const [f, t] = p.range(); apply(f, t); setPendingStart(null) }}
                className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${activePreset === p.label ? 'border-blue-500 bg-blue-600 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* 직접 입력 */}
          <div className="mb-2 flex items-center gap-1 text-xs">
            <input
              type="date"
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
              onBlur={applyInputs}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyInputs() } }}
              className="h-7 flex-1 rounded-md border border-gray-300 px-1.5 text-xs"
              aria-label={`${label} 시작일`}
            />
            <span className="text-gray-400">~</span>
            <input
              type="date"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              onBlur={applyInputs}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyInputs() } }}
              className="h-7 flex-1 rounded-md border border-gray-300 px-1.5 text-xs"
              aria-label={`${label} 종료일`}
            />
          </div>

          {/* 월 네비게이션 */}
          <div className="mb-1 flex items-center justify-between">
            <button type="button" onClick={() => navigateMonth(-1)} className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100" aria-label="이전 달">‹</button>
            <span className="text-sm font-medium text-gray-800">{viewYear}년 {viewMonth + 1}월</span>
            <button type="button" onClick={() => navigateMonth(1)} className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100" aria-label="다음 달">›</button>
          </div>
          <p className="mb-1 h-4 text-xs text-blue-600">
            {pendingStart ? `시작일 ${pendingStart} — 종료일을 클릭하세요` : '시작일을 클릭하세요 (같은 날 두 번 = 하루)'}
          </p>

          <div className="grid grid-cols-7 text-center text-xs">
            {WEEKDAYS.map((w, i) => (
              <div key={w} className={`py-1 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'}`}>{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5" onMouseLeave={() => setHovered(null)}>
            {cells.map((d, i) => {
              if (d === null) return <div key={`blank-${i}`} />
              const day = ymd(viewYear, viewMonth, d)
              const st = cellState(day)
              const dow = i % 7
              let cls = 'mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors '
              if (st.pending) cls += 'bg-blue-600 text-white '
              else if (st.preview) cls += 'bg-blue-50 text-blue-700 '
              else if (st.isEdge) cls += 'bg-blue-600 text-white hover:bg-blue-700 '
              else if (st.inRange) cls += 'bg-blue-100 text-blue-800 hover:bg-blue-200 '
              else {
                cls += 'hover:bg-gray-100 '
                cls += dow === 0 ? 'text-red-500 ' : dow === 6 ? 'text-blue-500 ' : 'text-gray-700 '
              }
              if (day === today) cls += 'font-bold underline underline-offset-2 '
              return (
                <button type="button" key={day} onClick={() => onDayClick(day)} onMouseEnter={() => setHovered(day)} className={cls}>
                  {d}
                </button>
              )
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
            <button type="button" onClick={() => { onChange('', ''); setPendingStart(null) }} className="text-xs text-gray-500 hover:text-gray-800">초기화</button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700">닫기</button>
          </div>
        </div>
      )}
    </div>
  )
}
