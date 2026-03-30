'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

type ViewMode = '1m' | '2w' | '3m'

interface Project {
  id: number
  projectCode: string
  projectName: string
  startDate: string | null
  endDateExpected: string | null
  hospital: {
    hospitalName: string | null
    hiraHospitalName: string | null
  }
  buildStatus: { label: string; color: string } | null
}

const DAY_W = 28
const ROW_H = 32
const LABEL_W = 150
const BAR_COLORS = ['#1A56DB', '#0B2E5A', '#3B82F6']
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']

/** 로컬 날짜를 YYYY-MM-DD 문자열로 변환 */
function toLocalStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** API 날짜 문자열을 로컬 자정 Date로 파싱 */
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
  const aUTC = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const bUTC = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((bUTC - aUTC) / 86400000)
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function getViewRange(mode: ViewMode, anchor: Date): [Date, Date] {
  if (mode === '1m') {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
    return [start, end]
  }
  if (mode === '2w') {
    return [addDays(anchor, -7), addDays(anchor, 6)]
  }
  // 3m: 전월 1일 ~ 다음달 말일
  const start = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1)
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 2, 0)
  return [start, end]
}

function buildDates(start: Date, end: Date): Date[] {
  const arr: Date[] = []
  const d = new Date(start)
  while (d <= end) {
    arr.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return arr
}

export default function CalendarPage() {
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  const [viewMode, setViewMode] = useState<ViewMode>('1m')
  const [anchor, setAnchor] = useState(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const didAutoScroll = useRef(false)

  const [viewStart, viewEnd] = useMemo(() => getViewRange(viewMode, anchor), [viewMode, anchor])
  const dates = useMemo(() => buildDates(viewStart, viewEnd), [viewStart, viewEnd])
  const totalW = dates.length * DAY_W

  // 오늘 인덱스
  const todayIdx = useMemo(() => {
    const ts = toLocalStr(today)
    return dates.findIndex(d => toLocalStr(d) === ts)
  }, [dates, today])

  // 주말 인덱스 목록
  const weekendIndices = useMemo(() =>
    dates.map((d, i) => ({ i, dow: d.getDay() })).filter(x => x.dow === 0 || x.dow === 6).map(x => x.i),
    [dates]
  )

  // 월 그룹
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

  // 주차 그룹
  const weekGroups = useMemo(() => {
    const groups: { week: number; start: Date; end: Date; count: number }[] = []
    for (const d of dates) {
      const w = getISOWeek(d)
      const last = groups[groups.length - 1]
      if (last && last.week === w) {
        last.count++
        last.end = new Date(d)
      } else {
        groups.push({ week: w, start: new Date(d), end: new Date(d), count: 1 })
      }
    }
    return groups
  }, [dates])

  // 날짜별 진행건수
  const dayCounts = useMemo(() => {
    return dates.map(d => {
      const ds = toLocalStr(d)
      return projects.filter(p => {
        if (!p.startDate) return false
        const ps = p.startDate.slice(0, 10)
        const pe = p.endDateExpected ? p.endDateExpected.slice(0, 10) : ps
        return ps <= ds && ds <= pe
      }).length
    })
  }, [dates, projects])

  // 구축시작일 있는/없는 프로젝트 분리
  const { withDates, withoutDates } = useMemo(() => ({
    withDates: projects.filter(p => p.startDate),
    withoutDates: projects.filter(p => !p.startDate),
  }), [projects])

  // 데이터 페치
  useEffect(() => {
    fetch('/api/projects?all=true')
      .then(r => r.json())
      .then(data => {
        setProjects(data.projects ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  // 초기 로드 시 오늘 날짜로 스크롤
  useEffect(() => {
    if (!loading && !didAutoScroll.current && scrollRef.current && todayIdx >= 0) {
      const targetLeft = LABEL_W + todayIdx * DAY_W - 300
      scrollRef.current.scrollLeft = Math.max(0, targetLeft)
      didAutoScroll.current = true
    }
  }, [loading, todayIdx])

  function navigate(dir: -1 | 1) {
    const next = new Date(anchor)
    if (viewMode === '2w') next.setDate(next.getDate() + dir * 14)
    else next.setMonth(next.getMonth() + dir)
    setAnchor(next)
  }

  function goToday() {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    setAnchor(d)
  }

  function switchView(mode: ViewMode) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    setViewMode(mode)
    setAnchor(d)
    didAutoScroll.current = false
  }

  function periodText() {
    if (viewMode === '1m') return `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월`
    if (viewMode === '3m') {
      const prev = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1)
      const next = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1)
      return `${prev.getFullYear()}년 ${prev.getMonth() + 1}월 ~ ${next.getFullYear()}년 ${next.getMonth() + 1}월`
    }
    const fmt = (d: Date) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
    return `${fmt(viewStart)} ~ ${fmt(viewEnd)}`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-500 text-sm">
        로딩 중...
      </div>
    )
  }

  const todayLineLeft = todayIdx >= 0 ? LABEL_W + todayIdx * DAY_W + (DAY_W - 1.5) / 2 : null

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* 상단 바 */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-200 bg-white z-30 shrink-0">
        <h1 className="text-base font-bold text-[#0B2E5A] mr-2">구축 일정 캘린더</h1>
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
        >
          <ChevronLeft size={17} />
        </button>
        <button
          onClick={goToday}
          className="px-3 py-1 text-xs rounded border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium"
        >
          오늘
        </button>
        <button
          onClick={() => navigate(1)}
          className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
        >
          <ChevronRight size={17} />
        </button>
        <span className="text-sm font-medium text-gray-700 ml-1">{periodText()}</span>
        <span className="ml-2 text-xs text-gray-400">
          전체 {projects.length}건 (구축일 입력 {withDates.length}건)
        </span>
        <div className="ml-auto flex gap-1">
          {(['1m', '2w', '3m'] as ViewMode[]).map(m => (
            <button
              key={m}
              onClick={() => switchView(m)}
              className={`px-3 py-1 text-xs rounded border transition-colors ${
                viewMode === m
                  ? 'bg-[#0B2E5A] text-white border-[#0B2E5A]'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {m === '1m' ? '1개월' : m === '2w' ? '2주' : '3개월'}
            </button>
          ))}
        </div>
      </div>

      {/* 간트 스크롤 영역 */}
      <div ref={scrollRef} className="flex-1 overflow-auto" style={{ position: 'relative' }}>
        <div style={{ minWidth: LABEL_W + totalW, position: 'relative' }}>

          {/* 스티키 헤더 4행 */}
          <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'white' }}>

            {/* 행 1: 월 */}
            <div className="flex border-b border-gray-200" style={{ height: ROW_H }}>
              <div
                className="border-r border-gray-200 bg-gray-50 flex items-center px-2"
                style={{ width: LABEL_W, minWidth: LABEL_W, position: 'sticky', left: 0, zIndex: 20, background: '#F9FAFB' }}
              />
              <div className="flex">
                {monthGroups.map((g, i) => (
                  <div
                    key={i}
                    className="border-r border-gray-200 flex items-center px-2 text-xs font-semibold text-gray-700 overflow-hidden"
                    style={{ width: g.count * DAY_W, minWidth: g.count * DAY_W, background: 'white' }}
                  >
                    {g.label}
                  </div>
                ))}
              </div>
            </div>

            {/* 행 2: 주차 */}
            <div className="flex border-b border-gray-200" style={{ height: ROW_H }}>
              <div
                className="border-r border-gray-200 flex items-center px-2 text-xs text-gray-400 font-medium"
                style={{ width: LABEL_W, minWidth: LABEL_W, position: 'sticky', left: 0, zIndex: 20, background: '#F9FAFB' }}
              />
              <div className="flex">
                {weekGroups.map((g, i) => {
                  const todayWeek = getISOWeek(today)
                  const isCurWeek = g.week === todayWeek && g.start <= today && today <= g.end
                  const sm = `${g.start.getMonth() + 1}/${g.start.getDate()}`
                  const em = `${g.end.getMonth() + 1}/${g.end.getDate()}`
                  return (
                    <div
                      key={i}
                      className="border-r border-gray-200 flex items-center px-1 text-xs overflow-hidden"
                      style={{
                        width: g.count * DAY_W,
                        minWidth: g.count * DAY_W,
                        background: isCurWeek ? 'rgba(26,86,219,0.06)' : 'white',
                        color: isCurWeek ? '#1A56DB' : '#9CA3AF',
                        fontWeight: isCurWeek ? 700 : 400,
                        fontSize: 10,
                      }}
                    >
                      W{g.week} {sm}~{em}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 행 3: 일 */}
            <div className="flex border-b border-gray-200" style={{ height: ROW_H + 4 }}>
              <div
                className="border-r border-gray-200 flex items-center px-2 text-xs text-gray-400 font-medium"
                style={{ width: LABEL_W, minWidth: LABEL_W, position: 'sticky', left: 0, zIndex: 20, background: '#F9FAFB' }}
              />
              <div className="flex">
                {dates.map((d, i) => {
                  const dow = d.getDay()
                  const isToday = toLocalStr(d) === toLocalStr(today)
                  const isWeekend = dow === 0 || dow === 6
                  return (
                    <div
                      key={i}
                      className="border-r border-gray-200 flex flex-col items-center justify-center"
                      style={{
                        width: DAY_W,
                        minWidth: DAY_W,
                        background: isToday
                          ? 'rgba(26,86,219,0.08)'
                          : isWeekend
                          ? 'rgba(0,0,0,0.02)'
                          : 'white',
                        color: isToday ? '#1A56DB' : isWeekend ? 'rgba(107,114,128,0.55)' : '#374151',
                        fontWeight: isToday ? 700 : 400,
                      }}
                    >
                      <span style={{ fontSize: 11, lineHeight: 1 }}>{d.getDate()}</span>
                      <span style={{ fontSize: 8, lineHeight: 1, marginTop: 2 }}>{DAY_NAMES[dow]}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 행 4: 진행건수 */}
            <div className="flex border-b border-gray-300" style={{ height: ROW_H }}>
              <div
                className="border-r border-gray-200 flex items-center px-2 text-gray-400 font-medium uppercase"
                style={{ width: LABEL_W, minWidth: LABEL_W, position: 'sticky', left: 0, zIndex: 20, background: '#F9FAFB', fontSize: 10 }}
              >
                진행건수
              </div>
              <div className="flex">
                {dates.map((d, i) => {
                  const cnt = dayCounts[i]
                  const dow = d.getDay()
                  const isWeekend = dow === 0 || dow === 6
                  let bg = isWeekend ? 'rgba(0,0,0,0.02)' : 'white'
                  let textColor = '#D1D5DB'
                  let display: string | number = '·'
                  if (cnt === 1) { bg = 'rgba(148,163,184,0.10)'; textColor = '#94A3B8'; display = 1 }
                  else if (cnt === 2) { bg = 'rgba(26,86,219,0.10)'; textColor = '#1A56DB'; display = 2 }
                  else if (cnt === 3) { bg = 'rgba(26,86,219,0.18)'; textColor = '#0B2E5A'; display = 3 }
                  else if (cnt >= 4) { bg = '#0B2E5A'; textColor = 'white'; display = cnt }
                  return (
                    <div
                      key={i}
                      className="border-r border-gray-200 flex items-center justify-center font-medium"
                      style={{ width: DAY_W, minWidth: DAY_W, background: bg, color: textColor, fontSize: 10 }}
                    >
                      {display}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
          {/* /스티키 헤더 */}

          {/* 콘텐츠 영역 */}
          <div style={{ position: 'relative' }}>

            {/* 주말 음영 컬럼 오버레이 */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: LABEL_W,
                width: totalW,
                height: '100%',
                pointerEvents: 'none',
                zIndex: 1,
              }}
            >
              {weekendIndices.map(di => (
                <div
                  key={di}
                  style={{
                    position: 'absolute',
                    left: di * DAY_W,
                    top: 0,
                    width: DAY_W,
                    height: '100%',
                    background: 'rgba(0,0,0,0.02)',
                  }}
                />
              ))}
            </div>

            {/* 오늘 세로선 */}
            {todayLineLeft !== null && (
              <div
                style={{
                  position: 'absolute',
                  left: todayLineLeft,
                  top: 0,
                  width: 1.5,
                  height: '100%',
                  background: 'rgba(239,68,68,0.45)',
                  zIndex: 5,
                  pointerEvents: 'none',
                }}
              />
            )}

            {/* 구축시작일 있는 프로젝트 행 */}
            {withDates.map((p, idx) => {
              const hospitalName = p.hospital.hospitalName || p.hospital.hiraHospitalName || '-'
              const ps = p.startDate ? parseDate(p.startDate) : null
              const pe = p.endDateExpected ? parseDate(p.endDateExpected) : ps

              let barLeft = 0
              let barWidth = 0
              let showBar = false
              let durationDays = 0

              if (ps && pe) {
                durationDays = daysBetween(ps, pe) + 1
                const clampedStart = ps < viewStart ? viewStart : ps
                const clampedEnd = pe > viewEnd ? viewEnd : pe
                if (clampedStart <= clampedEnd) {
                  barLeft = daysBetween(viewStart, clampedStart) * DAY_W
                  barWidth = (daysBetween(clampedStart, clampedEnd) + 1) * DAY_W - 2
                  showBar = true
                }
              }

              const barColor = BAR_COLORS[idx % BAR_COLORS.length]
              const title = ps && pe
                ? `${hospitalName}: ${toLocalStr(ps)}~${toLocalStr(pe)} (${durationDays}일간)`
                : hospitalName

              return (
                <div
                  key={p.id}
                  className="flex border-b border-gray-100 hover:bg-blue-50/30 transition-colors"
                  style={{ height: ROW_H }}
                >
                  {/* 라벨 열 */}
                  <div
                    className="border-r border-gray-200 bg-white flex flex-col justify-center px-2 shrink-0"
                    style={{ width: LABEL_W, minWidth: LABEL_W, position: 'sticky', left: 0, zIndex: 15 }}
                  >
                    <span
                      className="text-xs font-medium text-gray-800 truncate"
                      style={{ maxWidth: 132 }}
                      title={hospitalName}
                    >
                      {hospitalName}
                    </span>
                    <span className="font-mono text-gray-400 truncate" style={{ fontSize: 9 }}>
                      {p.projectCode}
                    </span>
                  </div>
                  {/* 트랙 */}
                  <div style={{ position: 'relative', width: totalW, height: ROW_H, zIndex: 2 }}>
                    {showBar && (
                      <div
                        title={title}
                        onClick={() => window.open(`/projects/${p.projectCode}`, '_blank')}
                        style={{
                          position: 'absolute',
                          left: barLeft,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          width: barWidth,
                          height: 18,
                          background: barColor,
                          borderRadius: 3,
                          cursor: 'pointer',
                          zIndex: 3,
                          display: 'flex',
                          alignItems: 'center',
                          paddingLeft: barWidth > 40 ? 5 : 0,
                          paddingRight: barWidth > 40 ? 5 : 0,
                          overflow: 'hidden',
                        }}
                      >
                        {barWidth > 40 && (
                          <span
                            style={{
                              fontSize: 10,
                              color: 'white',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {hospitalName}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {/* 구축일 미입력 구분선 + 행 */}
            {withoutDates.length > 0 && (
              <>
                <div
                  className="flex border-b border-gray-300 border-t border-t-gray-200"
                  style={{ height: 28, background: '#F3F4F6' }}
                >
                  <div
                    className="border-r border-gray-300 flex items-center px-2 text-gray-400 font-medium uppercase"
                    style={{
                      width: LABEL_W,
                      minWidth: LABEL_W,
                      position: 'sticky',
                      left: 0,
                      zIndex: 15,
                      background: '#F3F4F6',
                      fontSize: 10,
                    }}
                  >
                    구축일 미입력
                  </div>
                  <div style={{ width: totalW, background: '#F3F4F6' }} />
                </div>

                {withoutDates.map(p => {
                  const hospitalName = p.hospital.hospitalName || p.hospital.hiraHospitalName || '-'
                  return (
                    <div
                      key={p.id}
                      className="flex border-b border-gray-100 hover:bg-gray-50 transition-colors"
                      style={{ height: ROW_H }}
                    >
                      <div
                        className="border-r border-gray-200 bg-white flex flex-col justify-center px-2 shrink-0"
                        style={{ width: LABEL_W, minWidth: LABEL_W, position: 'sticky', left: 0, zIndex: 15 }}
                      >
                        <span
                          className="text-xs font-medium text-gray-500 truncate"
                          style={{ maxWidth: 132 }}
                          title={hospitalName}
                        >
                          {hospitalName}
                        </span>
                        <span className="font-mono text-gray-400 truncate" style={{ fontSize: 9 }}>
                          {p.projectCode}
                        </span>
                      </div>
                      <div
                        className="flex items-center px-4 text-gray-300"
                        style={{ width: totalW, fontSize: 11, zIndex: 2, position: 'relative' }}
                      >
                        구축시작일 미입력
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
          {/* /콘텐츠 영역 */}

        </div>
      </div>
    </div>
  )
}
