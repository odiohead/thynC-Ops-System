'use client'

import { useEffect, useState, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface FieldEngineer {
  id: number
  userId: string
  user: { id: string; name: string }
}

interface ProjectAssignee {
  userId: string
  user: { id: string; name: string }
}

interface Project {
  id: number
  projectCode: string
  startDate: string | null
  endDateExpected: string | null
  hospital: {
    hospitalName: string | null
    hiraHospitalName: string | null
  }
  buildStatus: { label: string; color: string } | null
  assignees: ProjectAssignee[]
}

interface Lane {
  projects: Project[]
  lastEnd: number // timestamp of last bar's endDateExpected
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function parseDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function formatMonthDay(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// ─── Lane allocation ──────────────────────────────────────────────────────────

function allocateLanes(projects: Project[]): Project[][] {
  // Sort by startDate ASC
  const sorted = [...projects].sort((a, b) => {
    const aStart = a.startDate ? a.startDate.slice(0, 10) : '9999'
    const bStart = b.startDate ? b.startDate.slice(0, 10) : '9999'
    return aStart.localeCompare(bStart)
  })

  const lanes: Lane[] = []

  for (const proj of sorted) {
    if (!proj.startDate || !proj.endDateExpected) continue
    const projStart = parseDate(proj.startDate).getTime()
    const projEnd = parseDate(proj.endDateExpected).getTime()

    let placed = false
    for (const lane of lanes) {
      if (lane.lastEnd < projStart) {
        lane.projects.push(proj)
        lane.lastEnd = projEnd
        placed = true
        break
      }
    }

    if (!placed) {
      lanes.push({ projects: [proj], lastEnd: projEnd })
    }
  }

  return lanes.length > 0 ? lanes.map(l => l.projects) : [[]]
}

// ─── Week groups builder ──────────────────────────────────────────────────────

interface WeekGroup {
  week: number
  startDate: Date
  endDate: Date
  count: number
}

function buildWeekGroups(year: number, month: number, totalDays: number): WeekGroup[] {
  const groups: WeekGroup[] = []
  for (let day = 1; day <= totalDays; day++) {
    const d = new Date(year, month, day)
    const w = getISOWeek(d)
    const last = groups[groups.length - 1]
    if (last && last.week === w) {
      last.count++
      last.endDate = d
    } else {
      groups.push({ week: w, startDate: d, endDate: d, count: 1 })
    }
  }
  return groups
}

// ─── Main component ──────────────────────────────────────────────────────────

const LANE_H = 36
const NAME_W = 160

function CalendarPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  // Parse month from URL or default to current
  const [currentYear, currentMonth] = useMemo(() => {
    const param = searchParams.get('month')
    if (param && /^\d{4}-\d{2}$/.test(param)) {
      const [y, m] = param.split('-').map(Number)
      return [y, m - 1] // month is 0-indexed
    }
    return [today.getFullYear(), today.getMonth()]
  }, [searchParams, today])

  const [engineers, setEngineers] = useState<FieldEngineer[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  // Fetch data
  useEffect(() => {
    Promise.all([
      fetch('/api/settings/field-engineers?all=true').then(r => r.json()),
      fetch('/api/projects?all=true').then(r => r.json()),
    ])
      .then(([feData, projData]) => {
        setEngineers(feData.data ?? [])
        setProjects(projData.projects ?? [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Month navigation
  function navigateMonth(delta: number) {
    const d = new Date(currentYear, currentMonth + delta, 1)
    const param = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    router.replace(`?month=${param}`, { scroll: false })
  }

  function goToday() {
    const param = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
    router.replace(`?month=${param}`, { scroll: false })
  }

  // Derived: totalDays in current month
  const totalDays = useMemo(() => new Date(currentYear, currentMonth + 1, 0).getDate(), [currentYear, currentMonth])

  // Month first/last as strings for intersection test
  const monthStartStr = useMemo(() =>
    `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`,
    [currentYear, currentMonth]
  )
  const monthEndStr = useMemo(() =>
    `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(totalDays).padStart(2, '0')}`,
    [currentYear, currentMonth, totalDays]
  )

  // Week groups for header row 1
  const weekGroups = useMemo(() => buildWeekGroups(currentYear, currentMonth, totalDays), [currentYear, currentMonth, totalDays])

  // Day info for header row 2
  const days = useMemo(() => {
    const arr: { date: Date; day: number; dow: number }[] = []
    for (let d = 1; d <= totalDays; d++) {
      const date = new Date(currentYear, currentMonth, d)
      arr.push({ date, day: d, dow: date.getDay() })
    }
    return arr
  }, [currentYear, currentMonth, totalDays])

  // Today column index (0-based, -1 if not in this month)
  const todayCol = useMemo(() => {
    if (today.getFullYear() === currentYear && today.getMonth() === currentMonth) {
      return today.getDate() - 1
    }
    return -1
  }, [today, currentYear, currentMonth])

  // Engineer rows with lane data
  const engineerRows = useMemo(() => {
    return engineers.map(eng => {
      // Find projects assigned to this engineer that overlap with current month
      const assigned = projects.filter(p => {
        if (!p.startDate || !p.endDateExpected) return false
        const hasAssignee = p.assignees.some(a => a.userId === eng.userId)
        if (!hasAssignee) return false
        // Intersection: project range overlaps with month range
        return p.startDate.slice(0, 10) <= monthEndStr && p.endDateExpected.slice(0, 10) >= monthStartStr
      })

      const lanes = allocateLanes(assigned)

      return {
        engineer: eng,
        lanes,
        laneCount: lanes.length,
      }
    })
  }, [engineers, projects, monthStartStr, monthEndStr])

  // Total content height for overlays
  const totalContentHeight = useMemo(() => {
    return engineerRows.reduce((sum, r) => sum + r.laneCount * LANE_H, 0)
  }, [engineerRows])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-500 text-sm">
        데이터를 불러오는 중...
      </div>
    )
  }

  if (engineers.length === 0) {
    return (
      <div className="flex flex-col h-screen bg-white">
        <div className="flex items-center justify-center flex-1 text-gray-400 text-sm">
          등록된 필드 엔지니어가 없습니다.
        </div>
      </div>
    )
  }

  const monthLabel = `${currentYear}년 ${currentMonth + 1}월`

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header control bar */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0 border-b border-gray-200">
        <div className="flex items-center gap-1">
          <button onClick={() => navigateMonth(-1)} className="p-1.5 rounded hover:bg-gray-100 text-gray-600">
            <ChevronLeft size={16} />
          </button>
          <span className="px-3 text-sm font-medium text-gray-800 select-none">{monthLabel}</span>
          <button onClick={() => navigateMonth(1)} className="p-1.5 rounded hover:bg-gray-100 text-gray-600">
            <ChevronRight size={16} />
          </button>
        </div>
        <button
          onClick={goToday}
          className="px-3 py-1.5 text-xs rounded border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium"
        >
          오늘
        </button>
      </div>

      {/* Gantt area */}
      <div className="flex-1 overflow-auto">
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: NAME_W + totalDays * 32 }}>

          {/* Sticky header: 2 rows */}
          <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'white' }}>

            {/* Row 1: Week groups */}
            <div style={{ display: 'flex', height: 32, borderBottom: '1px solid #E5E7EB' }}>
              <div style={{
                width: NAME_W, minWidth: NAME_W, flexShrink: 0,
                borderRight: '1px solid #E5E7EB', background: '#F9FAFB',
                display: 'flex', alignItems: 'center', paddingLeft: 12,
                fontSize: 12, fontWeight: 600, color: '#374151',
              }}>
                담당자
              </div>
              <div style={{ flex: 1, display: 'flex' }}>
                {weekGroups.map((g, i) => (
                  <div
                    key={i}
                    style={{
                      flex: g.count, display: 'flex', alignItems: 'center', paddingLeft: 6,
                      fontSize: 11, color: '#6B7280', fontWeight: 500,
                      borderRight: i < weekGroups.length - 1 ? '1px solid #E5E7EB' : 'none',
                      overflow: 'hidden', whiteSpace: 'nowrap',
                    }}
                  >
                    W{g.week} {formatMonthDay(g.startDate)}~{formatMonthDay(g.endDate)}
                  </div>
                ))}
              </div>
            </div>

            {/* Row 2: Day cells */}
            <div style={{ display: 'flex', height: 28, borderBottom: '1px solid #D1D5DB' }}>
              <div style={{
                width: NAME_W, minWidth: NAME_W, flexShrink: 0,
                borderRight: '1px solid #E5E7EB', background: '#F9FAFB',
              }} />
              <div style={{ flex: 1, display: 'flex' }}>
                {days.map((d, i) => {
                  const isSun = d.dow === 0
                  const isSat = d.dow === 6
                  const isToday = i === todayCol
                  let label: string = String(d.day)
                  if (isSun) label += ' 일'
                  else if (isSat) label += ' 토'

                  return (
                    <div
                      key={i}
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10,
                        color: isToday ? '#EF4444' : isSun ? '#EF4444' : isSat ? '#3B82F6' : '#6B7280',
                        fontWeight: isToday ? 700 : 400,
                        borderRight: i < totalDays - 1 ? '1px solid #F3F4F6' : 'none',
                        background: isToday ? 'rgba(239,68,68,0.06)' : 'transparent',
                      }}
                    >
                      {label}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Body: engineer rows with overlays */}
          <div style={{ position: 'relative' }}>

            {/* Day separator dotted lines */}
            {days.map((d, i) => {
              if (i === 0) return null
              return (
                <div
                  key={`sep-${i}`}
                  style={{
                    position: 'absolute', top: 0,
                    left: `calc(${NAME_W}px + (100% - ${NAME_W}px) * ${i / totalDays})`,
                    width: 0,
                    height: totalContentHeight || '100%',
                    borderLeft: '1px dashed rgba(0,0,0,0.08)',
                    pointerEvents: 'none', zIndex: 1,
                  }}
                />
              )
            })}

            {/* Weekend column overlays */}
            {days.map((d, i) => {
              if (d.dow !== 0 && d.dow !== 6) return null
              return (
                <div
                  key={`wk-${i}`}
                  style={{
                    position: 'absolute', top: 0,
                    left: `calc(${NAME_W}px + (100% - ${NAME_W}px) * ${i / totalDays})`,
                    width: `calc((100% - ${NAME_W}px) * ${1 / totalDays})`,
                    height: totalContentHeight || '100%',
                    background: 'rgba(0,0,0,0.03)',
                    pointerEvents: 'none', zIndex: 1,
                  }}
                />
              )
            })}

            {/* Today vertical line */}
            {todayCol >= 0 && (
              <div
                style={{
                  position: 'absolute', top: 0,
                  left: `calc(${NAME_W}px + (100% - ${NAME_W}px) * ${(todayCol + 0.5) / totalDays})`,
                  width: 1.5,
                  height: totalContentHeight || '100%',
                  background: 'rgba(239,68,68,0.5)',
                  pointerEvents: 'none', zIndex: 5,
                }}
              />
            )}

            {/* Engineer rows */}
            {engineerRows.map(({ engineer, lanes, laneCount }) => {
              const rowHeight = laneCount * LANE_H
              return (
                <div
                  key={engineer.id}
                  style={{
                    display: 'flex', height: rowHeight,
                    borderBottom: '1px solid #E5E7EB',
                  }}
                >
                  {/* Name cell: spans full row group, vertically centered */}
                  <div
                    style={{
                      width: NAME_W, minWidth: NAME_W, flexShrink: 0,
                      borderRight: '1px solid #E5E7EB', background: 'white',
                      display: 'flex', alignItems: 'center', paddingLeft: 12,
                      position: 'relative', zIndex: 2,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12, fontWeight: 500, color: '#1F2937',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                      title={engineer.user.name}
                    >
                      {engineer.user.name}
                    </span>
                  </div>

                  {/* Track area: lanes stacked vertically */}
                  <div style={{ flex: 1, position: 'relative', zIndex: 2 }}>
                    {lanes.map((laneProjects, laneIdx) =>
                      laneProjects.map(proj => {
                        if (!proj.startDate || !proj.endDateExpected) return null

                        const projStartDate = parseDate(proj.startDate)
                        const projEndDate = parseDate(proj.endDateExpected)
                        const monthStart = new Date(currentYear, currentMonth, 1)
                        const monthEnd = new Date(currentYear, currentMonth, totalDays)

                        // Clamp to month
                        const clampedStart = projStartDate < monthStart ? monthStart : projStartDate
                        const clampedEnd = projEndDate > monthEnd ? monthEnd : projEndDate

                        const startDay = clampedStart.getDate() - 1 // 0-indexed
                        const endDay = clampedEnd.getDate() - 1
                        const duration = endDay - startDay + 1

                        const leftPct = (startDay / totalDays) * 100
                        const widthPct = (duration / totalDays) * 100
                        const barColor = proj.buildStatus?.color ?? '#6B7280'
                        const hospitalName = proj.hospital.hospitalName ?? proj.hospital.hiraHospitalName ?? ''

                        // Calculate approximate pixel width for text visibility
                        const approxWidth = (duration / totalDays) * (window?.innerWidth ?? 1200)
                        const showText = approxWidth >= 40

                        return (
                          <div
                            key={proj.id}
                            title={`${hospitalName} (${proj.startDate?.slice(0, 10)} ~ ${proj.endDateExpected?.slice(0, 10)})`}
                            onClick={() => window.open(`/projects/${proj.projectCode}`, '_blank')}
                            style={{
                              position: 'absolute',
                              left: `${leftPct}%`,
                              top: laneIdx * LANE_H + 6,
                              width: `${widthPct}%`,
                              height: LANE_H - 12,
                              background: barColor,
                              borderRadius: 4,
                              cursor: 'pointer',
                              display: 'flex', alignItems: 'center',
                              paddingLeft: 6, paddingRight: 6,
                              overflow: 'hidden',
                            }}
                          >
                            {showText && (
                              <span style={{
                                fontSize: 10, color: 'white', whiteSpace: 'nowrap',
                                overflow: 'hidden', textOverflow: 'ellipsis',
                              }}>
                                {hospitalName}
                              </span>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function CalendarPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen text-gray-500 text-sm">
        데이터를 불러오는 중...
      </div>
    }>
      <CalendarPageContent />
    </Suspense>
  )
}
