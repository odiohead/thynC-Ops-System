'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import StatusBadge from '@/app/components/StatusBadge'

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

  const loadData = useCallback(async () => {
    const res = await fetch('/api/dashboard')
    if (res.ok) {
      setData(await res.json())
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

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

        </div>
      </div>
    </div>
  )
}
