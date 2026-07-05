'use client'

/**
 * 운영 관제 월보드 — 50인치 사이니지 전용
 * - 네비게이션 없음(MainWrapper/Navigation에서 제외), 스크롤 없음(h-screen 고정 그리드)
 * - 라이트/다크 토글(헤더), 60초 자동 갱신, 실시간 시계, 전체화면 버튼
 * - 사이니지 원칙: 모든 수치는 호버 없이 상시 표시
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Maximize, Minimize } from 'lucide-react'
import StatusBadge from '@/app/components/StatusBadge'
import ThemeToggle from '@/app/components/theme/ThemeToggle'
import { useChartTheme } from '@/app/components/theme/useChartTheme'
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
} from 'recharts'

/* ── 타입 (기존 API 응답 형태) ── */

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

type SummaryData = {
  hospitalCount: number
  bedCount: number
  byStatus: { status: string; hospitalCount: number; bedCount: number }[]
}

type MonthlyEntry = {
  month: string
  label: string
  newHospitals: number
  newBeds: number
  totalHospitals: number
  totalBeds: number
}

type MaintenanceItem = {
  id: number
  title: string
  priority: string
  reportedAt: string | null
  isRemote: boolean
  hospital: { hospitalName: string }
  status: { name: string; color: string | null } | null
  type: { name: string } | null
  assignees: { user: { name: string } }[]
}

type HospitalStats = {
  rows: { clCdNm: string; total: number; reviewing: number; contracted: number }[]
  totals: { total: number; reviewing: number; contracted: number }
}

type MaintenanceData = {
  inProgressCount: number
  byStatus: { status: string; count: number }[]
  weekly: { weekStart: string; label: string; count: number }[]
  items: MaintenanceItem[]
}

const REFRESH_MS = 60_000
const PROJECT_MAX = 6
const MNT_MAX = 7

function fmtDate(d: string | null): string {
  if (!d) return '-'
  return d.slice(5, 10).replace('-', '.')
}

function assigneeNames(names: { user: { name: string } }[], manual?: string | null): string {
  const list = names.map((a) => a.user.name)
  if (manual) list.push(manual)
  return list.length > 0 ? list.join(', ') : '-'
}

export default function DashboardPage() {
  const chart = useChartTheme()
  const [projects, setProjects] = useState<{ thisWeek: DashboardProject[]; nextWeek: DashboardProject[] } | null>(null)
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [monthly, setMonthly] = useState<MonthlyEntry[] | null>(null)
  const [hospStats, setHospStats] = useState<HospitalStats | null>(null)
  const [maintenance, setMaintenance] = useState<MaintenanceData | null>(null)
  const [now, setNow] = useState<Date | null>(null)
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const [isFull, setIsFull] = useState(false)

  /* 실시간 시계 (hydration mismatch 방지 위해 mount 후 시작) */
  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  /* 데이터 로드 + 60초 폴링 (실패 시 기존 데이터 유지) */
  const loadAll = useCallback(async () => {
    const safeGet = async <T,>(url: string): Promise<T | null> => {
      try {
        const res = await fetch(url, { cache: 'no-store' })
        return res.ok ? await res.json() : null
      } catch {
        return null
      }
    }
    const [prj, sum, mon, mnt, hst] = await Promise.all([
      safeGet<{ thisWeek: DashboardProject[]; nextWeek: DashboardProject[] }>('/api/dashboard'),
      safeGet<SummaryData>('/api/dashboard/summary'),
      safeGet<{ months: MonthlyEntry[] }>('/api/dashboard/monthly'),
      safeGet<MaintenanceData>('/api/dashboard/maintenance'),
      safeGet<HospitalStats>('/api/dashboard/hospital-stats'),
    ])
    if (prj) setProjects(prj)
    if (sum) setSummary(sum)
    if (mon) setMonthly(mon.months)
    if (mnt) setMaintenance(mnt)
    if (hst) setHospStats(hst)
    if (prj || sum || mon || mnt || hst) setLastSync(new Date())
  }, [])

  useEffect(() => {
    loadAll()
    const t = setInterval(loadAll, REFRESH_MS)
    return () => clearInterval(t)
  }, [loadAll])

  /* 전체화면 토글 */
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        setIsFull(false)
      } else {
        await document.documentElement.requestFullscreen()
        setIsFull(true)
      }
    } catch {
      /* 미지원 브라우저 무시 */
    }
  }, [])

  const thisWeek = projects?.thisWeek ?? []
  const nextWeek = projects?.nextWeek ?? []
  // useMemo: 시계(1초) 리렌더마다 새 배열이 생기면 recharts가 데이터 변경으로 오인해 재애니메이션(라벨 깜빡임)
  const chartMonths = useMemo(() => (monthly ?? []).slice(-12), [monthly])
  const doneThisWeek = thisWeek.filter((p) => p.buildStatus?.label?.includes('완료')).length
  const mntItems = maintenance?.items ?? []

  /* 종별 도입 현황: 전국 모수(HIRA) 대비 도입수(계약완료+운영).
     기타는 의원·치과 등 모수가 수만 단위라 도입수만 표시 */
  const typeBreakdown = (() => {
    if (!hospStats) return null
    const MAIN = ['상급종합', '종합병원', '병원'] as const
    const row = (t: string) => hospStats.rows.find((r) => r.clCdNm === t)
    const etcCount = hospStats.rows
      .filter((r) => !(MAIN as readonly string[]).includes(r.clCdNm))
      .reduce((a, r) => a + r.contracted, 0)
    const mk = (label: string) => {
      const r = row(label)
      return { label, count: r?.contracted ?? 0, total: r?.total ?? null }
    }
    return [mk('상급종합'), mk('종합병원'), mk('병원'), { label: '기타', count: etcCount, total: null }]
  })()

  const dateStr = now
    ? `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')} (${['일', '월', '화', '수', '목', '금', '토'][now.getDay()]})`
    : ''
  const timeStr = now
    ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    : ''

  return (
    <div className="flex h-screen flex-col gap-3 overflow-hidden bg-background p-4 text-foreground">

      {/* ═══ 헤더: 타이틀 + 시계 + 컨트롤 ═══ */}
      <header className="flex shrink-0 items-center justify-between rounded-lg border border-border bg-card px-6 py-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Live</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight">thynC 운영 현황</h1>
          {lastSync && (
            <span className="text-xs text-muted-foreground">
              60초 자동 갱신 · 마지막 {String(lastSync.getHours()).padStart(2, '0')}:{String(lastSync.getMinutes()).padStart(2, '0')}:{String(lastSync.getSeconds()).padStart(2, '0')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-base text-muted-foreground">{dateStr}</span>
          <span className="font-mono text-3xl font-bold tabular-nums tracking-tight">{timeStr}</span>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label="전체화면"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {isFull ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        </div>
      </header>

      {/* ═══ KPI 타일: 5종 + 종별 현황(2칸) ═══ */}
      <div className="grid shrink-0 grid-cols-7 gap-3">
        <KpiTile
          label="도입병원"
          value={summary?.hospitalCount}
          unit="개"
          accent="text-blue-600"
          sub={summary?.byStatus.map((s) => `${s.status} ${s.hospitalCount}`).join(' · ')}
        />
        <KpiTile
          label="도입병상"
          value={summary?.bedCount}
          unit="병상"
          accent="text-emerald-600"
          sub={summary?.byStatus.map((s) => `${s.status} ${s.bedCount.toLocaleString()}`).join(' · ')}
        />
        <TypeBreakdownTile data={typeBreakdown} />
        <KpiTile
          label="유지보수 진행중"
          value={maintenance?.inProgressCount}
          unit="건"
          accent="text-amber-600"
          sub={maintenance?.byStatus.map((s) => `${s.status} ${s.count}`).join(' · ')}
        />
        <KpiTile
          label="이번주 구축"
          value={thisWeek.length}
          unit="건"
          accent="text-blue-600"
          sub={thisWeek.length > 0 ? `완료 ${doneThisWeek} / ${thisWeek.length}` : '일정 없음'}
        />
        <KpiTile
          label="차주 구축 예정"
          value={nextWeek.length}
          unit="건"
          accent="text-purple-600"
          sub={nextWeek.length > 0 ? '신규 구축 대기' : '일정 없음'}
        />
      </div>

      {/* ═══ 중단: 월별 추이 차트 + 유지보수 진행중 내역 ═══ */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <Panel title="월별 누적 도입 현황" badge={chartMonths.length > 0 ? `최근 ${chartMonths.length}개월` : undefined}
          headerRight={
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: chart.blue }} />병원
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: chart.amber }} />병상
              </span>
            </div>
          }
        >
          {chartMonths.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartMonths} margin={{ top: 28, right: 14, left: 14, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 13, fill: chart.tick }} axisLine={false} tickLine={false} tickFormatter={(v: string) => v.replace('년 ', '.').replace('월', '')} />
                {/* 사이니지: 축 눈금 대신 데이터 라벨 상시 표시.
                    라인(병원)=상단 밴드 · 바(병상)=하단 밴드로 분리해 라벨 겹침 방지 */}
                <YAxis yAxisId="h" hide domain={[0, (max: number) => Math.ceil(max * 1.08)]} />
                <YAxis yAxisId="b" hide domain={[0, (max: number) => Math.ceil(max * 1.75)]} />
                <Bar yAxisId="b" dataKey="totalBeds" name="누적 병상" fill={chart.amber} radius={[4, 4, 0, 0]} maxBarSize={38} opacity={0.9} isAnimationActive={false}>
                  <LabelList dataKey="totalBeds" position="top" offset={6} formatter={(v) => Number(v).toLocaleString()} style={{ fontSize: 13, fontWeight: 700, fill: chart.dark ? '#FCD34D' : '#B45309' }} />
                </Bar>
                <Line yAxisId="h" dataKey="totalHospitals" name="누적 병원" stroke={chart.blue} strokeWidth={2.5} dot={{ r: 4, fill: chart.blue }} isAnimationActive={false}>
                  <LabelList dataKey="totalHospitals" position="top" offset={12} style={{ fontSize: 15, fontWeight: 700, fill: chart.blue }} />
                </Line>
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel
          title="유지보수 진행중 내역"
          badge={maintenance ? `${maintenance.inProgressCount}건` : undefined}
          headerRight={
            mntItems.length > MNT_MAX
              ? <span className="text-sm text-muted-foreground">최신 {MNT_MAX}건 표시 · 외 {(maintenance?.inProgressCount ?? 0) - MNT_MAX}건</span>
              : undefined
          }
        >
          {mntItems.length === 0 ? (
            <Empty text="진행중인 유지보수가 없습니다 🎉" />
          ) : (
            <div className="flex h-full flex-col gap-1 overflow-hidden">
              {mntItems.slice(0, MNT_MAX).map((m) => (
                <div key={m.id} className="flex items-center gap-3 rounded-md bg-muted/40 px-4 py-1.5">
                  <span className="w-6 shrink-0 text-center">
                    {m.priority === '긴급' ? <span className="font-bold text-destructive">!</span>
                      : m.priority === '높음' ? <span className="font-bold text-warning">▲</span>
                      : <span className="text-muted-foreground/40">·</span>}
                  </span>
                  <span className="w-40 shrink-0 truncate font-medium">{m.hospital.hospitalName}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {m.type ? `[${m.type.name}] ` : ''}{m.title}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{fmtDate(m.reportedAt)}</span>
                  <span className="w-24 shrink-0 truncate text-right text-sm text-muted-foreground">
                    {assigneeNames(m.assignees)}
                  </span>
                  <span className="shrink-0">
                    {m.status
                      ? <StatusBadge label={m.status.name} color={m.status.color} />
                      : <StatusBadge label="미지정" />}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ═══ 하단: 구축 리스트 2단 ═══ */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <ProjectList title="이번주 구축 현황" projects={thisWeek} emptyText="이번주 구축 일정이 없습니다" />
        <ProjectList title="차주 구축 예정" projects={nextWeek} emptyText="차주 구축 일정이 없습니다" />
      </div>
    </div>
  )
}

/* ── 종별 도입 현황 타일 (2칸 폭, 4분할 — 전국 모수 대비 도입) ── */
function TypeBreakdownTile({ data }: {
  data: { label: string; count: number; total: number | null }[] | null
}) {
  const cells = data ?? ([
    { label: '상급종합', count: -1, total: null },
    { label: '종합병원', count: -1, total: null },
    { label: '병원', count: -1, total: null },
    { label: '기타', count: -1, total: null },
  ] as { label: string; count: number; total: number | null }[])
  return (
    <div className="col-span-2 rounded-lg border border-border bg-card px-5 py-4">
      <p className="text-sm font-medium text-muted-foreground">종별 도입 현황 <span className="font-normal text-muted-foreground/60">— 전국 대비</span></p>
      <div className="mt-2 grid grid-cols-4 divide-x divide-border">
        {cells.map((d) => (
          <div key={d.label} className="px-2 text-center first:pl-0 last:pr-0">
            <p className="whitespace-nowrap text-2xl font-bold tabular-nums tracking-tight 2xl:text-3xl">
              {d.count < 0 ? (
                <span className="text-muted-foreground/40">—</span>
              ) : (
                <>
                  <span className="text-blue-600">{d.count.toLocaleString()}</span>
                  {d.total !== null && (
                    <span className="text-sm font-medium text-muted-foreground"> /{d.total.toLocaleString()}</span>
                  )}
                </>
              )}
            </p>
            <p className="mt-1 whitespace-nowrap text-xs text-muted-foreground">
              {d.label}
              {d.count >= 0 && d.total !== null && d.total > 0 && (
                <span className="ml-1 font-semibold text-emerald-600">{Math.round((d.count / d.total) * 100)}%</span>
              )}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── KPI 타일 ── */
function KpiTile({ label, value, unit, accent, sub }: {
  label: string
  value: number | undefined
  unit: string
  accent: string
  sub?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-4xl font-bold tabular-nums tracking-tight 2xl:text-5xl">
        {value === undefined ? <span className="text-muted-foreground/40">—</span> : (
          <span className={accent}>{value.toLocaleString()}</span>
        )}
        <span className="ml-1 text-base font-medium text-muted-foreground">{unit}</span>
      </p>
      <p className="mt-1.5 truncate text-xs text-muted-foreground">{sub || ' '}</p>
    </div>
  )
}

/* ── 패널 래퍼 ── */
function Panel({ title, badge, headerRight, children }: {
  title: string
  badge?: string
  headerRight?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-col rounded-lg border border-border bg-card">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-semibold">{title}</h2>
          {badge && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{badge}</span>}
        </div>
        {headerRight}
      </div>
      <div className="min-h-0 flex-1 p-4">{children}</div>
    </div>
  )
}

/* ── 구축 리스트 ── */
function ProjectList({ title, projects, emptyText }: {
  title: string
  projects: DashboardProject[]
  emptyText: string
}) {
  const shown = projects.slice(0, PROJECT_MAX)
  const rest = projects.length - shown.length
  return (
    <Panel
      title={title}
      badge={projects.length > 0 ? `${projects.length}건` : undefined}
      headerRight={rest > 0 ? <span className="text-sm text-muted-foreground">외 {rest}건</span> : undefined}
    >
      {projects.length === 0 ? (
        <Empty text={emptyText} />
      ) : (
        <div className="flex h-full flex-col justify-start gap-1 overflow-hidden">
          {shown.map((p) => (
            <div
              key={p.projectCode}
              className="flex items-center gap-3 rounded-md bg-muted/40 px-4 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-base font-medium">
                {p.hospital.hospitalName || p.hospital.hiraHospitalName}
              </span>
              <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                {fmtDate(p.startDate)} ~ {fmtDate(p.endDateExpected)}
              </span>
              <span className="w-32 shrink-0 truncate text-right text-sm text-muted-foreground">
                {assigneeNames(p.assignees, p.builderNameManual)}
              </span>
              <span className="shrink-0">
                {p.buildStatus
                  ? <StatusBadge label={p.buildStatus.label} color={p.buildStatus.color} />
                  : <StatusBadge label="미지정" />}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

function Empty({ text = '데이터가 없습니다' }: { text?: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground/60">{text}</p>
    </div>
  )
}
