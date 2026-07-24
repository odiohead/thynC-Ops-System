'use client'

/**
 * 티켓 프로세스 지표 대시보드 (P12 — ticket_dev_schedule.md)
 * 데이터: GET /api/tickets/metrics (필드 기반 전 기간 + 체류는 statusChangedAt 보완)
 * 담당별 처리량 표는 ADMIN 이상에게만 응답에 포함(perOwner) — 있으면 렌더.
 * 차트 팔레트는 useChartTheme(라이트/다크 분기) — dataviz 검증 통과 조합만 사용:
 *   2시리즈(생성/종결) light #2C5CE5/#10B981 · dark #4B7BFF/#059669
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { useChartTheme } from '@/app/components/theme/useChartTheme'
import TicketStatusBadge from '@/app/tickets/components/TicketStatusBadge'
import TicketSeverityBadge from '@/app/tickets/components/TicketSeverityBadge'
import type { TicketStatus, TicketSeverity } from '@prisma/client'

interface Metrics {
  kpi: {
    open: number
    unassigned: number
    slaOverdue: number
    closedThisWeek: number
    avgResolutionDays90: number | null
    reopenRate: { reopened: number; resolvedEver: number; pct: number }
  }
  monthly: { ym: string; created: number; closed: number; medianDays: number | null; avgDays: number | null; slaRate: number | null; slaTotal: number }[]
  bySeverity: { severity: string; open: number }[]
  byQueue: { queueId: number; name: string; open: number }[]
  byRefType: { refType: string | null; open: number }[]
  perOwner?: { ownerId: string; name: string; closed: number; avgDays: number | null; openLoad: number }[]
  dwellTop: { ticketCode: string; title: string; status: string; severity: string; queueName: string; refType: string | null; days: number }[]
  filters: { months: number; queueId: number | null; refType: string | null }
}

const MONTH_OPTIONS = [
  { value: 3, label: '최근 3개월' },
  { value: 6, label: '최근 6개월' },
  { value: 12, label: '최근 12개월' },
  { value: 0, label: '전체 기간' },
]

const REF_TYPE_LABELS: Record<string, string> = {
  MAINTENANCE: '유지보수',
  ETC: '기타업무',
  SITE_VISIT: '답사',
  INSTALL_PLAN: '설치계획',
  PROJECT: '프로젝트',
  PURE: '순수 티켓',
}

const SEV_ORDER = ['SEV1', 'SEV2', 'SEV3', 'SEV4', 'SEV5']

export default function TicketDashboardPage() {
  const chart = useChartTheme()
  const [data, setData] = useState<Metrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [months, setMonths] = useState(6)
  const [queueId, setQueueId] = useState<number | ''>('')
  const [refType, setRefType] = useState('')
  const [queues, setQueues] = useState<{ id: number; name: string }[]>([])
  const [showTable, setShowTable] = useState(false)

  // 종결 시리즈 색 — 다크는 검증 통과 스텝(#059669)으로 별도 지정 (validate_palette PASS)
  const closedColor = chart.dark ? '#059669' : '#10B981'
  const createdColor = chart.blue

  useEffect(() => {
    // 큐 필터 옵션 (VIEWER는 403 → 필터 숨김)
    fetch('/api/settings/ticket-queues')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setQueues((d?.queues ?? []).filter((q: { isActive: boolean }) => q.isActive)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ months: String(months) })
    if (queueId !== '') params.set('queueId', String(queueId))
    if (refType) params.set('refType', refType)
    fetch(`/api/tickets/metrics?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .finally(() => setLoading(false))
  }, [months, queueId, refType])

  const sevData = useMemo(() => {
    const map = new Map((data?.bySeverity ?? []).map((r) => [r.severity, r.open]))
    return SEV_ORDER.map((s) => ({ label: s.replace('SEV', 'Sev'), open: map.get(s) ?? 0 }))
  }, [data])

  const typeData = useMemo(
    () =>
      (data?.byRefType ?? []).map((r) => ({
        label: r.refType ? REF_TYPE_LABELS[r.refType] ?? r.refType : '순수',
        open: r.open,
      })),
    [data]
  )

  const axisProps = {
    tick: { fontSize: 10, fill: chart.tick },
    axisLine: false as const,
    tickLine: false as const,
  }
  const tooltipProps = { contentStyle: chart.tooltip }

  if (!data && loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <p className="text-sm text-gray-500">지표를 불러오는 중…</p>
        </div>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <p className="text-sm text-red-500">지표를 불러오지 못했습니다.</p>
        </div>
      </div>
    )
  }

  const { kpi } = data

  const kpiTiles = [
    { label: '열린 티켓', value: kpi.open.toLocaleString(), href: '/tickets', accent: false },
    { label: '미배정', value: kpi.unassigned.toLocaleString(), href: '/tickets', accent: kpi.unassigned > 0 },
    { label: 'SLA 초과', value: kpi.slaOverdue.toLocaleString(), href: '/tickets', accent: kpi.slaOverdue > 0, danger: kpi.slaOverdue > 0 },
    { label: '이번 주 종결', value: kpi.closedThisWeek.toLocaleString(), href: null, accent: false },
    { label: '평균 해결 소요 (90일)', value: kpi.avgResolutionDays90 === null ? '—' : `${kpi.avgResolutionDays90}일`, href: null, accent: false },
    { label: '재오픈율', value: `${kpi.reopenRate.pct}%`, sub: `${kpi.reopenRate.reopened}/${kpi.reopenRate.resolvedEver}건`, href: null, accent: false },
  ] as { label: string; value: string; sub?: string; href: string | null; accent: boolean; danger?: boolean }[]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">티켓 대시보드</h1>
            <p className="mt-1 text-sm text-gray-500">프로세스 지표 — 해결 소요·SLA·처리량·체류 (P12)</p>
          </div>
          <Link
            href="/tickets"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            ← 티켓 목록
          </Link>
        </div>

        {/* KPI 타일 */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {kpiTiles.map((t) => {
            const inner = (
              <div className={`rounded-xl border bg-white p-4 ${t.danger ? 'border-red-300' : 'border-gray-200'} ${t.href ? 'transition-shadow hover:shadow-md' : ''}`}>
                <p className="text-xs text-gray-500">{t.label}</p>
                <p className={`mt-1 text-2xl font-bold ${t.danger ? 'text-red-600' : 'text-gray-900'}`}>{t.value}</p>
                {t.sub && <p className="mt-0.5 text-xs text-gray-400">{t.sub}</p>}
              </div>
            )
            return t.href ? <Link key={t.label} href={t.href}>{inner}</Link> : <div key={t.label}>{inner}</div>
          })}
        </div>

        {/* 필터 바 */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <select
            value={months}
            onChange={(e) => setMonths(parseInt(e.target.value))}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700"
          >
            {MONTH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {queues.length > 0 && (
            <select
              value={queueId}
              onChange={(e) => setQueueId(e.target.value === '' ? '' : parseInt(e.target.value))}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700"
            >
              <option value="">전체 큐</option>
              {queues.map((q) => (
                <option key={q.id} value={q.id}>{q.name}</option>
              ))}
            </select>
          )}
          <select
            value={refType}
            onChange={(e) => setRefType(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700"
          >
            <option value="">전체 유형</option>
            {Object.entries(REF_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          {loading && <span className="text-xs text-gray-400">갱신 중…</span>}
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            className="ml-auto rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            {showTable ? '표 닫기' : '월별 표로 보기'}
          </button>
        </div>

        {/* 월별 표 (차트 색 대비 보완 — 표 뷰) */}
        {showTable && (
          <div className="mb-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th className="px-3 py-2">월</th>
                  <th className="px-3 py-2 text-right">생성</th>
                  <th className="px-3 py-2 text-right">종결</th>
                  <th className="px-3 py-2 text-right">해결 소요 중앙값(일)</th>
                  <th className="px-3 py-2 text-right">SLA 준수율</th>
                </tr>
              </thead>
              <tbody>
                {data.monthly.map((m) => (
                  <tr key={m.ym} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-1.5 text-gray-700">{m.ym}</td>
                    <td className="px-3 py-1.5 text-right text-gray-700">{m.created}</td>
                    <td className="px-3 py-1.5 text-right text-gray-700">{m.closed}</td>
                    <td className="px-3 py-1.5 text-right text-gray-700">{m.medianDays ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right text-gray-700">{m.slaRate === null ? '—' : `${m.slaRate}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 차트 2×2 */}
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="월별 생성 vs 종결 (건)">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.monthly} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="ym" interval="preserveStartEnd" {...axisProps} />
                <YAxis allowDecimals={false} {...axisProps} />
                <Tooltip {...tooltipProps} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar name="생성" dataKey="created" fill={createdColor} radius={[3, 3, 0, 0]} maxBarSize={14} />
                <Bar name="종결" dataKey="closed" fill={closedColor} radius={[3, 3, 0, 0]} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="해결 소요 중앙값 추이 (일)">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.monthly} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="ym" interval="preserveStartEnd" {...axisProps} />
                <YAxis {...axisProps} />
                <Tooltip {...tooltipProps} formatter={(v) => [`${v ?? '—'}일`, '중앙값']} />
                <Line type="monotone" dataKey="medianDays" name="중앙값" stroke={createdColor} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="SLA 준수율 추이 (%) — 기한 보유 종결 기준">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.monthly} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="ym" interval="preserveStartEnd" {...axisProps} />
                <YAxis domain={[0, 100]} {...axisProps} />
                <Tooltip {...tooltipProps} formatter={(v) => [`${v ?? '—'}%`, '준수율']} />
                <Line type="monotone" dataKey="slaRate" name="준수율" stroke={closedColor} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="열린 티켓 분포 — Sev · 유형">
            <div className="grid grid-cols-2 gap-2">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={sevData} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                  <CartesianGrid stroke={chart.grid} vertical={false} />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis allowDecimals={false} {...axisProps} />
                  <Tooltip {...tooltipProps} />
                  <Bar name="열린 티켓" dataKey="open" fill={chart.indigo} radius={[3, 3, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={typeData} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                  <CartesianGrid stroke={chart.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: chart.tick }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} {...axisProps} />
                  <Tooltip {...tooltipProps} />
                  <Bar name="열린 티켓" dataKey="open" fill={chart.indigo} radius={[3, 3, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* 큐별 열린 티켓 + 담당별 처리량 (ADMIN) */}
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-gray-900">큐별 열린 티켓</h2>
              {data.byQueue.length === 0 ? (
                <p className="text-sm text-gray-400">열린 티켓이 없습니다.</p>
              ) : (
                <div className="space-y-2">
                  {data.byQueue.map((q) => {
                    const max = Math.max(...data.byQueue.map((x) => x.open))
                    return (
                      <div key={q.queueId} className="flex items-center gap-2 text-sm">
                        <span className="w-24 shrink-0 truncate text-gray-600" title={q.name}>{q.name}</span>
                        <div className="h-4 flex-1 rounded bg-gray-100">
                          <div
                            className="h-4 rounded"
                            style={{ width: `${max > 0 ? Math.max((q.open / max) * 100, 2) : 0}%`, backgroundColor: chart.indigo }}
                          />
                        </div>
                        <span className="w-8 shrink-0 text-right font-medium text-gray-900">{q.open}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {data.perOwner && (
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <h2 className="mb-1 text-sm font-semibold text-gray-900">담당별 처리량</h2>
                <p className="mb-3 text-xs text-gray-400">기간 내 종결 기준 · ADMIN 이상에게만 표시</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                        <th className="py-1.5 pr-2">담당자</th>
                        <th className="py-1.5 pr-2 text-right">종결</th>
                        <th className="py-1.5 pr-2 text-right">평균 소요(일)</th>
                        <th className="py-1.5 text-right">열린 부하</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.perOwner.map((o) => (
                        <tr key={o.ownerId} className="border-b border-gray-100 last:border-0">
                          <td className="py-1.5 pr-2 text-gray-700">{o.name}</td>
                          <td className="py-1.5 pr-2 text-right font-medium text-gray-900">{o.closed}</td>
                          <td className="py-1.5 pr-2 text-right text-gray-700">{o.avgDays ?? '—'}</td>
                          <td className="py-1.5 text-right text-gray-700">{o.openLoad}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* 현 상태 장기 체류 Top 10 */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="mb-1 text-sm font-semibold text-gray-900">현 상태 장기 체류 Top 10</h2>
            <p className="mb-3 text-xs text-gray-400">
              현재 상태에 머문 일수 기준. 상태·큐 체류 통계는 P11 전환 이후 이벤트가 축적되면 고도화 예정
            </p>
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                    <th className="w-32 py-1.5 pr-2">Ticket #</th>
                    <th className="py-1.5 pr-2">Title</th>
                    <th className="w-20 py-1.5 pr-2">Status</th>
                    <th className="w-14 py-1.5 pr-2">Sev</th>
                    <th className="w-16 py-1.5 text-right">체류(일)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dwellTop.map((t) => (
                    <tr key={t.ticketCode} className="border-b border-gray-100 last:border-0">
                      <td className="py-1.5 pr-2">
                        <Link href={`/tickets/${t.ticketCode}`} className="font-mono text-xs text-blue-600 hover:underline">
                          {t.ticketCode}
                        </Link>
                      </td>
                      <td className="truncate py-1.5 pr-2 text-gray-700" title={t.title}>{t.title}</td>
                      <td className="py-1.5 pr-2"><TicketStatusBadge status={t.status as TicketStatus} /></td>
                      <td className="py-1.5 pr-2"><TicketSeverityBadge severity={t.severity as TicketSeverity} short /></td>
                      <td className="py-1.5 text-right font-medium text-gray-900">{t.days}</td>
                    </tr>
                  ))}
                  {data.dwellTop.length === 0 && (
                    <tr><td colSpan={5} className="py-4 text-center text-sm text-gray-400">열린 티켓이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">{title}</h2>
      {children}
    </div>
  )
}
