'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { useChartTheme } from '@/app/components/theme/useChartTheme'

type SummaryData = {
  hospitalCount: number
  bedCount: number
  byStatus: { status: string; hospitalCount: number; bedCount: number }[]
}

type MaintenanceData = {
  inProgressCount: number
  byStatus: { status: string; count: number }[]
  weekly: { weekStart: string; label: string; count: number }[]
}

const STATUS_COLORS: Record<string, string> = {
  '접수': '#3B82F6',
  '처리중': '#F59E0B',
  '완료': '#10B981',
  '보류': '#6B7280',
}

export default function DashboardPage() {
  const chart = useChartTheme()
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [maintenance, setMaintenance] = useState<MaintenanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [mntLoading, setMntLoading] = useState(true)

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/summary', { cache: 'no-store' })
      if (res.ok) setSummary(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMaintenance = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/maintenance', { cache: 'no-store' })
      if (res.ok) setMaintenance(await res.json())
    } finally {
      setMntLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSummary()
    loadMaintenance()
  }, [loadSummary, loadMaintenance])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">대시보드</h1>
          <p className="mt-1 text-sm text-gray-500">thynC 운영 현황을 한눈에 확인합니다.</p>
        </div>

        {/* 도입 현황 카드 */}
        {loading ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="animate-pulse rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="h-4 w-20 rounded bg-gray-200" />
                <div className="mt-4 h-10 w-32 rounded bg-gray-200" />
                <div className="mt-3 h-3 w-48 rounded bg-gray-100" />
              </div>
            ))}
          </div>
        ) : summary ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">

            {/* 도입병원 수 */}
            <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-blue-50" />
              <div className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-500">도입병원 수</p>
              <p className="mt-3 text-4xl font-bold tracking-tight text-gray-900">
                {summary.hospitalCount.toLocaleString()}
                <span className="ml-1 text-lg font-medium text-gray-400">개</span>
              </p>
              <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
                {summary.byStatus.map((s) => (
                  <span key={s.status}>
                    {s.status}{' '}
                    <span className={s.status === '운영' ? 'font-semibold text-blue-600' : 'font-semibold text-emerald-600'}>
                      {s.hospitalCount.toLocaleString()}
                    </span>
                  </span>
                ))}
              </div>
            </div>

            {/* 도입병상 수 */}
            <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-emerald-50" />
              <div className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
                <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-500">도입병상 수</p>
              <p className="mt-3 text-4xl font-bold tracking-tight text-gray-900">
                {summary.bedCount.toLocaleString()}
                <span className="ml-1 text-lg font-medium text-gray-400">병상</span>
              </p>
              <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
                {summary.byStatus.map((s) => (
                  <span key={s.status}>
                    {s.status}{' '}
                    <span className={s.status === '운영' ? 'font-semibold text-blue-600' : 'font-semibold text-emerald-600'}>
                      {s.bedCount.toLocaleString()}
                    </span>
                  </span>
                ))}
              </div>
            </div>

          </div>
        ) : (
          <p className="text-sm text-gray-400">데이터를 불러올 수 없습니다.</p>
        )}

        {/* 유지보수 현황 */}
        <div className="mt-8">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">유지보수 현황</h2>

          {mntLoading ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="animate-pulse rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="h-4 w-20 rounded bg-gray-200" />
                <div className="mt-4 h-10 w-16 rounded bg-gray-200" />
              </div>
              <div className="animate-pulse rounded-xl border border-gray-200 bg-white p-6 shadow-sm lg:col-span-2">
                <div className="h-4 w-32 rounded bg-gray-200" />
                <div className="mt-4 h-40 rounded bg-gray-100" />
              </div>
            </div>
          ) : maintenance ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

              {/* 진행중 건수 카드 */}
              <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-amber-50" />
                <div className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100">
                  <svg className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.049.58.025 1.193-.14 1.743" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-500">진행중</p>
                <p className="mt-3 text-4xl font-bold tracking-tight text-gray-900">
                  {maintenance.inProgressCount}
                  <span className="ml-1 text-lg font-medium text-gray-400">건</span>
                </p>
                {maintenance.byStatus.length > 0 && (
                  <div className="mt-4 space-y-1.5">
                    {maintenance.byStatus.map((s) => (
                      <div key={s.status} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: STATUS_COLORS[s.status] || '#9CA3AF' }}
                          />
                          <span className="text-gray-500">{s.status}</span>
                        </div>
                        <span className="font-semibold text-gray-700">{s.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 주간 등록건수 차트 */}
              <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm lg:col-span-2">
                <p className="mb-4 text-sm font-medium text-gray-500">주간 등록건수 (최근 12주)</p>
                {maintenance.weekly.every((w) => w.count === 0) ? (
                  <div className="flex h-48 items-center justify-center">
                    <p className="text-sm text-gray-400">등록된 유지보수 데이터가 없습니다.</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={maintenance.weekly} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: chart.tick }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: chart.tick }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={chart.tooltip}
                        formatter={(value) => [`${value}건`, '등록건수']}
                        labelFormatter={(label) => `${label} 주`}
                      />
                      <Bar
                        dataKey="count"
                        fill={chart.amber}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={36}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

            </div>
          ) : (
            <p className="text-sm text-gray-400">데이터를 불러올 수 없습니다.</p>
          )}
        </div>

      </div>
    </div>
  )
}
