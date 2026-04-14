'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface StatusCode {
  id: number
  name: string
  color: string | null
}

interface Maintenance {
  id: number
  maintenanceCode: string | null
  hospital: { hospitalCode: string; hospitalName: string; hiraHospitalName: string; address: string | null }
  type: StatusCode | null
  status: StatusCode | null
  priority: string
  title: string
  isRemote: boolean
  reportedAt: string | null
  visitDate: string | null
  resolvedAt: string | null
  assignees: { user: { id: string; name: string } }[]
}

function formatDate(val: string | null): string {
  if (!val) return '-'
  return val.slice(0, 10)
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

export default function MaintenancesPage() {
  const router = useRouter()
  const [maintenances, setMaintenances] = useState<Maintenance[]>([])
  const [loading, setLoading] = useState(true)
  const [types, setTypes] = useState<StatusCode[]>([])
  const [statuses, setStatuses] = useState<StatusCode[]>([])

  const [filterSearch, setFilterSearch] = useState('')
  const [filterTypeId, setFilterTypeId] = useState('')
  const [filterStatusId, setFilterStatusId] = useState('')
  const [filterPriority, setFilterPriority] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/settings/maintenance-type').then((r) => r.json()),
      fetch('/api/settings/maintenance-status').then((r) => r.json()),
    ]).then(([tData, sData]) => {
      setTypes(tData.statusCodes ?? [])
      setStatuses(sData.statusCodes ?? [])
    })
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterSearch) params.set('search', filterSearch)
    if (filterTypeId) params.set('typeId', filterTypeId)
    if (filterStatusId) params.set('statusId', filterStatusId)
    if (filterPriority) params.set('priority', filterPriority)
    const res = await fetch(`/api/maintenances?${params}`)
    if (res.ok) {
      const data = await res.json()
      setMaintenances(data.maintenances)
    }
    setLoading(false)
  }, [filterSearch, filterTypeId, filterStatusId, filterPriority])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">유지보수</h1>
          <button
            type="button"
            onClick={() => router.push('/maintenances/new')}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            + 유지보수 등록
          </button>
        </div>

        {/* 필터 */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="병원명 검색..."
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <select
            value={filterTypeId}
            onChange={(e) => setFilterTypeId(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">장애유형 전체</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
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

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['접수일', '병원명', '제목', '장애유형', '우선순위', '상태', '원격', '담당자', '방문일', '완료일'].map((col) => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-sm text-gray-400">불러오는 중...</td>
                  </tr>
                ) : maintenances.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-sm text-gray-400">등록된 유지보수가 없습니다.</td>
                  </tr>
                ) : (
                  maintenances.map((m) => (
                    <tr key={m.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/maintenances/${m.id}`)}>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{formatDate(m.reportedAt)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-sm font-medium text-blue-600">
                          {m.hospital.hospitalName || m.hospital.hiraHospitalName}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 max-w-xs truncate">{m.title}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusBadge status={m.type} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <PriorityBadge priority={m.priority} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusBadge status={m.status} />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                        {m.isRemote ? (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">원격</span>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                        {m.assignees?.length > 0 ? m.assignees.map((a) => a.user.name).join(', ') : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{formatDate(m.visitDate)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{formatDate(m.resolvedAt)}</td>
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
