'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'

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
  const [statusOpen, setStatusOpen] = useState(false)
  const [typeOpen, setTypeOpen] = useState(false)
  const statusRef = useRef<HTMLDivElement>(null)
  const typeRef = useRef<HTMLDivElement>(null)

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) {
        setStatusOpen(false)
      }
      if (typeRef.current && !typeRef.current.contains(e.target as Node)) {
        setTypeOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {/* 검색 */}
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

      {/* 시도 필터 */}
      <select
        value={sido}
        onChange={(e) => {
          setSido(e.target.value)
          apply(search, e.target.value, statuses, types)
        }}
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-40"
      >
        <option value="">전체 시도</option>
        {sidoOptions.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      {/* 병원종 멀티선택 드롭다운 */}
      <div className="relative" ref={typeRef}>
        <button
          type="button"
          onClick={() => setTypeOpen((o) => !o)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors sm:w-36 ${
            types.length > 0
              ? 'border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-500'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          <span className="flex-1 text-left">
            {types.length > 0 ? `병원종 (${types.length})` : '병원종'}
          </span>
          <svg
            className={`h-4 w-4 transition-transform ${typeOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {typeOpen && (
          <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            {typeOptions.map((opt) => {
              const checked = types.includes(opt)
              return (
                <label
                  key={opt}
                  className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleType(opt)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">{opt}</span>
                </label>
              )
            })}
            {types.length > 0 && (
              <>
                <div className="my-1 border-t border-gray-100" />
                <button
                  type="button"
                  onClick={() => {
                    setTypes([])
                    apply(search, sido, statuses, [])
                    setTypeOpen(false)
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-red-500 hover:bg-gray-50"
                >
                  선택 초기화
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 상태 멀티선택 드롭다운 */}
      <div className="relative" ref={statusRef}>
        <button
          type="button"
          onClick={() => setStatusOpen((o) => !o)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors sm:w-36 ${
            statuses.length > 0
              ? 'border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-500'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          <span className="flex-1 text-left">
            {statuses.length > 0 ? `상태 (${statuses.length})` : '상태'}
          </span>
          <svg
            className={`h-4 w-4 transition-transform ${statusOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {statusOpen && (
          <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            {statusOptions.map((opt) => {
              const checked = statuses.includes(opt.name)
              return (
                <label
                  key={opt.name}
                  className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleStatus(opt.name)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  {opt.color && (
                    <span
                      className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: opt.color }}
                    />
                  )}
                  <span className="text-sm text-gray-700">{opt.name}</span>
                </label>
              )
            })}
            {statuses.length > 0 && (
              <>
                <div className="my-1 border-t border-gray-100" />
                <button
                  type="button"
                  onClick={() => {
                    setStatuses([])
                    apply(search, sido, [], types)
                    setStatusOpen(false)
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-red-500 hover:bg-gray-50"
                >
                  선택 초기화
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
