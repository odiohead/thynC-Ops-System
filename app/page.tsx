'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import StatusBadge from '@/app/components/StatusBadge'
import * as XLSX from 'xlsx'
import {
  ComposedChart,
  LineChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

type DashboardProject = {
  projectCode: string
  startDate: string | null
  endDateExpected: string | null
  remark: string | null
  builderUserId: string | null
  builderNameManual: string | null
  hospital: { hospitalName: string; hiraHospitalName: string }
  buildStatus: { label: string; color: string | null } | null
  builder: { name: string } | null
}

type DashboardData = {
  thisWeek: DashboardProject[]
  nextWeek: DashboardProject[]
}

type MonthlyEntry = {
  month: string
  label: string
  newHospitals: number
  newBeds: number
  totalHospitals: number
  totalBeds: number
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

function hospitalName(h: { hospitalName: string; hiraHospitalName: string }): string {
  return h.hospitalName || h.hiraHospitalName
}

function builderName(p: DashboardProject): string {
  if (p.builder?.name) return p.builder.name
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

  const thClass = 'px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500'
  const tdClass = 'px-4 py-3 text-sm text-gray-700'

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
    <div className="overflow-x-auto">
      <table className="w-full table-fixed divide-y divide-gray-100">
        <colgroup>
          <col className="w-[180px]" />  {/* 병원명 */}
          <col className="w-[110px]" />  {/* 진행상태 */}
          <col className="w-[96px]" />   {/* 구축 시작일 */}
          <col className="w-[110px]" />  {/* 구축 종료일(예상) */}
          <col className="w-[90px]" />   {/* 담당자 */}
          <col />                        {/* 비고 — 나머지 전부 */}
          <col className="w-[56px]" />   {/* 수정 버튼 */}
        </colgroup>
        <thead className="bg-gray-50">
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
        <tbody className="divide-y divide-gray-100">
          {projects.map((p) => (
            <tr key={p.projectCode} className="transition-colors hover:bg-gray-50">
              <td className={`${tdClass} truncate`}>
                <Link
                  href={`/projects/${p.projectCode}`}
                  className="font-medium text-gray-900 hover:text-blue-600 hover:underline"
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
                {fmt(p.startDate)}
              </td>
              <td className={`${tdClass} whitespace-nowrap tabular-nums ${!p.endDateExpected ? 'text-gray-400' : ''}`}>
                {fmt(p.endDateExpected, '미정')}
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
                    className="w-full rounded border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRemark(p.projectCode)
                      if (e.key === 'Escape') setEditingCode(null)
                    }}
                  />
                ) : (
                  <span className={p.remark ? 'text-gray-700' : 'text-gray-400'}>
                    {p.remark || '-'}
                  </span>
                )}
              </td>
              <td className={tdClass}>
                {editingCode === p.projectCode ? (
                  <button
                    onClick={() => saveRemark(p.projectCode)}
                    disabled={saving}
                    className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? '...' : '저장'}
                  </button>
                ) : (
                  <button
                    onClick={() => startEdit(p)}
                    className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50"
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
  )
}

export default function Home() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [monthly, setMonthly] = useState<MonthlyEntry[] | null>(null)
  const [monthlyLoading, setMonthlyLoading] = useState(true)

  const loadData = useCallback(async () => {
    const res = await fetch('/api/dashboard', { cache: 'no-store' })
    if (res.ok) {
      setData(await res.json())
    }
    setLoading(false)
  }, [])

  const loadMonthly = useCallback(async () => {
    const res = await fetch('/api/dashboard/monthly', { cache: 'no-store' })
    if (res.ok) {
      const json = await res.json()
      setMonthly(json.months)
    }
    setMonthlyLoading(false)
  }, [])

  useEffect(() => {
    loadData()
    loadMonthly()
  }, [loadData, loadMonthly])

  function handleRemarkSaved(code: string, remark: string) {
    if (!data) return
    const update = (projects: DashboardProject[]) =>
      projects.map((p) => p.projectCode === code ? { ...p, remark: remark || null } : p)
    setData({ thisWeek: update(data.thisWeek), nextWeek: update(data.nextWeek) })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">불러오는 중...</p>
      </div>
    )
  }

  const thisWeekProjects = data?.thisWeek ?? []
  const nextWeekProjects = data?.nextWeek ?? []

  // 차트용 데이터: 오름차순 (오래된 월 → 최신)
  const chartData = monthly ?? []
  // 테이블용: 내림차순 (최신 월 상단)
  const tableData = [...chartData].reverse()

  const latestEntry = chartData.length > 0 ? chartData[chartData.length - 1] : null

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">대시보드</h1>
          <p className="mt-1 text-sm text-gray-500">thynC 구축 현황을 확인합니다.</p>
        </div>

        <div className="space-y-6">

          {/* 이번주 구축현황 */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-700">이번주 thynC 구축 현황</h2>
              {thisWeekProjects.length > 0 && (
                <span className="text-xs text-gray-400">{buildStatusSummary(thisWeekProjects)}</span>
              )}
            </div>
            {thisWeekProjects.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-gray-400">해당 주차 구축 일정이 없습니다.</p>
            ) : (
              <DashboardTable projects={thisWeekProjects} onRemarkSaved={handleRemarkSaved} />
            )}
          </div>

          {/* 차주 구축현황 */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-700">차주 thynC 구축 예정</h2>
              {nextWeekProjects.length > 0 && (
                <span className="text-xs text-gray-400">{nextWeekProjects.length}건 신규구축</span>
              )}
            </div>
            {nextWeekProjects.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-gray-400">해당 주차 구축 일정이 없습니다.</p>
            ) : (
              <DashboardTable projects={nextWeekProjects} onRemarkSaved={handleRemarkSaved} />
            )}
          </div>

          {/* 월별 누적 사용 현황 */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-700">월별 누적 사용 현황</h2>
              <div className="flex items-center gap-4">
                {latestEntry && (
                  <div className="flex gap-4 text-xs text-gray-500">
                    <span>누적 병원 <strong className="text-blue-600">{latestEntry.totalHospitals}개</strong></span>
                    <span>누적 병상 <strong className="text-emerald-600">{latestEntry.totalBeds.toLocaleString()}개</strong></span>
                  </div>
                )}
                <button
                  onClick={() => monthly && downloadMonthlyExcel(monthly)}
                  disabled={!monthly || monthly.length === 0}
                  className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
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
              <div className="px-6 py-6 space-y-8">

                {/* 누적 추이 라인 차트 */}
                <div>
                  <p className="mb-2 text-xs font-medium text-gray-500">누적 현황</p>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={chartData} margin={{ top: 4, right: 24, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: '#6b7280' }}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        yAxisId="left"
                        orientation="left"
                        tick={{ fontSize: 11, fill: '#3b82f6' }}
                        label={{ value: '병원(개)', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#3b82f6' } }}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 11, fill: '#10b981' }}
                        label={{ value: '병상(개)', angle: 90, position: 'insideRight', style: { fontSize: 11, fill: '#10b981' } }}
                      />
                      <Tooltip
                        contentStyle={{ fontSize: 12 }}
                        formatter={(value, name) => [
                          typeof value === 'number' ? value.toLocaleString() : value,
                          name === 'totalHospitals' ? '누적 병원' : '누적 병상',
                        ]}
                      />
                      <Legend
                        formatter={(value) => value === 'totalHospitals' ? '누적 병원' : '누적 병상'}
                        wrapperStyle={{ fontSize: 12 }}
                      />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="totalHospitals"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="totalBeds"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* 월별 신규 막대 차트 */}
                <div>
                  <p className="mb-2 text-xs font-medium text-gray-500">월별 신규 현황</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <ComposedChart data={chartData} margin={{ top: 4, right: 24, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: '#6b7280' }}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        yAxisId="left"
                        orientation="left"
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: '#6366f1' }}
                        label={{ value: '병원(개)', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#6366f1' } }}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 11, fill: '#f59e0b' }}
                        label={{ value: '병상(개)', angle: 90, position: 'insideRight', style: { fontSize: 11, fill: '#f59e0b' } }}
                      />
                      <Tooltip
                        contentStyle={{ fontSize: 12 }}
                        formatter={(value, name) => [
                          typeof value === 'number' ? value.toLocaleString() : value,
                          name === 'newHospitals' ? '신규 병원' : '신규 병상',
                        ]}
                      />
                      <Legend
                        formatter={(value) => value === 'newHospitals' ? '신규 병원' : '신규 병상'}
                        wrapperStyle={{ fontSize: 12 }}
                      />
                      <Bar
                        yAxisId="left"
                        dataKey="newHospitals"
                        fill="#6366f1"
                        opacity={0.8}
                        radius={[3, 3, 0, 0]}
                      />
                      <Bar
                        yAxisId="right"
                        dataKey="newBeds"
                        fill="#f59e0b"
                        opacity={0.8}
                        radius={[3, 3, 0, 0]}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* 테이블 */}
                <div className="overflow-x-auto">
                  <table className="w-full divide-y divide-gray-100 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">월</th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">신규 병원</th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">신규 병상</th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">누적 병원</th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">누적 병상</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {tableData.map((row) => {
                        const hasNew = row.newHospitals > 0 || row.newBeds > 0
                        return (
                          <tr
                            key={row.month}
                            className={hasNew ? 'bg-blue-50 font-medium' : 'text-gray-400'}
                          >
                            <td className="px-4 py-2.5 tabular-nums">{row.label}</td>
                            <td className={`px-4 py-2.5 text-right tabular-nums ${hasNew ? 'text-blue-700' : ''}`}>
                              {row.newHospitals > 0 ? `+${row.newHospitals}` : '-'}
                            </td>
                            <td className={`px-4 py-2.5 text-right tabular-nums ${hasNew ? 'text-emerald-700' : ''}`}>
                              {row.newBeds > 0 ? `+${row.newBeds.toLocaleString()}` : '-'}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{row.totalHospitals}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{row.totalBeds.toLocaleString()}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
