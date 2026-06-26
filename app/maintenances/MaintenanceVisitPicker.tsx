'use client'

import { useState, useEffect } from 'react'

export interface VisitInput {
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD (단일일이면 startDate와 동일)
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function pad(n: number) {
  return String(n).padStart(2, '0')
}
/** y, m0(0-indexed month), d → YYYY-MM-DD */
function ymd(y: number, m0: number, d: number) {
  return `${y}-${pad(m0 + 1)}-${pad(d)}`
}
function todayStr() {
  const t = new Date()
  return ymd(t.getFullYear(), t.getMonth(), t.getDate())
}
function isRangeVisit(v: VisitInput) {
  return v.endDate > v.startDate
}
function sortVisits(list: VisitInput[]) {
  return [...list].sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate)
  )
}

export default function MaintenanceVisitPicker({
  visits,
  onChange,
}: {
  visits: VisitInput[]
  onChange: (visits: VisitInput[]) => void
}) {
  const [open, setOpen] = useState(false)
  const init = new Date()
  const [viewYear, setViewYear] = useState(init.getFullYear())
  const [viewMonth, setViewMonth] = useState(init.getMonth()) // 0-indexed
  const [isRange, setIsRange] = useState(false)
  const [pendingStart, setPendingStart] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  // 모달을 열 때: 방문이 있으면 가장 이른 방문 월로 이동. 닫을 때: 진행 중 선택 초기화
  useEffect(() => {
    if (open && visits.length > 0) {
      const [y, m] = sortVisits(visits)[0].startDate.split('-').map(Number)
      setViewYear(y)
      setViewMonth(m - 1)
    }
    if (!open) {
      setPendingStart(null)
      setHovered(null)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function emit(next: VisitInput[]) {
    onChange(sortVisits(next))
  }

  function toggleSingle(day: string) {
    const isExistingSingle = visits.some((v) => v.startDate === day && v.endDate === day)
    if (isExistingSingle) {
      emit(visits.filter((v) => !(v.startDate === day && v.endDate === day)))
      return
    }
    // 기존 기간에 포함되는 날은 무시 (중복 방지)
    if (visits.some((v) => isRangeVisit(v) && v.startDate <= day && day <= v.endDate)) return
    emit([...visits, { startDate: day, endDate: day }])
  }

  function addRange(s: string, e: string) {
    if (visits.some((v) => v.startDate === s && v.endDate === e)) return // 동일 기간 중복 방지
    // 새 기간에 포함되는 단일일 항목 정리
    const cleaned = visits.filter((v) => !(v.startDate === v.endDate && s <= v.startDate && v.startDate <= e))
    emit([...cleaned, { startDate: s, endDate: e }])
  }

  function onDayClick(day: string) {
    if (isRange) {
      if (!pendingStart) {
        setPendingStart(day)
        return
      }
      const s = day < pendingStart ? day : pendingStart
      const e = day < pendingStart ? pendingStart : day
      addRange(s, e)
      setPendingStart(null)
      setHovered(null)
    } else {
      toggleSingle(day)
    }
  }

  function removeVisit(idx: number) {
    emit(sortVisits(visits).filter((_, i) => i !== idx))
  }

  function navigateMonth(delta: number) {
    const d = new Date(viewYear, viewMonth + delta, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }

  // 달력 셀 (선행 공백 + 날짜 + 후행 공백으로 주 단위 정렬)
  const firstDow = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const today = todayStr()

  function cellState(day: string) {
    const single = visits.some((v) => v.startDate === day && v.endDate === day)
    const rng = visits.find((v) => isRangeVisit(v) && v.startDate <= day && day <= v.endDate)
    let preview = false
    if (isRange && pendingStart) {
      const other = hovered ?? pendingStart
      const lo = pendingStart < other ? pendingStart : other
      const hi = pendingStart < other ? other : pendingStart
      preview = day >= lo && day <= hi
    }
    return {
      single,
      inRange: !!rng,
      isEdge: rng?.startDate === day || rng?.endDate === day,
      preview,
      pending: pendingStart === day,
    }
  }

  const sorted = sortVisits(visits)

  return (
    <div className="space-y-2">
      {/* 선택된 방문 칩 */}
      {sorted.length === 0 ? (
        <p className="text-xs text-gray-400">등록된 방문일정이 없습니다.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {sorted.map((v, i) => (
            <span
              key={`${v.startDate}_${v.endDate}`}
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700"
            >
              {v.startDate === v.endDate ? v.startDate : `${v.startDate} ~ ${v.endDate}`}
              <button
                type="button"
                onClick={() => removeVisit(i)}
                className="ml-0.5 text-blue-400 hover:text-blue-600"
                aria-label="방문일 삭제"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50"
      >
        + 방문일 지정
      </button>
      <p className="text-xs text-gray-400">
        날짜를 클릭해 여러 날을 선택하세요. 연속 기간은 ‘장기일정’을 켜고 시작·종료일을 클릭합니다.
      </p>

      {/* 캘린더 모달 */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setOpen(false)}
        >
          <div className="w-[320px] rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">방문일 선택</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100"
              >
                ✕
              </button>
            </div>

            <div className="p-4">
              {/* 월 네비게이션 */}
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => navigateMonth(-1)}
                  className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100"
                >
                  ‹
                </button>
                <span className="text-sm font-medium text-gray-800">
                  {viewYear}년 {viewMonth + 1}월
                </span>
                <button
                  type="button"
                  onClick={() => navigateMonth(1)}
                  className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100"
                >
                  ›
                </button>
              </div>

              {/* 장기일정 체크박스 */}
              <label className="mb-1.5 flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={isRange}
                  onChange={(e) => {
                    setIsRange(e.target.checked)
                    setPendingStart(null)
                    setHovered(null)
                  }}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                장기일정 (시작일·종료일 지정)
              </label>
              <p className="mb-2 h-4 text-xs text-blue-600">
                {isRange
                  ? pendingStart
                    ? `시작일 ${pendingStart} — 종료일을 클릭하세요`
                    : '시작일을 클릭하세요'
                  : ''}
              </p>

              {/* 요일 헤더 */}
              <div className="grid grid-cols-7 text-center text-xs">
                {WEEKDAYS.map((w, i) => (
                  <div
                    key={w}
                    className={`py-1 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'}`}
                  >
                    {w}
                  </div>
                ))}
              </div>

              {/* 날짜 그리드 */}
              <div className="grid grid-cols-7 gap-y-1">
                {cells.map((d, i) => {
                  if (d === null) return <div key={`blank-${i}`} />
                  const day = ymd(viewYear, viewMonth, d)
                  const st = cellState(day)
                  const dow = i % 7
                  let cls =
                    'mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm transition-colors '
                  if (st.single || st.isEdge) cls += 'bg-blue-600 text-white hover:bg-blue-700 '
                  else if (st.inRange) cls += 'bg-blue-100 text-blue-800 hover:bg-blue-200 '
                  else if (st.preview) cls += 'bg-blue-50 text-blue-700 '
                  else if (st.pending) cls += 'text-blue-700 ring-2 ring-blue-500 '
                  else {
                    cls += 'hover:bg-gray-100 '
                    cls += dow === 0 ? 'text-red-500 ' : dow === 6 ? 'text-blue-500 ' : 'text-gray-700 '
                  }
                  if (day === today) cls += 'font-bold '
                  return (
                    <button
                      type="button"
                      key={day}
                      onClick={() => onDayClick(day)}
                      onMouseEnter={() => setHovered(day)}
                      className={cls}
                    >
                      {d}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
              <span className="text-xs text-gray-400">선택 {sorted.length}건</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                완료
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
