'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState } from 'react'

interface Props {
  sidoOptions: string[]
  initialSearch: string
  initialSido: string
}

export default function HospitalFilters({ sidoOptions, initialSearch, initialSido }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [search, setSearch] = useState(initialSearch)
  const [sido, setSido] = useState(initialSido)

  function apply(newSearch: string, newSido: string) {
    const params = new URLSearchParams()
    if (newSearch) params.set('search', newSearch)
    if (newSido) params.set('sido', newSido)
    params.set('page', '1')
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          apply(search, sido)
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
          apply(search, e.target.value)
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
    </div>
  )
}
