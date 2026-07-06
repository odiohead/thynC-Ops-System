'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface StatusCode {
  id: number
  name: string
  color: string | null
}

interface HospitalRef {
  hospital: { hospitalCode: string; hospitalName: string; hiraHospitalName: string }
}

interface EtcTask {
  id: number
  etcTaskCode: string | null
  status: StatusCode | null
  priority: string
  title: string
  reportedAt: string | null
  resolvedAt: string | null
  assignees: { user: { id: string; name: string } }[]
  hospitals: HospitalRef[]
  visits: { startDate: string; endDate: string }[]
}

function formatDate(val: string | null): string {
  if (!val) return '-'
  return val.slice(0, 10)
}

function formatVisits(visits: { startDate: string; endDate: string }[]): string {
  if (!visits || visits.length === 0) return '-'
  const labels = visits.map((v) => {
    const s = v.startDate.slice(0, 10)
    const e = v.endDate.slice(0, 10)
    return s === e ? s : `${s}~${e.slice(5)}`
  })
  if (labels.length <= 2) return labels.join(', ')
  return `${labels.slice(0, 2).join(', ')} 외 ${labels.length - 2}건`
}

function formatHospitals(hospitals: HospitalRef[]): string {
  if (!hospitals || hospitals.length === 0) return '-'
  const names = hospitals.map((h) => h.hospital.hospitalName || h.hospital.hiraHospitalName)
  if (names.length <= 2) return names.join(', ')
  return `${names.slice(0, 2).join(', ')} 외 ${names.length - 2}곳`
}

function StatusBadge({ status }: { status: { name: string; color: string | null } | null }) {
  if (!status) return <span className="text-gray-400">-</span>
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: status.color ? `${status.color}22` : '#F3F4F6',
        color: status.color ?? '#6B7280',
        border: `1px solid ${status.color ?? '#E5E7EB'}`,
      }}
    >
      {status.name}
    </span>
  )
}

const priorityColors: Record<string, string> = {
  '긴급': 'bg-red-100 text-red-700 border-red-300',
  '높음': 'bg-amber-100 text-amber-700 border-amber-300',
  '보통': 'bg-blue-100 text-blue-700 border-blue-300',
  '낮음': 'bg-gray-100 text-gray-600 border-gray-300',
}

function PriorityBadge({ priority }: { priority: string }) {
  const cls = priorityColors[priority] ?? 'bg-gray-100 text-gray-600 border-gray-300'
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {priority}
    </span>
  )
}

export default function EtcTasksPage() {
  const router = useRouter()
  const [etcTasks, setEtcTasks] = useState<EtcTask[]>([])
  const [loading, setLoading] = useState(true)
  const [statuses, setStatuses] = useState<StatusCode[]>([])

  const [filterSearch, setFilterSearch] = useState('')
  const [filterStatusId, setFilterStatusId] = useState('')
  const [filterPriority, setFilterPriority] = useState('')

  useEffect(() => {
    fetch('/api/settings/etc-task-status')
      .then((r) => r.json())
      .then((sData) => setStatuses(sData.statusCodes ?? []))
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterSearch) params.set('search', filterSearch)
    if (filterStatusId) params.set('statusId', filterStatusId)
    if (filterPriority) params.set('priority', filterPriority)
    const res = await fetch(`/api/etc-tasks?${params}`)
    if (res.ok) {
      const data = await res.json()
      setEtcTasks(data.etcTasks)
    }
    setLoading(false)
  }, [filterSearch, filterStatusId, filterPriority])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">기타업무</h1>
          <button
            type="button"
            onClick={() => router.push('/etc-tasks/new')}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            + 기타업무 등록
          </button>
        </div>

        {/* 필터 */}
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <input
            type="text"
            placeholder="제목 검색..."
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-auto"
          />
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
          <select
            value={filterStatusId}
            onChange={(e) => setFilterStatusId(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">상태 전체</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">우선순위 전체</option>
            {['긴급', '높음', '보통', '낮음'].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          </div>
        </div>

        {/* 모바일 카드 리스트 */}
        <div className="space-y-2.5 md:hidden">
          {loading ? (
            <div className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">불러오는 중...</div>
          ) : etcTasks.length === 0 ? (
            <div className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">등록된 기타업무가 없습니다.</div>
          ) : (
            etcTasks.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => router.push(`/etc-tasks/${t.id}`)}
                className="block w-full rounded-xl border border-border bg-card p-4 text-left shadow-xs transition active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-foreground">{t.title}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    <PriorityBadge priority={t.priority} />
                    <StatusBadge status={t.status} />
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>접수일 <span className="text-foreground">{formatDate(t.reportedAt)}</span></span>
                  <span>담당자 <span className="text-foreground">{t.assignees?.length > 0 ? t.assignees.map((a) => a.user.name).join(', ') : '-'}</span></span>
                  <span>병원 <span className="text-foreground">{formatHospitals(t.hospitals)}</span></span>
                  <span>기간 <span className="text-foreground">{formatVisits(t.visits)}</span></span>
                  <span>완료일 <span className="text-foreground">{formatDate(t.resolvedAt)}</span></span>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="hidden overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm md:block">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['접수일', '제목', '상태', '우선순위', '담당자', '관련 병원', '업무기간', '완료일'].map((col) => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-sm text-gray-400">불러오는 중...</td>
                  </tr>
                ) : etcTasks.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-sm text-gray-400">등록된 기타업무가 없습니다.</td>
                  </tr>
                ) : (
                  etcTasks.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/etc-tasks/${t.id}`)}>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{formatDate(t.reportedAt)}</td>
                      <td className="px-4 py-3 text-sm font-medium text-blue-600 max-w-xs truncate">{t.title}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <PriorityBadge priority={t.priority} />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                        {t.assignees?.length > 0 ? t.assignees.map((a) => a.user.name).join(', ') : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{formatHospitals(t.hospitals)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{formatVisits(t.visits)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{formatDate(t.resolvedAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
