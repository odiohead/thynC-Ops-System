'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'

interface BuildStatus { id: number; label: string }
interface Contractor { id: number; name: string }
interface UserOption { id: string; name: string }

interface Props {
  initialSearch: string
  initialBuildStatusId: string
  initialContractorId: string
  initialBuilderId: string
  initialOrderBy: string
  initialOrder: string
}

export default function ProjectFilters({
  initialSearch,
  initialBuildStatusId,
  initialContractorId,
  initialBuilderId,
  initialOrderBy,
  initialOrder,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()

  const [search, setSearch] = useState(initialSearch)
  const [buildStatusId, setBuildStatusId] = useState(initialBuildStatusId)
  const [contractorId, setContractorId] = useState(initialContractorId)
  const [builderId, setBuilderId] = useState(initialBuilderId)
  const [orderBy, setOrderBy] = useState(initialOrderBy)
  const [order, setOrder] = useState(initialOrder)

  const [buildStatuses, setBuildStatuses] = useState<BuildStatus[]>([])
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [users, setUsers] = useState<UserOption[]>([])

  useEffect(() => {
    Promise.all([
      fetch('/api/settings/build-status').then((r) => r.json()),
      fetch('/api/constructors').then((r) => r.json()),
      fetch('/api/users').then((r) => r.json()),
    ]).then(([bsData, conData, userData]) => {
      setBuildStatuses(bsData.buildStatuses ?? [])
      setContractors(conData.constructors ?? [])
      setUsers(Array.isArray(userData) ? userData : [])
    })
  }, [])

  function buildParams(overrides: Record<string, string> = {}) {
    const params = new URLSearchParams()
    const values: Record<string, string> = {
      search, buildStatusId, contractorId, builderId, orderBy, order,
      ...overrides,
    }
    if (values.search) params.set('search', values.search)
    if (values.buildStatusId) params.set('buildStatusId', values.buildStatusId)
    if (values.contractorId) params.set('contractorId', values.contractorId)
    if (values.builderId) params.set('builderId', values.builderId)
    if (values.orderBy) params.set('orderBy', values.orderBy)
    if (values.order) params.set('order', values.order)
    params.set('page', '1')
    return params.toString()
  }

  function applySearch() {
    router.push(`${pathname}?${buildParams()}`)
  }

  function handleSelect(key: string, value: string) {
    const setters: Record<string, (v: string) => void> = {
      buildStatusId: setBuildStatusId,
      contractorId: setContractorId,
      builderId: setBuilderId,
      orderBy: setOrderBy,
      order: setOrder,
    }
    setters[key]?.(value)
    router.push(`${pathname}?${buildParams({ [key]: value })}`)
  }

  const selectClass = 'rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white'

  return (
    <div className="space-y-2">
      {/* 1행: 검색 */}
      <form onSubmit={(e) => { e.preventDefault(); applySearch() }} className="flex gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="병원명 또는 프로젝트명 검색..."
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="submit"
          className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
        >
          검색
        </button>
      </form>

      {/* 2행: 필터 + 정렬 */}
      <div className="flex flex-wrap gap-2">
        <select value={buildStatusId} onChange={(e) => handleSelect('buildStatusId', e.target.value)} className={selectClass}>
          <option value="">진행상태 전체</option>
          {buildStatuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>

        <select value={contractorId} onChange={(e) => handleSelect('contractorId', e.target.value)} className={selectClass}>
          <option value="">구축업체 전체</option>
          {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <select value={builderId} onChange={(e) => handleSelect('builderId', e.target.value)} className={selectClass}>
          <option value="">담당자 전체</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>

        <div className="ml-auto flex gap-2">
          <select value={orderBy} onChange={(e) => handleSelect('orderBy', e.target.value)} className={selectClass}>
            <option value="contractDate">계약일 기준</option>
            <option value="startDate">구축 시작일 기준</option>
          </select>
          <select value={order} onChange={(e) => handleSelect('order', e.target.value)} className={selectClass}>
            <option value="desc">최신순</option>
            <option value="asc">오래된순</option>
          </select>
        </div>
      </div>
    </div>
  )
}
