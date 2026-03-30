'use client'

import { useEffect, useState, useMemo, Suspense, Fragment, ChangeEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

type TabType = 'gantt' | 'calendar'

interface Project {
  id: number
  projectCode: string
  startDate: string | null        // buildStartDate
  endDateExpected: string | null  // buildEndDate
  hospital: {
    hospitalName: string | null
    hiraHospitalName: string | null
  }
  buildStatus: { label: string; color: string } | null
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TOTAL_DAYS = 61   // centerDate ±30일, 총 61일 고정
const ROW_H = 32
const LABEL_W = 150
const BAR_COLORS = ['#1A56DB', '#0B2E5A', '#3B82F6']
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']
const DOT_COLORS = ['#1A56DB', '#0B2E5A', '#3B82F6', '#60A5FA', '#818CF8']

// ─── Date helpers ─────────────────────────────────────────────────────────────

function toLocalStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function daysBetween(a: Date, b: Date): number {
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000
  )
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function buildDates(start: Date, end: Date): Date[] {
  const arr: Date[] = []
  const d = new Date(start)
  while (d <= end) { arr.push(new Date(d)); d.setDate(d.getDate() + 1) }
  return arr
}

// ─── Shared utilities (used by both tabs) ────────────────────────────────────

function countProjectsOnDate(projects: Project[], date: Date): number {
  const ds = toLocalStr(date)
  return projects.filter(p => {
    if (!p.startDate || !p.endDateExpected) return false
    return p.startDate.slice(0, 10) <= ds && ds <= p.endDateExpected.slice(0, 10)
  }).length
}

function getProjectsOnDate(projects: Project[], date: Date): Project[] {
  const ds = toLocalStr(date)
  return projects.filter(p => {
    if (!p.startDate || !p.endDateExpected) return false
    return p.startDate.slice(0, 10) <= ds && ds <= p.endDateExpected.slice(0, 10)
  })
}

// ─── GanttTab ────────────────────────────────────────────────────────────────

function GanttTab({ projects, today }: { projects: Project[]; today: Date }) {
  const [centerDate, setCenterDate] = useState<Date>(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d
  })

  // 고정 61일 범위: centerDate ±30일
  const rangeStart = useMemo(() => addDays(centerDate, -30), [centerDate])
  const rangeEnd   = useMemo(() => addDays(centerDate,  30), [centerDate])
  const dates      = useMemo(() => buildDates(rangeStart, rangeEnd), [rangeStart, rangeEnd])

  // 기간 텍스트
  const periodText = useMemo(() => {
    const fmt = (d: Date) =>
      `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`
    const shortFmt = (d: Date) =>
      `${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`
    return rangeStart.getFullYear() === rangeEnd.getFullYear()
      ? `${fmt(rangeStart)} ~ ${shortFmt(rangeEnd)}`
      : `${fmt(rangeStart)} ~ ${fmt(rangeEnd)}`
  }, [rangeStart, rangeEnd])

  // 프로젝트 필터링
  const { inRange, withoutDates } = useMemo(() => {
    const rs = toLocalStr(rangeStart)
    const re = toLocalStr(rangeEnd)
    return {
      inRange: projects.filter(p => {
        if (!p.startDate || !p.endDateExpected) return false
        return p.startDate.slice(0, 10) <= re && p.endDateExpected.slice(0, 10) >= rs
      }),
      withoutDates: projects.filter(p => !p.startDate || !p.endDateExpected),
    }
  }, [projects, rangeStart, rangeEnd])

  // 헤더 행: 월 그룹
  const monthGroups = useMemo(() => {
    const groups: { label: string; count: number }[] = []
    let curKey = ''
    for (const d of dates) {
      const key = `${d.getFullYear()}-${d.getMonth()}`
      if (key !== curKey) {
        groups.push({ label: `${d.getFullYear()}년 ${d.getMonth() + 1}월`, count: 0 })
        curKey = key
      }
      groups[groups.length - 1].count++
    }
    return groups
  }, [dates])

  // 헤더 행: 주차 그룹
  const weekGroups = useMemo(() => {
    const groups: { week: number; start: Date; end: Date; count: number }[] = []
    for (const d of dates) {
      const w = getISOWeek(d)
      const last = groups[groups.length - 1]
      if (last && last.week === w) { last.count++; last.end = new Date(d) }
      else groups.push({ week: w, start: new Date(d), end: new Date(d), count: 1 })
    }
    return groups
  }, [dates])

  // 헤더 행: 날짜별 진행건수
  const dayCounts = useMemo(() =>
    dates.map(d => countProjectsOnDate(projects, d)),
    [dates, projects]
  )

  // 오늘 오프셋 (0-60 범위 내이면 표시)
  const todayOffset  = useMemo(() => daysBetween(rangeStart, today), [rangeStart, today])
  const todayInRange = todayOffset >= 0 && todayOffset < TOTAL_DAYS

  // 절대 오버레이 위치: 트랙 시작은 LABEL_W, 트랙 너비는 (100% - LABEL_W)
  // fraction = 0~1 범위의 트랙 내 위치
  const tLeft  = (frac: number) => `calc(${LABEL_W}px + (100% - ${LABEL_W}px) * ${frac.toFixed(8)})`
  const tWidth = (frac: number) => `calc((100% - ${LABEL_W}px) * ${frac.toFixed(8)})`

  function navigate(dir: -1 | 1) { setCenterDate(prev => addDays(prev, dir * 30)) }
  function goToday() { const d = new Date(); d.setHours(0, 0, 0, 0); setCenterDate(d) }
  function handleDateInput(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.value) { const d = parseDate(e.target.value); d.setHours(0, 0, 0, 0); setCenterDate(d) }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* 컨트롤 바 */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 bg-white shrink-0">
        {/* 좌측: 이전/오늘/다음 */}
        <div className="flex items-center gap-1">
          <button onClick={() => navigate(-1)} className="p-1.5 rounded hover:bg-gray-100 text-gray-600">
            <ChevronLeft size={16} />
          </button>
          <button onClick={goToday} className="px-2.5 py-1 text-xs rounded border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium">
            오늘
          </button>
          <button onClick={() => navigate(1)} className="p-1.5 rounded hover:bg-gray-100 text-gray-600">
            <ChevronRight size={16} />
          </button>
        </div>
        {/* 중앙: 기간 텍스트 */}
        <span className="flex-1 text-center text-sm font-medium text-gray-700">{periodText}</span>
        {/* 우측: 날짜 직접 선택 */}
        <input
          type="date"
          value={toLocalStr(centerDate)}
          onChange={handleDateInput}
          className="px-2 py-1 text-xs border border-gray-300 rounded text-gray-700 cursor-pointer"
        />
      </div>

      {/* 간트 영역: 세로 스크롤만 허용, 가로는 flex로 꽉 채움 */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">

        {/* 스티키 헤더 4행 */}
        <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'white' }}>

          {/* 행 1: 월 세그먼트 — flex: count 비례 너비 */}
          <div style={{ display: 'flex', height: ROW_H, borderBottom: '1px solid #E5E7EB' }}>
            <div style={{ width: LABEL_W, minWidth: LABEL_W, flexShrink: 0, borderRight: '1px solid #E5E7EB', background: '#F9FAFB' }} />
            <div style={{ flex: 1, display: 'flex' }}>
              {monthGroups.map((g, i) => (
                <div key={i} style={{ flex: g.count, display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 12, fontWeight: 600, color: '#374151', overflow: 'hidden', borderRight: i < monthGroups.length - 1 ? '1px solid #E5E7EB' : 'none', background: 'white' }}>
                  {g.label}
                </div>
              ))}
            </div>
          </div>

          {/* 행 2: ISO 주차 — flex: count 비례 너비 */}
          <div style={{ display: 'flex', height: ROW_H, borderBottom: '1px solid #E5E7EB' }}>
            <div style={{ width: LABEL_W, minWidth: LABEL_W, flexShrink: 0, borderRight: '1px solid #E5E7EB', background: '#F9FAFB' }} />
            <div style={{ flex: 1, display: 'flex' }}>
              {weekGroups.map((g, i) => {
                const isCurWeek = g.week === getISOWeek(today) && g.start <= today && today <= g.end
                return (
                  <div key={i} style={{ flex: g.count, display: 'flex', alignItems: 'center', paddingLeft: 4, fontSize: 10, overflow: 'hidden', borderRight: i < weekGroups.length - 1 ? '1px solid #E5E7EB' : 'none', background: isCurWeek ? 'rgba(26,86,219,0.06)' : 'white', color: isCurWeek ? '#1A56DB' : '#9CA3AF', fontWeight: isCurWeek ? 700 : 400 }}>
                    W{g.week} {g.start.getMonth() + 1}/{g.start.getDate()}~{g.end.getMonth() + 1}/{g.end.getDate()}
                  </div>
                )
              })}
            </div>
          </div>

          {/* 행 3: 일/요일 — 각 셀 flex: 1 */}
          <div style={{ display: 'flex', height: ROW_H + 4, borderBottom: '1px solid #E5E7EB' }}>
            <div style={{ width: LABEL_W, minWidth: LABEL_W, flexShrink: 0, borderRight: '1px solid #E5E7EB', background: '#F9FAFB' }} />
            <div style={{ flex: 1, display: 'flex' }}>
              {dates.map((d, i) => {
                const dow = d.getDay()
                const isToday   = toLocalStr(d) === toLocalStr(today)
                const isWeekend = dow === 0 || dow === 6
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRight: i < dates.length - 1 ? '1px solid #E5E7EB' : 'none', background: isToday ? 'rgba(26,86,219,0.08)' : isWeekend ? 'rgba(0,0,0,0.02)' : 'white', color: isToday ? '#1A56DB' : isWeekend ? 'rgba(107,114,128,0.55)' : '#374151', fontWeight: isToday ? 700 : 400 }}>
                    <span style={{ fontSize: 11, lineHeight: 1 }}>{d.getDate()}</span>
                    <span style={{ fontSize: 8, lineHeight: 1, marginTop: 2 }}>{DAY_NAMES[dow]}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 행 4: 진행건수 — 각 셀 flex: 1 */}
          <div style={{ display: 'flex', height: ROW_H, borderBottom: '1px solid #D1D5DB' }}>
            <div style={{ width: LABEL_W, minWidth: LABEL_W, flexShrink: 0, borderRight: '1px solid #E5E7EB', background: '#F9FAFB', display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 10, color: '#9CA3AF', fontWeight: 500 }}>
              진행건수
            </div>
            <div style={{ flex: 1, display: 'flex' }}>
              {dates.map((d, i) => {
                const cnt = dayCounts[i]
                const isWeekend = d.getDay() === 0 || d.getDay() === 6
                let bg = isWeekend ? 'rgba(0,0,0,0.02)' : 'white'
                let textColor = 'transparent'
                let display: string | number = '·'
                if (cnt === 1) { bg = 'rgba(148,163,184,0.10)'; textColor = '#94A3B8'; display = 1 }
                else if (cnt === 2) { bg = 'rgba(26,86,219,0.10)'; textColor = '#1A56DB'; display = 2 }
                else if (cnt === 3) { bg = 'rgba(26,86,219,0.18)'; textColor = '#0B2E5A'; display = 3 }
                else if (cnt >= 4) { bg = '#0B2E5A'; textColor = '#fff'; display = cnt }
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 500, borderRight: i < dates.length - 1 ? '1px solid #E5E7EB' : 'none', background: bg, color: textColor, fontSize: 10 }}>
                    {display}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* 콘텐츠 영역 */}
        <div style={{ position: 'relative' }}>

          {/* 주말 컬럼 오버레이: calc()로 트랙 내 퍼센트 위치 계산 */}
          {dates.map((d, i) => {
            if (d.getDay() !== 0 && d.getDay() !== 6) return null
            return (
              <div key={i} style={{ position: 'absolute', top: 0, left: tLeft(i / TOTAL_DAYS), width: tWidth(1 / TOTAL_DAYS), height: '100%', background: 'rgba(0,0,0,0.02)', pointerEvents: 'none', zIndex: 1 }} />
            )
          })}

          {/* 오늘 컬럼 연파랑 */}
          {todayInRange && (
            <div style={{ position: 'absolute', top: 0, left: tLeft(todayOffset / TOTAL_DAYS), width: tWidth(1 / TOTAL_DAYS), height: '100%', background: 'rgba(26,86,219,0.04)', pointerEvents: 'none', zIndex: 1 }} />
          )}

          {/* 오늘 세로선 1.5px */}
          {todayInRange && (
            <div style={{ position: 'absolute', top: 0, left: tLeft((todayOffset + 0.5) / TOTAL_DAYS), width: 1.5, height: '100%', background: 'rgba(239,68,68,0.45)', pointerEvents: 'none', zIndex: 5 }} />
          )}

          {/* 빈 상태 */}
          {inRange.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 48, paddingBottom: 48, fontSize: 14, color: '#9CA3AF' }}>
              해당 기간에 진행중인 프로젝트가 없습니다
            </div>
          )}

          {/* 프로젝트 행 */}
          {inRange.map((p, idx) => {
            const hospitalName = p.hospital.hospitalName || p.hospital.hiraHospitalName || '-'
            const ps = p.startDate     ? parseDate(p.startDate)     : null
            const pe = p.endDateExpected ? parseDate(p.endDateExpected) : null
            const durationDays = ps && pe ? daysBetween(ps, pe) + 1 : 0
            let barLeftPct = 0, barWidthPct = 0, showBar = false

            if (ps && pe) {
              const clampedStart = ps < rangeStart ? rangeStart : ps
              const clampedEnd   = pe > rangeEnd   ? rangeEnd   : pe
              if (clampedStart <= clampedEnd) {
                const startOff = daysBetween(rangeStart, clampedStart)
                const endOff   = daysBetween(rangeStart, clampedEnd)
                barLeftPct  = (startOff / TOTAL_DAYS) * 100
                barWidthPct = ((endOff - startOff + 1) / TOTAL_DAYS) * 100
                showBar = barWidthPct > 0
              }
            }

            const barColor = BAR_COLORS[idx % BAR_COLORS.length]
            const title = ps && pe
              ? `${hospitalName}: ${toLocalStr(ps)} ~ ${toLocalStr(pe)} (${durationDays}일간)`
              : hospitalName

            return (
              <div key={p.id} style={{ display: 'flex', height: ROW_H, borderBottom: '1px solid #F3F4F6' }}
                className="hover:bg-blue-50/30 transition-colors">
                <div style={{ width: LABEL_W, minWidth: LABEL_W, flexShrink: 0, borderRight: '1px solid #E5E7EB', background: 'white', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 8px', position: 'relative', zIndex: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#1F2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }} title={hospitalName}>{hospitalName}</span>
                  <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.projectCode}</span>
                </div>
                {/* 트랙: flex:1로 나머지 너비 채움, 바는 % 위치 */}
                <div style={{ flex: 1, position: 'relative', height: ROW_H, zIndex: 2 }}>
                  {showBar && (
                    <div
                      title={title}
                      onClick={() => window.open(`/projects/${p.projectCode}`, '_blank')}
                      style={{
                        position: 'absolute', left: `${barLeftPct}%`, top: '50%', transform: 'translateY(-50%)',
                        width: `${barWidthPct}%`, height: 18, background: barColor, borderRadius: 3,
                        cursor: 'pointer', zIndex: 3, display: 'flex', alignItems: 'center',
                        paddingLeft: 5, paddingRight: 5, overflow: 'hidden',
                      }}
                    >
                      <span style={{ fontSize: 9, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {hospitalName}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* 구축일 미입력 섹션 */}
          {withoutDates.length > 0 && (
            <>
              <div style={{ display: 'flex', height: 28, background: '#F3F4F6', borderTop: '1px solid #E5E7EB', borderBottom: '1px solid #D1D5DB' }}>
                <div style={{ width: LABEL_W, minWidth: LABEL_W, flexShrink: 0, borderRight: '1px solid #D1D5DB', background: '#F3F4F6', display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 10, color: '#9CA3AF', fontWeight: 500 }}>
                  구축일 미입력 ({withoutDates.length}건)
                </div>
                <div style={{ flex: 1, background: '#F3F4F6' }} />
              </div>
              {withoutDates.map(p => {
                const hospitalName = p.hospital.hospitalName || p.hospital.hiraHospitalName || '-'
                return (
                  <div key={p.id} style={{ display: 'flex', height: ROW_H, borderBottom: '1px solid #F3F4F6' }}
                    className="hover:bg-gray-50 transition-colors">
                    <div style={{ width: LABEL_W, minWidth: LABEL_W, flexShrink: 0, borderRight: '1px solid #E5E7EB', background: 'white', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 8px', position: 'relative', zIndex: 2 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }} title={hospitalName}>{hospitalName}</span>
                      <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.projectCode}</span>
                    </div>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', paddingLeft: 16, fontSize: 11, color: '#D1D5DB', position: 'relative', zIndex: 2 }}>
                      구축시작일 미입력
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── CalendarTab ──────────────────────────────────────────────────────────────

function CalendarTab({ projects, today }: { projects: Project[]; today: Date }) {
  const [currentMonth, setCurrentMonth] = useState<Date>(() =>
    new Date(today.getFullYear(), today.getMonth(), 1)
  )
  const [selectedDate, setSelectedDate] = useState<Date>(today)

  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const gridStart = addDays(firstDay, -firstDay.getDay())
    const endDow = lastDay.getDay()
    const gridEnd = endDow < 6 ? addDays(lastDay, 6 - endDow) : lastDay
    return buildDates(gridStart, gridEnd)
  }, [year, month])

  const weeks = useMemo(() => {
    const result: Date[][] = []
    for (let i = 0; i < calendarDays.length; i += 7) result.push(calendarDays.slice(i, i + 7))
    return result
  }, [calendarDays])

  const detailProjects = useMemo(() =>
    getProjectsOnDate(projects, selectedDate),
    [projects, selectedDate]
  )

  const todayStr = toLocalStr(today)
  const selectedStr = toLocalStr(selectedDate)

  function getCellStyle(cnt: number): { bg: string; textColor: string } {
    if (cnt === 0) return { bg: '#F9FAFB', textColor: '#9CA3AF' }
    if (cnt === 1) return { bg: 'rgba(26,86,219,0.10)', textColor: '#1A56DB' }
    if (cnt === 2) return { bg: 'rgba(26,86,219,0.20)', textColor: '#1A56DB' }
    if (cnt === 3) return { bg: 'rgba(11,46,90,0.28)', textColor: '#0B2E5A' }
    return { bg: '#1A56DB', textColor: '#fff' }
  }

  return (
    <div className="flex flex-col flex-1 overflow-auto p-4 gap-4">
      {/* Control bar */}
      <div className="flex items-center gap-2">
        <button onClick={() => setCurrentMonth(new Date(year, month - 1, 1))} className="p-1.5 rounded hover:bg-gray-100 text-gray-600">
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={() => { setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDate(today) }}
          className="px-2.5 py-1 text-xs rounded border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium"
        >
          오늘
        </button>
        <button onClick={() => setCurrentMonth(new Date(year, month + 1, 1))} className="p-1.5 rounded hover:bg-gray-100 text-gray-600">
          <ChevronRight size={16} />
        </button>
        <span className="text-sm font-medium text-gray-700 ml-1">{year}년 {month + 1}월</span>
      </div>

      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '36px repeat(7, 1fr)', gap: 3 }}>
        <div />
        {DAY_NAMES.map((name, i) => (
          <div key={i} className="text-center font-medium"
            style={{ fontSize: 11, color: i === 0 ? '#EF4444' : i === 6 ? '#3B82F6' : '#6B7280', paddingBottom: 4 }}>
            {name}
          </div>
        ))}
      </div>

      {/* Heatmap grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '36px repeat(7, 1fr)', gap: 3 }}>
        {weeks.map((week, wi) => {
          const weekNum = getISOWeek(week[3] ?? week[0])
          return (
            <Fragment key={wi}>
              {/* Week number label */}
              <div className="flex items-center justify-center text-gray-400" style={{ fontSize: 9 }}>
                {weekNum}주
              </div>
              {/* Day cells */}
              {week.map((day, di) => {
                const isCurrentMonth = day.getMonth() === month
                const isToday = toLocalStr(day) === todayStr
                const isSelected = toLocalStr(day) === selectedStr
                const isWeekend = day.getDay() === 0 || day.getDay() === 6
                const cnt = countProjectsOnDate(projects, day)
                const { bg, textColor } = getCellStyle(cnt)

                let outline = 'none'
                if (isToday) outline = '2px solid #EF4444'
                else if (isSelected) outline = '1.5px solid #1A56DB'

                return (
                  <div
                    key={di}
                    onClick={() => setSelectedDate(day)}
                    style={{
                      height: 56, borderRadius: 6, background: bg, cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                      opacity: isCurrentMonth ? (isWeekend ? 0.82 : 1) : 0.3,
                      outline, outlineOffset: 1,
                      transition: 'opacity 0.1s',
                    }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 500, color: textColor }}>{day.getDate()}</span>
                    {cnt > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: textColor }}>{cnt}</span>
                    )}
                  </div>
                )
              })}
            </Fragment>
          )
        })}
      </div>

      {/* Detail panel */}
      <div style={{ borderRadius: 8, padding: '12px 14px', background: '#F9FAFB' }}>
        <div className="text-sm font-medium text-gray-700 mb-2">
          {selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일 진행중인 프로젝트 ({detailProjects.length}건)
        </div>
        {detailProjects.length === 0 ? (
          <div className="text-xs text-gray-400">이 날짜에 진행중인 프로젝트가 없습니다</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {detailProjects.map((p, idx) => {
              const hospitalName = p.hospital.hospitalName || p.hospital.hiraHospitalName || '-'
              return (
                <div
                  key={p.id}
                  onClick={() => window.open(`/projects/${p.projectCode}`, '_blank')}
                  className="flex items-center gap-2 hover:bg-white rounded px-2 py-1.5 cursor-pointer transition-colors"
                >
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: DOT_COLORS[idx % DOT_COLORS.length], flexShrink: 0 }} />
                  <span className="text-xs font-bold text-gray-800">{hospitalName}</span>
                  <span className="font-mono text-gray-400" style={{ fontSize: 10 }}>{p.projectCode}</span>
                  <span className="text-gray-400 ml-auto" style={{ fontSize: 10 }}>
                    {p.startDate?.slice(0, 10) ?? '-'} ~ {p.endDateExpected?.slice(0, 10) ?? '-'}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

function CalendarPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const today = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d
  }, [])

  const [activeTab, setActiveTab] = useState<TabType>(
    searchParams.get('tab') === 'calendar' ? 'calendar' : 'gantt'
  )
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/projects?all=true')
      .then(r => r.json())
      .then(data => { setProjects(data.projects ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  function switchTab(tab: TabType) {
    setActiveTab(tab)
    router.replace(`?tab=${tab}`, { scroll: false })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-500 text-sm">
        로딩 중...
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Common header */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: '0.5px solid #E5E7EB' }}
      >
        <h1 style={{ fontSize: 16, fontWeight: 500, color: '#0B2E5A' }}>구축 일정 캘린더</h1>
        <div className="flex gap-1">
          {(['gantt', 'calendar'] as TabType[]).map(tab => (
            <button
              key={tab}
              onClick={() => switchTab(tab)}
              className="px-3 py-1.5 text-xs rounded border transition-colors"
              style={
                activeTab === tab
                  ? { background: '#0B2E5A', color: '#fff', borderColor: '#0B2E5A' }
                  : { background: 'transparent', color: '#374151', borderColor: '#D1D5DB' }
              }
            >
              {tab === 'gantt' ? '간트 보기' : '캘린더 보기'}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'gantt'
        ? <GanttTab projects={projects} today={today} />
        : <CalendarTab projects={projects} today={today} />
      }
    </div>
  )
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-gray-500 text-sm">로딩 중...</div>}>
      <CalendarPageContent />
    </Suspense>
  )
}
