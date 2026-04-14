'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'

interface Task {
  id: number
  taskCode: string
  taskType: string
  refCode: string
  refId: number | null
  hospitalCode: string | null
  title: string | null
  isCompleted: boolean
  completedAt: string | null
  createdAt: string
  hospital: { hospitalCode: string; hospitalName: string; hiraHospitalName: string } | null
}

const TASK_TYPES = ['PROJECT', 'SITE_VISIT', 'INSTALL_PLAN', 'MAINTENANCE'] as const

const taskTypeLabels: Record<string, string> = {
  PROJECT: '프로젝트',
  SITE_VISIT: '답사',
  INSTALL_PLAN: '설치계획(가안)',
  MAINTENANCE: '유지보수',
}

const taskTypeColors: Record<string, string> = {
  PROJECT: 'bg-indigo-100 text-indigo-700 border-indigo-300',
  SITE_VISIT: 'bg-teal-100 text-teal-700 border-teal-300',
  INSTALL_PLAN: 'bg-orange-100 text-orange-700 border-orange-300',
  MAINTENANCE: 'bg-rose-100 text-rose-700 border-rose-300',
}

function getDetailUrl(task: Task): string | null {
  switch (task.taskType) {
    case 'PROJECT':
      return `/projects/${task.refCode}`
    case 'SITE_VISIT':
      return task.refId ? `/site-visits/${task.refId}` : null
    case 'INSTALL_PLAN':
      return task.refId ? `/install-plans/${task.refId}` : null
    case 'MAINTENANCE':
      return task.refId ? `/maintenances/${task.refId}` : null
    default:
      return null
  }
}

function formatDate(val: string | null): string {
  if (!val) return '-'
  return val.slice(0, 10)
}

export default function TasksPage() {
  const router = useRouter()
  const [allTasks, setAllTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState('')
  const [filterSearch, setFilterSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'incomplete' | 'completed'>('incomplete')
  const [togglingId, setTogglingId] = useState<number | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterType) params.set('taskType', filterType)
    if (filterSearch) params.set('search', filterSearch)
    const res = await fetch(`/api/tasks?${params}`)
    if (res.ok) {
      const data = await res.json()
      setAllTasks(data.tasks)
    }
    setLoading(false)
  }, [filterType, filterSearch])

  useEffect(() => { fetchData() }, [fetchData])

  // 탭 기준으로 필터
  const tasks = useMemo(() => {
    const isCompleted = activeTab === 'completed'
    return allTasks.filter((t) => t.isCompleted === isCompleted)
  }, [allTasks, activeTab])

  async function handleToggle(task: Task, e: React.MouseEvent) {
    e.stopPropagation()
    setTogglingId(task.id)
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isCompleted: !task.isCompleted }),
    })
    if (res.ok) {
      setAllTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? { ...t, isCompleted: !t.isCompleted, completedAt: !t.isCompleted ? new Date().toISOString() : null }
            : t
        )
      )
    }
    setTogglingId(null)
  }

  // 카드 집계 — allTasks 기준
  const typeStats = useMemo(() => {
    const stats: Record<string, { total: number; completed: number; incomplete: number }> = {}
    for (const type of TASK_TYPES) {
      stats[type] = { total: 0, completed: 0, incomplete: 0 }
    }
    for (const t of allTasks) {
      const s = stats[t.taskType]
      if (!s) continue
      s.total++
      if (t.isCompleted) s.completed++
      else s.incomplete++
    }
    return stats
  }, [allTasks])

  const completedCount = allTasks.filter((t) => t.isCompleted).length
  const incompleteCount = allTasks.length - completedCount

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">업무(Task) 현황</h1>
          <p className="mt-1 text-sm text-gray-500">프로젝트·답사·설치계획·유지보수 전체 업무를 통합 조회합니다.</p>
        </div>

        {/* 요약 카드 */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TASK_TYPES.map((type) => {
            const cls = taskTypeColors[type] ?? ''
            const isActive = filterType === type
            const s = typeStats[type]
            return (
              <button
                key={type}
                type="button"
                onClick={() => setFilterType(isActive ? '' : type)}
                className={`rounded-lg border px-4 py-3 text-left transition-all ${
                  isActive
                    ? `${cls} ring-2 ring-offset-1 ring-current`
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <p className="text-xs font-medium text-gray-500">{taskTypeLabels[type]}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{s.total}</p>
                <div className="mt-1.5 flex items-center gap-3">
                  <span className="flex items-center gap-1 text-xs text-gray-500">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                    완료 <span className="font-semibold tabular-nums">{s.completed}</span>
                  </span>
                  <span className="flex items-center gap-1 text-xs text-gray-500">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
                    미완료 <span className="font-semibold tabular-nums">{s.incomplete}</span>
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        {/* 필터 */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="업무코드·병원명·제목 검색..."
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-72"
          />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">업무유형 전체</option>
            <option value="PROJECT">프로젝트</option>
            <option value="SITE_VISIT">답사</option>
            <option value="INSTALL_PLAN">설치계획(가안)</option>
            <option value="MAINTENANCE">유지보수</option>
          </select>
          {(filterType || filterSearch) && (
            <button
              type="button"
              onClick={() => { setFilterType(''); setFilterSearch('') }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
            >
              필터 초기화
            </button>
          )}
        </div>

        {/* 탭 */}
        <div className="mb-0 flex border-b border-gray-200">
          <button
            type="button"
            onClick={() => setActiveTab('incomplete')}
            className={`relative px-5 py-3 text-sm font-medium transition-colors ${
              activeTab === 'incomplete'
                ? 'text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
              미완료
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                activeTab === 'incomplete' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
              }`}>
                {incompleteCount}
              </span>
            </span>
            {activeTab === 'incomplete' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('completed')}
            className={`relative px-5 py-3 text-sm font-medium transition-colors ${
              activeTab === 'completed'
                ? 'text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              완료
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                activeTab === 'completed' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
              }`}>
                {completedCount}
              </span>
            </span>
            {activeTab === 'completed' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />
            )}
          </button>
        </div>

        {/* 테이블 */}
        <div className="overflow-hidden rounded-b-lg border border-t-0 border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="w-10 px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">완료</th>
                  {['업무코드', '업무유형', '참조코드', '병원명', '제목', '등록일'].map((col) => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-sm text-gray-400">불러오는 중...</td>
                  </tr>
                ) : tasks.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-sm text-gray-400">
                      {activeTab === 'incomplete' ? '미완료 업무가 없습니다.' : '완료된 업무가 없습니다.'}
                    </td>
                  </tr>
                ) : (
                  tasks.map((t) => {
                    const typeCls = taskTypeColors[t.taskType] ?? 'bg-gray-100 text-gray-600 border-gray-300'
                    return (
                      <tr
                        key={t.id}
                        className={`hover:bg-gray-50 ${getDetailUrl(t) ? 'cursor-pointer' : ''} ${t.isCompleted ? 'bg-gray-50/50' : ''}`}
                        onClick={() => { const url = getDetailUrl(t); if (url) router.push(url) }}
                      >
                        <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={(e) => handleToggle(t, e)}
                            disabled={togglingId === t.id}
                            className={`inline-flex h-5 w-5 items-center justify-center rounded border transition-colors ${
                              t.isCompleted
                                ? 'border-green-500 bg-green-500 text-white'
                                : 'border-gray-300 bg-white hover:border-gray-400'
                            } disabled:opacity-50`}
                            title={t.isCompleted ? '미완료로 변경' : '완료로 변경'}
                          >
                            {t.isCompleted && (
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </button>
                        </td>
                        <td className={`px-4 py-3 text-xs font-mono whitespace-nowrap ${t.isCompleted ? 'text-gray-400' : 'text-gray-500'}`}>{t.taskCode}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${typeCls}`}>
                            {taskTypeLabels[t.taskType] ?? t.taskType}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-xs font-mono whitespace-nowrap ${t.isCompleted ? 'text-gray-300' : 'text-gray-400'}`}>{t.refCode}</td>
                        <td className={`px-4 py-3 text-sm whitespace-nowrap ${t.isCompleted ? 'text-gray-400' : 'text-gray-700'}`}>
                          {t.hospital
                            ? (t.hospital.hospitalName || t.hospital.hiraHospitalName)
                            : <span className="text-gray-400">-</span>}
                        </td>
                        <td className={`px-4 py-3 text-sm max-w-xs truncate ${t.isCompleted ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{t.title || '-'}</td>
                        <td className={`px-4 py-3 text-sm whitespace-nowrap ${t.isCompleted ? 'text-gray-400' : 'text-gray-500'}`}>{formatDate(t.createdAt)}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-3 text-right text-xs text-gray-400">
          {tasks.length}건
        </p>

      </div>
    </div>
  )
}
