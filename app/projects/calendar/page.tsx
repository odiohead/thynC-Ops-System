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

interface MaintenanceItem {
  id: number
  maintenanceCode: string | null
  title: string
  reportedAt: string | null
  resolvedAt: string | null
  visits: { startDate: string; endDate: string }[]
  hospital: {
    hospitalName: string | null
    hiraHospitalName: string | null
  }
  type: { id: number; name: string; color: string } | null
  status: { id: number; name: string; color: string } | null
  assignees: { userId: string; user: { id: string; name: string } }[]
}

interface SiteVisitItem {
  id: number
  siteVisitCode: string | null
  hospitalCode: string
  visitDate: string | null
  requestDate: string | null
  hospital: {
    hospitalName: string | null
    hiraHospitalName: string | null
  }
  status: { id: number; name: string; color: string } | null
  assignees: { userId: string; user: { id: string; name: string } }[]
}

// Unified item for gantt chart
interface GanttItem {
  id: number
  kind: 'project' | 'maintenance' | 'site-visit'
  code: string
  startDate: string
  endDate: string
  label: string
  color: string
  tooltip: string
  href: string
}

interface Lane {
  items: GanttItem[]
  lastEnd: number
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

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Monday of the ISO week containing the given date */
function getMondayOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = d.getDay() // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

/** Sunday of the ISO week containing the given date */
function getSundayOfWeek(date: Date): Date {
  const mon = getMondayOfWeek(date)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  return sun
}

/** Inclusive day count between two dates (same day → 1) */
function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000) + 1
}

// ─── Lane allocation ──────────────────────────────────────────────────────────

function allocateLanes(items: GanttItem[]): GanttItem[][] {
  // Sort by startDate ASC
  const sorted = [...items].sort((a, b) => a.startDate.localeCompare(b.startDate))

  const lanes: Lane[] = []

  for (const item of sorted) {
    const itemStart = parseDate(item.startDate).getTime()
    const itemEnd = parseDate(item.endDate).getTime()

    let placed = false
    for (const lane of lanes) {
      if (lane.lastEnd < itemStart) {
        lane.items.push(item)
        lane.lastEnd = itemEnd
        placed = true
        break
      }
    }

    if (!placed) {
      lanes.push({ items: [item], lastEnd: itemEnd })
    }
  }

  return lanes.length > 0 ? lanes.map(l => l.items) : [[]]
}

// ─── Convert to GanttItems ───────────────────────────────────────────────────

function projectsToGanttItems(projects: Project[]): GanttItem[] {
  return projects
    .filter(p => p.startDate && p.endDateExpected)
    .map(p => ({
      id: p.id,
      kind: 'project' as const,
      code: p.projectCode,
      startDate: p.startDate!.slice(0, 10),
      endDate: p.endDateExpected!.slice(0, 10),
      label: p.hospital.hospitalName ?? p.hospital.hiraHospitalName ?? '',
      color: p.buildStatus?.color ?? '#6B7280',
      tooltip: `[구축] ${p.hospital.hospitalName ?? p.hospital.hiraHospitalName ?? ''} (${p.startDate!.slice(0, 10)} ~ ${p.endDateExpected!.slice(0, 10)})`,
      href: `/projects/${p.projectCode}`,
    }))
}

function maintenancesToGanttItems(
  maintenances: MaintenanceItem[],
  viewStartStr: string,
  viewEndStr: string,
): GanttItem[] {
  return maintenances.flatMap(m => {
    const hospitalName = m.hospital.hospitalName ?? m.hospital.hiraHospitalName ?? ''
    return (m.visits ?? [])
      .map((visit, idx) => ({ visit, idx }))
      // 뷰 범위와 겹치는 방문 항목만 바로 렌더
      .filter(({ visit }) => {
        const start = visit.startDate.slice(0, 10)
        const end = visit.endDate.slice(0, 10)
        return start <= viewEndStr && end >= viewStartStr
      })
      .map(({ visit, idx }) => {
        const start = visit.startDate.slice(0, 10)
        const end = visit.endDate.slice(0, 10)
        const rangeLabel = start === end ? start : `${start} ~ ${end}`

        return {
          id: 1_000_000 + m.id * 1000 + idx,
          kind: 'maintenance' as const,
          code: m.maintenanceCode ?? '',
          startDate: start,
          endDate: end,
          label: `🔧 ${hospitalName} - ${m.title}`,
          color: m.type?.color ?? '#F59E0B',
          tooltip: `[유지보수] ${hospitalName} - ${m.title} (${rangeLabel})`,
          href: `/maintenances/${m.id}`,
        }
      })
  })
}

function siteVisitsToGanttItems(siteVisits: SiteVisitItem[]): GanttItem[] {
  return siteVisits
    .filter(sv => sv.visitDate)
    .map(sv => {
      const date = sv.visitDate!.slice(0, 10)
      const hospitalName = sv.hospital.hospitalName ?? sv.hospital.hiraHospitalName ?? ''
      const statusName = sv.status?.name ?? ''

      return {
        id: sv.id + 2000000,
        kind: 'site-visit' as const,
        code: sv.siteVisitCode ?? '',
        startDate: date,
        endDate: date,
        label: `📋 ${hospitalName} 답사`,
        color: sv.status?.color ?? '#10B981',
        tooltip: `[답사] ${hospitalName} (${date}) ${statusName}`,
        href: `/site-visits/${sv.id}`,
      }
    })
}

// ─── Week groups builder ──────────────────────────────────────────────────────

interface WeekGroup {
  week: number
  startDate: Date
  endDate: Date
  count: number
}

function buildWeekGroups(startDate: Date, totalDays: number): WeekGroup[] {
  const groups: WeekGroup[] = []
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startDate)
    d.setDate(startDate.getDate() + i)
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
  const [maintenances, setMaintenances] = useState<MaintenanceItem[]>([])
  const [siteVisits, setSiteVisits] = useState<SiteVisitItem[]>([])
  const [loading, setLoading] = useState(true)

  // Fetch data
  useEffect(() => {
    Promise.all([
      fetch('/api/settings/field-engineers?all=true').then(r => r.json()),
      fetch('/api/projects?all=true').then(r => r.json()),
      fetch('/api/maintenances').then(r => r.json()),
      fetch('/api/site-visits?limit=9999').then(r => r.json()),
    ])
      .then(([feData, projData, mntData, svData]) => {
        setEngineers(feData.data ?? [])
        setProjects(projData.projects ?? [])
        setMaintenances(mntData.maintenances ?? [])
        setSiteVisits(svData.siteVisits ?? [])
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

  // View range: whole ISO weeks covering the current month (extends to prev/next month when needed)
  const viewStart = useMemo(
    () => getMondayOfWeek(new Date(currentYear, currentMonth, 1)),
    [currentYear, currentMonth]
  )
  const viewEnd = useMemo(() => {
    const lastDay = new Date(currentYear, currentMonth + 1, 0)
    return getSundayOfWeek(lastDay)
  }, [currentYear, currentMonth])
  const totalDays = useMemo(() => daysBetween(viewStart, viewEnd), [viewStart, viewEnd])

  // View first/last as strings for intersection test
  const viewStartStr = useMemo(() => toYmd(viewStart), [viewStart])
  const viewEndStr = useMemo(() => toYmd(viewEnd), [viewEnd])

  // Week groups for header row 1
  const weekGroups = useMemo(() => buildWeekGroups(viewStart, totalDays), [viewStart, totalDays])

  // Day info for header row 2
  const days = useMemo(() => {
    const arr: { date: Date; day: number; dow: number; inMonth: boolean }[] = []
    for (let i = 0; i < totalDays; i++) {
      const date = new Date(viewStart)
      date.setDate(viewStart.getDate() + i)
      arr.push({
        date,
        day: date.getDate(),
        dow: date.getDay(),
        inMonth: date.getMonth() === currentMonth && date.getFullYear() === currentYear,
      })
    }
    return arr
  }, [viewStart, totalDays, currentYear, currentMonth])

  // Today column index (0-based, -1 if today is outside the view range)
  const todayCol = useMemo(() => {
    const diff = Math.round((today.getTime() - viewStart.getTime()) / 86400000)
    if (diff >= 0 && diff < totalDays) return diff
    return -1
  }, [today, viewStart, totalDays])

  // Engineer rows with lane data (projects + maintenances combined)
  const engineerRows = useMemo(() => {
    return engineers.map(eng => {
      // Projects assigned to this engineer overlapping with view range
      const assignedProjects = projects.filter(p => {
        if (!p.startDate || !p.endDateExpected) return false
        const hasAssignee = p.assignees.some(a => a.userId === eng.userId)
        if (!hasAssignee) return false
        return p.startDate.slice(0, 10) <= viewEndStr && p.endDateExpected.slice(0, 10) >= viewStartStr
      })

      // Maintenances assigned to this engineer with any visit overlapping the view range
      const assignedMaint = maintenances.filter(m => {
        const hasAssignee = m.assignees.some(a => a.userId === eng.userId)
        if (!hasAssignee) return false
        return (m.visits ?? []).some(v => {
          const start = v.startDate.slice(0, 10)
          const end = v.endDate.slice(0, 10)
          return start <= viewEndStr && end >= viewStartStr
        })
      })

      // Site visits assigned to this engineer overlapping with view range
      const assignedSV = siteVisits.filter(sv => {
        const hasAssignee = sv.assignees.some(a => a.userId === eng.userId)
        if (!hasAssignee) return false
        if (!sv.visitDate) return false
        const date = sv.visitDate.slice(0, 10)
        return date >= viewStartStr && date <= viewEndStr
      })

      // Convert to unified GanttItems
      const ganttItems = [
        ...projectsToGanttItems(assignedProjects),
        ...maintenancesToGanttItems(assignedMaint, viewStartStr, viewEndStr),
        ...siteVisitsToGanttItems(assignedSV),
      ]

      const lanes = allocateLanes(ganttItems)

      return {
        engineer: eng,
        lanes,
        laneCount: lanes.length,
      }
    })
  }, [engineers, projects, maintenances, siteVisits, viewStartStr, viewEndStr])

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

                  const baseColor = isSun ? '#EF4444' : isSat ? '#3B82F6' : '#6B7280'
                  const color = isToday ? '#EF4444' : (d.inMonth ? baseColor : '#D1D5DB')

                  return (
                    <div
                      key={i}
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10,
                        color,
                        fontWeight: isToday ? 700 : 400,
                        borderRight: i < totalDays - 1 ? '1px solid #F3F4F6' : 'none',
                        background: isToday
                          ? 'rgba(239,68,68,0.06)'
                          : (d.inMonth ? 'transparent' : '#FAFAFA'),
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
                    {lanes.map((laneItems, laneIdx) =>
                      laneItems.map(item => {
                        const itemStartDate = parseDate(item.startDate)
                        const itemEndDate = parseDate(item.endDate)

                        // Clamp to view range
                        const clampedStart = itemStartDate < viewStart ? viewStart : itemStartDate
                        const clampedEnd = itemEndDate > viewEnd ? viewEnd : itemEndDate

                        const startCol = Math.round((clampedStart.getTime() - viewStart.getTime()) / 86400000)
                        const endCol = Math.round((clampedEnd.getTime() - viewStart.getTime()) / 86400000)
                        const duration = endCol - startCol + 1

                        const leftPct = (startCol / totalDays) * 100
                        const widthPct = (duration / totalDays) * 100
                        const barColor = item.color

                        const isPast = today.getTime() > clampedEnd.getTime()

                        // Calculate approximate pixel width for text visibility
                        const approxWidth = (duration / totalDays) * (typeof window !== 'undefined' ? window.innerWidth : 1200)
                        const showText = approxWidth >= 40

                        return (
                          <div
                            key={item.id}
                            title={item.tooltip}
                            onClick={() => window.open(item.href, '_blank')}
                            style={{
                              position: 'absolute',
                              left: `${leftPct}%`,
                              top: laneIdx * LANE_H + 6,
                              width: `${widthPct}%`,
                              height: LANE_H - 12,
                              backgroundColor: barColor,
                              opacity: isPast ? 0.45 : 1,
                              borderRadius: 4,
                              cursor: 'pointer',
                              display: 'flex', alignItems: 'center',
                              paddingLeft: 6, paddingRight: 6,
                              overflow: 'hidden',
                              ...(item.kind === 'maintenance' || item.kind === 'site-visit' ? {
                                border: `1.5px solid ${barColor}`,
                                borderLeftWidth: 3,
                              } : {}),
                            }}
                          >
                            {showText && (
                              <span style={{
                                fontSize: 10, color: 'white', whiteSpace: 'nowrap',
                                overflow: 'hidden', textOverflow: 'ellipsis',
                                ...(item.kind !== 'project' ? { textShadow: '0 0 2px rgba(0,0,0,0.3)' } : {}),
                              }}>
                                {item.label}
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
