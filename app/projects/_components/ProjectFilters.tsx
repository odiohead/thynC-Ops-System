'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { ChevronDown, X } from 'lucide-react'

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

function MultiSelectDropdown({
  label,
  options,
  selectedIds,
  onChange,
}: {
  label: string
  options: { id: string; name: string }[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function toggle(id: string) {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((v) => v !== id)
      : [...selectedIds, id]
    onChange(next)
  }

  const selectedNames = options
    .filter((o) => selectedIds.includes(o.id))
    .map((o) => o.name)

  const displayText = selectedNames.length === 0
    ? `${label} 전체`
    : selectedNames.length <= 2
      ? selectedNames.join(', ')
      : `${selectedNames[0]} 외 ${selectedNames.length - 1}건`

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <span className={selectedIds.length > 0 ? 'text-blue-600 font-medium' : 'text-gray-700'}>
          {displayText}
        </span>
        {selectedIds.length > 0 ? (
          <X
            size={14}
            className="text-gray-400 hover:text-gray-600"
            onClick={(e) => { e.stopPropagation(); onChange([]) }}
          />
        ) : (
          <ChevronDown size={14} className="text-gray-400" />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-60 w-52 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-400">항목 없음</div>
          ) : (
            options.map((o) => (
              <label
                key={o.id}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(o.id)}
                  onChange={() => toggle(o.id)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="truncate">{o.name}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  )
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
  const [buildStatusIds, setBuildStatusIds] = useState<string[]>(initialBuildStatusId ? initialBuildStatusId.split(',') : [])
  const [contractorIds, setContractorIds] = useState<string[]>(initialContractorId ? initialContractorId.split(',') : [])
  const [builderIds, setBuilderIds] = useState<string[]>(initialBuilderId ? initialBuilderId.split(',') : [])
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
      search,
      buildStatusId: buildStatusIds.join(','),
      contractorId: contractorIds.join(','),
      builderId: builderIds.join(','),
      orderBy,
      order,
      ...overrides,
    }
    if (values.search) params.set('search', values.search)
    if (values.buildStatusId) params.set('buildStatusId', values.buildStatusId)
    if (values.contractorId) params.set('contractorId', values.contractorId)
    if (values.builderId) params.set('builderId', values.builderId)
    if (values.orderBy) params.set('orderBy', values.orderBy)
    if (values.order) params.set('order', values.order)
    return params.toString()
  }

  function applySearch() {
    router.push(`${pathname}?${buildParams()}`)
  }

  function handleMultiSelect(key: string, ids: string[]) {
    const setters: Record<string, (v: string[]) => void> = {
      buildStatusId: setBuildStatusIds,
      contractorId: setContractorIds,
      builderId: setBuilderIds,
    }
    setters[key]?.(ids)
    router.push(`${pathname}?${buildParams({ [key]: ids.join(',') })}`)
  }

  function handleSelect(key: string, value: string) {
    const setters: Record<string, (v: string) => void> = {
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
        <MultiSelectDropdown
          label="진행상태"
          options={buildStatuses.map((s) => ({ id: String(s.id), name: s.label }))}
          selectedIds={buildStatusIds}
          onChange={(ids) => handleMultiSelect('buildStatusId', ids)}
        />

        <MultiSelectDropdown
          label="구축업체"
          options={contractors.map((c) => ({ id: String(c.id), name: c.name }))}
          selectedIds={contractorIds}
          onChange={(ids) => handleMultiSelect('contractorId', ids)}
        />

        <MultiSelectDropdown
          label="담당자"
          options={users.map((u) => ({ id: u.id, name: u.name }))}
          selectedIds={builderIds}
          onChange={(ids) => handleMultiSelect('builderId', ids)}
        />

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
