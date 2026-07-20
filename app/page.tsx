'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import StatusBadge from '@/app/components/StatusBadge'
import { Tv } from 'lucide-react'
import { useChartTheme } from '@/app/components/theme/useChartTheme'
import * as XLSX from 'xlsx'
import {
  BarChart,
  LineChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

type DashboardProject = {
  projectCode: string
  startDate: string | null
  endDateExpected: string | null
  remark: string | null
  builderNameManual: string | null
  hospital: { hospitalName: string; hiraHospitalName: string }
  buildStatus: { label: string; color: string | null } | null
  assignees: { user: { name: string } }[]
}

type DashboardData = {
  thisWeek: DashboardProject[]
  nextWeek: DashboardProject[]
}

type HospitalStatRow = {
  clCdNm: string
  total: number
  reviewing: number
  contracted: number
}

type HospitalStats = {
  rows: HospitalStatRow[]
  totals: { total: number; reviewing: number; contracted: number }
}

type MonthlyEntry = {
  month: string
  label: string
  newHospitals: number
  newBeds: number
  totalHospitals: number
  totalBeds: number
}

type Summary = {
  hospitalCount: number
  bedCount: number
}

type MaintenanceItem = {
  id: number
  title: string
  priority: string
  reportedAt: string | null
  isRemote: boolean
  hospital: { hospitalName: string } | null
  status: { name: string; color: string | null } | null
  type: { name: string } | null
  assignees: { user: { name: string } }[]
}

type MaintenanceData = {
  inProgressCount: number
  items: MaintenanceItem[]
}

const PRIORITY_DOT: Record<string, string> = {
  긴급: 'bg-red-500',
  높음: 'bg-amber-500',
  보통: 'bg-blue-400',
  낮음: 'bg-gray-300',
}

function downloadMonthlyExcel(data: MonthlyEntry[]) {
  const rows = [...data].reverse().map((entry) => ({
    '월': entry.label,
    '신규 병원 수': entry.newHospitals,
    '신규 병상 수': entry.newBeds,
    '누적 병원 수': entry.totalHospitals,
    '누적 병상 수': entry.totalBeds,
  }))

  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '월별 누적 현황')

  const today = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `월별누적현황_${today}.xlsx`)
}

function fmt(date: string | null, fallback = '-'): string {
  if (!date) return fallback
  return date.slice(0, 10)
}

function fmtShort(date: string | null): string {
  if (!date) return '-'
  return date.slice(5, 10).replace('-', '/')
}

function hospitalName(h: { hospitalName: string; hiraHospitalName: string }): string {
  return h.hospitalName || h.hiraHospitalName
}

function builderName(p: DashboardProject): string {
  if (p.assignees?.length > 0) return p.assignees.map((a) => a.user.name).join(', ')
  if (p.builderNameManual) return p.builderNameManual
  return '-'
}

function buildStatusSummary(projects: DashboardProject[]): string {
  const map = new Map<string, number>()
  for (const p of projects) {
    const label = p.buildStatus?.label ?? '상태없음'
    map.set(label, (map.get(label) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .map(([label, count]) => `${label} ${count}건`)
    .join(' · ')
}

/* ---------- KPI 스탯 타일 ---------- */

function StatTile({ label, value, sub, href, accent }: {
  label: string
  value: string
  sub?: string
  href?: string
  accent?: 'blue' | 'emerald' | 'amber' | 'red'
}) {
  const accentCls =
    accent === 'blue' ? 'text-blue-600 dark:text-blue-400'
    : accent === 'emerald' ? 'text-emerald-600 dark:text-emerald-400'
    : accent === 'amber' ? 'text-amber-600 dark:text-amber-400'
    : accent === 'red' ? 'text-red-600 dark:text-red-400'
    : 'text-gray-900 dark:text-gray-100'
  const body = (
    <div className="h-full rounded-xl border border-gray-200 bg-white px-4 py-3 transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600">
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums leading-none ${accentCls}`}>{value}</div>
      <div className="mt-1 text-[11px] text-gray-400 dark:text-gray-500 truncate">{sub ?? ' '}</div>
    </div>
  )
  return href ? <Link href={href} className="block h-full">{body}</Link> : body
}

/* ---------- 구축 현황 테이블 (비고 인라인 수정) ---------- */

function DashboardTable({
  projects,
  onRemarkSaved,
}: {
  projects: DashboardProject[]
  onRemarkSaved: (code: string, remark: string) => void
}) {
  const router = useRouter()
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [editingRemark, setEditingRemark] = useState('')
  const [saving, setSaving] = useState(false)

  const thClass = 'px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400'
  const tdClass = 'px-3 py-2 text-sm text-gray-700 dark:text-gray-300'

  function startEdit(p: DashboardProject) {
    setEditingCode(p.projectCode)
    setEditingRemark(p.remark ?? '')
  }

  async function saveRemark(code: string) {
    setSaving(true)
    try {
      const res = await fetch(`/api/projects/${code}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remark: editingRemark || null }),
      })
      if (res.ok) {
        router.refresh()
        onRemarkSaved(code, editingRemark)
        setEditingCode(null)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
    {/* 모바일 카드 리스트 */}
    <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-700">
      {projects.map((p) => (
        <div key={p.projectCode} className="p-4">
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`/projects/${p.projectCode}`}
              className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 hover:text-blue-600 hover:underline dark:text-gray-100"
            >
              {hospitalName(p.hospital)}
            </Link>
            <span className="shrink-0">
              {p.buildStatus
                ? <StatusBadge label={p.buildStatus.label} color={p.buildStatus.color} />
                : <span className="text-xs text-gray-400">-</span>}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            <span className="tabular-nums">{fmt(p.startDate)} ~ {fmt(p.endDateExpected, '미정')}</span>
            <span>담당 {builderName(p)}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            {editingCode === p.projectCode ? (
              <>
                <input
                  type="text"
                  value={editingRemark}
                  onChange={(e) => setEditingRemark(e.target.value)}
                  maxLength={200}
                  autoFocus
                  className="w-full min-w-0 flex-1 rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-900"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveRemark(p.projectCode)
                    if (e.key === 'Escape') setEditingCode(null)
                  }}
                />
                <button
                  onClick={() => saveRemark(p.projectCode)}
                  disabled={saving}
                  className="shrink-0 rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? '...' : '저장'}
                </button>
              </>
            ) : (
              <>
                <span className={`min-w-0 flex-1 truncate text-xs ${p.remark ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400'}`}>
                  {p.remark || '비고 없음'}
                </span>
                <button
                  onClick={() => startEdit(p)}
                  className="shrink-0 rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
                >
                  수정
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>

    {/* 데스크톱 테이블 */}
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full table-fixed divide-y divide-gray-100 dark:divide-gray-700">
        <colgroup>
          <col className="w-[170px]" />  {/* 병원명 */}
          <col className="w-[100px]" />  {/* 진행상태 */}
          <col className="w-[88px]" />   {/* 구축 시작일 */}
          <col className="w-[100px]" />  {/* 구축 종료일(예상) */}
          <col className="w-[84px]" />   {/* 담당자 */}
          <col />                        {/* 비고 — 나머지 전부 */}
          <col className="w-[52px]" />   {/* 수정 버튼 */}
        </colgroup>
        <thead className="bg-gray-50 dark:bg-gray-800/60">
          <tr>
            <th className={thClass}>병원명</th>
            <th className={thClass}>진행상태</th>
            <th className={thClass}>시작일</th>
            <th className={thClass}>종료일(예상)</th>
            <th className={thClass}>담당자</th>
            <th className={thClass}>비고</th>
            <th className={thClass}></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {projects.map((p) => (
            <tr key={p.projectCode} className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40">
              <td className={`${tdClass} truncate`}>
                <Link
                  href={`/projects/${p.projectCode}`}
                  className="font-medium text-gray-900 hover:text-blue-600 hover:underline dark:text-gray-100"
                >
                  {hospitalName(p.hospital)}
                </Link>
              </td>
              <td className={`${tdClass} whitespace-nowrap`}>
                {p.buildStatus
                  ? <StatusBadge label={p.buildStatus.label} color={p.buildStatus.color} />
                  : <span className="text-gray-400">-</span>}
              </td>
              <td className={`${tdClass} whitespace-nowrap tabular-nums ${!p.startDate ? 'text-gray-400' : ''}`}>
                {fmtShort(p.startDate)}
              </td>
              <td className={`${tdClass} whitespace-nowrap tabular-nums ${!p.endDateExpected ? 'text-gray-400' : ''}`}>
                {p.endDateExpected ? fmtShort(p.endDateExpected) : '미정'}
              </td>
              <td className={`${tdClass} truncate`}>{builderName(p)}</td>
              <td className={`${tdClass} truncate`}>
                {editingCode === p.projectCode ? (
                  <input
                    type="text"
                    value={editingRemark}
                    onChange={(e) => setEditingRemark(e.target.value)}
                    maxLength={200}
                    autoFocus
                    className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-900"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRemark(p.projectCode)
                      if (e.key === 'Escape') setEditingCode(null)
                    }}
                  />
                ) : (
                  <span className={p.remark ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400'}>
                    {p.remark || '-'}
                  </span>
                )}
              </td>
              <td className={tdClass}>
                {editingCode === p.projectCode ? (
                  <button
                    onClick={() => saveRemark(p.projectCode)}
                    disabled={saving}
                    className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? '...' : '저장'}
                  </button>
                ) : (
                  <button
                    onClick={() => startEdit(p)}
                    className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
                  >
                    수정
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  )
}

/* ---------- 소형 차트 (단일 시리즈 — 축 1개 원칙) ---------- */

function MiniChart({ title, data, dataKey, color, kind, name }: {
  title: string
  data: MonthlyEntry[]
  dataKey: 'totalHospitals' | 'totalBeds' | 'newHospitals' | 'newBeds'
  color: string
  kind: 'line' | 'bar'
  name: string
}) {
  const chart = useChartTheme()
  const axisProps = {
    tick: { fontSize: 10, fill: chart.tick },
    axisLine: false as const,
    tickLine: false as const,
  }
  const tooltipProps = {
    contentStyle: chart.tooltip,
    formatter: (value: unknown) => [typeof value === 'number' ? value.toLocaleString() : String(value), name] as [string, string],
  }
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">{title}</p>
      <ResponsiveContainer width="100%" height={160}>
        {kind === 'line' ? (
          <LineChart data={data} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
            <XAxis dataKey="label" interval="preserveStartEnd" {...axisProps} />
            <YAxis allowDecimals={false} {...axisProps} />
            <Tooltip {...tooltipProps} />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        ) : (
          <BarChart data={data} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
            <XAxis dataKey="label" interval="preserveStartEnd" {...axisProps} />
            <YAxis allowDecimals={false} {...axisProps} />
            <Tooltip {...tooltipProps} cursor={{ fill: chart.grid, opacity: 0.4 }} />
            <Bar dataKey={dataKey} fill={color} opacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={16} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

/* ---------- 메인 ---------- */

export default function Home() {
  const chart = useChartTheme()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [monthly, setMonthly] = useState<MonthlyEntry[] | null>(null)
  const [monthlyLoading, setMonthlyLoading] = useState(true)
  const [hospitalStats, setHospitalStats] = useState<HospitalStats | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [maintenance, setMaintenance] = useState<MaintenanceData | null>(null)
  const [showMonthlyTable, setShowMonthlyTable] = useState(false)

  const loadData = useCallback(async () => {
    const res = await fetch('/api/dashboard', { cache: 'no-store' })
    if (res.ok) setData(await res.json())
    setLoading(false)
  }, [])

  const loadMonthly = useCallback(async () => {
    const res = await fetch('/api/dashboard/monthly', { cache: 'no-store' })
    if (res.ok) setMonthly((await res.json()).months)
    setMonthlyLoading(false)
  }, [])

  const loadHospitalStats = useCallback(async () => {
    const res = await fetch('/api/dashboard/hospital-stats', { cache: 'no-store' })
    if (res.ok) setHospitalStats(await res.json())
  }, [])

  const loadSummary = useCallback(async () => {
    const res = await fetch('/api/dashboard/summary', { cache: 'no-store' })
    if (res.ok) setSummary(await res.json())
  }, [])

  const loadMaintenance = useCallback(async () => {
    const res = await fetch('/api/dashboard/maintenance', { cache: 'no-store' })
    if (res.ok) setMaintenance(await res.json())
  }, [])

  useEffect(() => {
    loadData()
    loadMonthly()
    loadHospitalStats()
    loadSummary()
    loadMaintenance()
  }, [loadData, loadMonthly, loadHospitalStats, loadSummary, loadMaintenance])

  function handleRemarkSaved(code: string, remark: string) {
    if (!data) return
    const update = (projects: DashboardProject[]) =>
      projects.map((p) => p.projectCode === code ? { ...p, remark: remark || null } : p)
    setData({ thisWeek: update(data.thisWeek), nextWeek: update(data.nextWeek) })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <p className="text-sm text-gray-400">불러오는 중...</p>
      </div>
    )
  }

  const thisWeekProjects = data?.thisWeek ?? []
  const nextWeekProjects = data?.nextWeek ?? []
  const chartData = monthly ?? []
  const tableData = [...chartData].reverse()
  const latestEntry = chartData.length > 0 ? chartData[chartData.length - 1] : null
  const mntItems = (maintenance?.items ?? []).slice(0, 7)
  const cardCls = 'overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
  const cardHeadCls = 'flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-700'

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">

        {/* 상단 헤더 — 사이니지 월보드 진입 */}
        <div className="mb-3 flex items-center justify-end">
          <Link
            href="/dashboard"
            target="_blank"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
          >
            <Tv className="h-3.5 w-3.5" />
            사이니지 월보드
          </Link>
        </div>

        {/* KPI 스탯 타일 */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile
            label="도입 병원"
            value={summary ? summary.hospitalCount.toLocaleString() : '—'}
            sub={hospitalStats ? `검토중 ${hospitalStats.totals.reviewing}곳` : undefined}
            href="/hospitals"
            accent="blue"
          />
          <StatTile
            label="도입 병상"
            value={summary ? summary.bedCount.toLocaleString() : '—'}
            sub={latestEntry && latestEntry.newBeds > 0 ? `이번달 +${latestEntry.newBeds.toLocaleString()}` : undefined}
            accent="emerald"
          />
          <StatTile
            label="유지보수 진행중"
            value={maintenance ? String(maintenance.inProgressCount) : '—'}
            sub={mntItems.filter((i) => i.priority === '긴급').length > 0
              ? `긴급 ${mntItems.filter((i) => i.priority === '긴급').length}건 포함` : undefined}
            href="/maintenances"
            accent={mntItems.some((i) => i.priority === '긴급') ? 'red' : undefined}
          />
          <StatTile
            label="이번주 구축"
            value={`${thisWeekProjects.length}건`}
            sub={thisWeekProjects.length > 0 ? buildStatusSummary(thisWeekProjects) : '일정 없음'}
            href="/projects"
          />
          <StatTile
            label="차주 구축 예정"
            value={`${nextWeekProjects.length}건`}
            sub={nextWeekProjects.length > 0 ? '신규 구축' : '일정 없음'}
            href="/projects/calendar"
          />
          <StatTile
            label="누적 도입률"
            value={hospitalStats && hospitalStats.totals.total > 0
              ? `${((hospitalStats.totals.contracted / hospitalStats.totals.total) * 100).toFixed(1)}%`
              : '—'}
            sub={hospitalStats ? `전국 ${hospitalStats.totals.total.toLocaleString()}곳 기준` : undefined}
          />
        </div>

        {/* 메인 그리드: 좌 구축현황 / 우 유지보수·종별 */}
        <div className="mt-4 grid gap-4 lg:grid-cols-3">

          {/* 좌측 2/3 — 이번주·차주 구축 */}
          <div className="space-y-4 lg:col-span-2">
            <div className={cardCls}>
              <div className={cardHeadCls}>
                <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">이번주 thynC 구축 현황</h2>
                {thisWeekProjects.length > 0 && (
                  <span className="text-xs text-gray-400">{buildStatusSummary(thisWeekProjects)}</span>
                )}
              </div>
              {thisWeekProjects.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-gray-400">해당 주차 구축 일정이 없습니다.</p>
              ) : (
                <DashboardTable projects={thisWeekProjects} onRemarkSaved={handleRemarkSaved} />
              )}
            </div>

            <div className={cardCls}>
              <div className={cardHeadCls}>
                <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">차주 thynC 구축 예정</h2>
                {nextWeekProjects.length > 0 && (
                  <span className="text-xs text-gray-400">{nextWeekProjects.length}건 신규구축</span>
                )}
              </div>
              {nextWeekProjects.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-gray-400">해당 주차 구축 일정이 없습니다.</p>
              ) : (
                <DashboardTable projects={nextWeekProjects} onRemarkSaved={handleRemarkSaved} />
              )}
            </div>
          </div>

          {/* 우측 1/3 — 유지보수 진행중 + 종별 현황 */}
          <div className="space-y-4">
            <div className={cardCls}>
              <div className={cardHeadCls}>
                <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">유지보수 진행중</h2>
                <Link href="/maintenances" className="text-xs text-blue-500 hover:underline">
                  전체 {maintenance?.inProgressCount ?? 0}건 →
                </Link>
              </div>
              {mntItems.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-gray-400">진행중인 유지보수가 없습니다.</p>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                  {mntItems.map((m) => (
                    <li key={m.id}>
                      <Link href={`/maintenances/${m.id}`} className="block px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[m.priority] ?? 'bg-gray-300'}`}
                            title={`우선순위 ${m.priority}`}
                          />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800 dark:text-gray-200">
                            {m.hospital?.hospitalName ?? '-'}
                          </span>
                          {m.status && <StatusBadge label={m.status.name} color={m.status.color} />}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 pl-4 text-xs text-gray-500 dark:text-gray-400">
                          <span className="min-w-0 flex-1 truncate">{m.title}</span>
                          <span className="shrink-0 tabular-nums text-gray-400">{fmtShort(m.reportedAt)}</span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className={cardCls}>
              <div className={cardHeadCls}>
                <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">종별 도입 현황</h2>
                <span className="text-xs text-gray-400">도입 / 전국</span>
              </div>
              {!hospitalStats ? (
                <p className="px-6 py-8 text-center text-sm text-gray-400">불러오는 중...</p>
              ) : (
                <div className="space-y-3 px-4 py-3">
                  {hospitalStats.rows.map((row) => {
                    const pct = row.total > 0 ? (row.contracted / row.total) * 100 : 0
                    return (
                      <div key={row.clCdNm}>
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="font-medium text-gray-700 dark:text-gray-300">{row.clCdNm}</span>
                          <span className="tabular-nums text-gray-500 dark:text-gray-400">
                            <strong className="text-emerald-600 dark:text-emerald-400">{row.contracted.toLocaleString()}</strong>
                            {row.reviewing > 0 && <span className="text-blue-500"> (+검토 {row.reviewing})</span>}
                            {' / '}{row.total.toLocaleString()}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${Math.max(pct, row.contracted > 0 ? 2 : 0)}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                  <div className="border-t border-gray-100 pt-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    합계 <strong className="text-emerald-600 dark:text-emerald-400">{hospitalStats.totals.contracted.toLocaleString()}</strong>
                    {' / '}{hospitalStats.totals.total.toLocaleString()}곳
                    {hospitalStats.totals.reviewing > 0 && <span className="ml-1 text-blue-500">(검토중 {hospitalStats.totals.reviewing})</span>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 월별 현황 — 소형 멀티플 4개 (축 1개/차트) */}
        <div className={`mt-4 ${cardCls}`}>
          <div className={cardHeadCls}>
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">월별 도입 추이</h2>
            <div className="flex items-center gap-2">
              {latestEntry && (
                <span className="mr-2 hidden text-xs text-gray-400 sm:inline">
                  누적 병원 <strong className="text-blue-600 dark:text-blue-400">{latestEntry.totalHospitals}</strong>
                  {' · '}누적 병상 <strong className="text-emerald-600 dark:text-emerald-400">{latestEntry.totalBeds.toLocaleString()}</strong>
                </span>
              )}
              <button
                onClick={() => setShowMonthlyTable((v) => !v)}
                className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                {showMonthlyTable ? '표 닫기' : '표 보기'}
              </button>
              <button
                onClick={() => monthly && downloadMonthlyExcel(monthly)}
                disabled={!monthly || monthly.length === 0}
                className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                엑셀 다운로드
              </button>
            </div>
          </div>

          {monthlyLoading ? (
            <p className="px-6 py-10 text-center text-sm text-gray-400">불러오는 중...</p>
          ) : chartData.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-gray-400">구축완료된 프로젝트 데이터가 없습니다.</p>
          ) : (
            <div className="p-4 sm:p-5">
              <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
                <MiniChart title="누적 병원 (개)" data={chartData} dataKey="totalHospitals" color={chart.blue} kind="line" name="누적 병원" />
                <MiniChart title="누적 병상 (개)" data={chartData} dataKey="totalBeds" color={chart.emerald} kind="line" name="누적 병상" />
                <MiniChart title="월별 신규 병원 (개)" data={chartData} dataKey="newHospitals" color={chart.blue} kind="bar" name="신규 병원" />
                <MiniChart title="월별 신규 병상 (개)" data={chartData} dataKey="newBeds" color={chart.emerald} kind="bar" name="신규 병상" />
              </div>

              {showMonthlyTable && (
                <div className="mt-5 overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-700">
                  <table className="w-full divide-y divide-gray-100 text-sm dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-800/60">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400">월</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400">신규 병원</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400">신규 병상</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400">누적 병원</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400">누적 병상</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {tableData.map((row) => {
                        const hasNew = row.newHospitals > 0 || row.newBeds > 0
                        return (
                          <tr
                            key={row.month}
                            className={hasNew ? 'bg-blue-50 font-medium dark:bg-blue-950/30' : 'text-gray-400'}
                          >
                            <td className="px-4 py-2 tabular-nums">{row.label}</td>
                            <td className={`px-4 py-2 text-right tabular-nums ${hasNew ? 'text-blue-700 dark:text-blue-400' : ''}`}>
                              {row.newHospitals > 0 ? `+${row.newHospitals}` : '-'}
                            </td>
                            <td className={`px-4 py-2 text-right tabular-nums ${hasNew ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>
                              {row.newBeds > 0 ? `+${row.newBeds.toLocaleString()}` : '-'}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{row.totalHospitals}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{row.totalBeds.toLocaleString()}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
