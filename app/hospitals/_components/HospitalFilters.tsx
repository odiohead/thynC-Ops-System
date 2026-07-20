'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState } from 'react'

interface StatusOption {
  name: string
  color: string | null
}

interface Props {
  sidoOptions: string[]
  statusOptions: StatusOption[]
  typeOptions: string[]
  initialSearch: string
  initialSido: string
  initialStatuses: string[]
  initialTypes: string[]
}

export default function HospitalFilters({
  sidoOptions,
  statusOptions,
  typeOptions,
  initialSearch,
  initialSido,
  initialStatuses,
  initialTypes,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [search, setSearch] = useState(initialSearch)
  const [sido, setSido] = useState(initialSido)
  const [statuses, setStatuses] = useState<string[]>(initialStatuses)
  const [types, setTypes] = useState<string[]>(initialTypes)

  function apply(newSearch: string, newSido: string, newStatuses: string[], newTypes: string[]) {
    const params = new URLSearchParams()
    if (newSearch) params.set('search', newSearch)
    if (newSido) params.set('sido', newSido)
    newStatuses.forEach((s) => params.append('status', s))
    newTypes.forEach((t) => params.append('type', t))
    params.set('page', '1')
    router.push(`${pathname}?${params.toString()}`)
  }

  function toggleStatus(name: string) {
    const next = statuses.includes(name)
      ? statuses.filter((s) => s !== name)
      : [...statuses, name]
    setStatuses(next)
    apply(search, sido, next, types)
  }

  function toggleType(name: string) {
    const next = types.includes(name)
      ? types.filter((t) => t !== name)
      : [...types, name]
    setTypes(next)
    apply(search, sido, statuses, next)
  }

  const checkboxCls = 'h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500'

  return (
    <div className="flex flex-col gap-3">
      {/* 검색 + 시도 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            apply(search, sido, statuses, types)
          }}
          className="flex flex-1 gap-2"
        >
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="병원명 검색..."
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
          >
            검색
          </button>
        </form>

        <select
          value={sido}
          onChange={(e) => {
            setSido(e.target.value)
            apply(search, e.target.value, statuses, types)
          }}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-40"
        >
          <option value="">전체 시도</option>
          {sidoOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* 병원종·상태 체크박스 — 표 상단 상시 노출 (2026-07-21, 구 멀티선택 드롭다운 대체) */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
        <span className="mr-2 w-11 shrink-0 text-xs font-medium text-gray-500">병원종</span>
        {typeOptions.map((opt) => {
          const checked = types.includes(opt)
          return (
            <label
              key={opt}
              className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors ${
                checked ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <input type="checkbox" checked={checked} onChange={() => toggleType(opt)} className={checkboxCls} />
              {opt}
            </label>
          )
        })}
        {types.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setTypes([])
              apply(search, sido, statuses, [])
            }}
            className="ml-1 rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50"
          >
            초기화
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
        <span className="mr-2 w-11 shrink-0 text-xs font-medium text-gray-500">상태</span>
        {statusOptions.map((opt) => {
          const checked = statuses.includes(opt.name)
          return (
            <label
              key={opt.name}
              className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors ${
                checked ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <input type="checkbox" checked={checked} onChange={() => toggleStatus(opt.name)} className={checkboxCls} />
              {opt.color && (
                <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: opt.color }} />
              )}
              {opt.name}
            </label>
          )
        })}
        {statuses.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setStatuses([])
              apply(search, sido, [], types)
            }}
            className="ml-1 rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50"
          >
            초기화
          </button>
        )}
      </div>
    </div>
  )
}
