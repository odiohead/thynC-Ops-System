'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState } from 'react'

interface Props {
  initialSearch: string
  initialIsCompleted: string
}

export default function ProjectFilters({ initialSearch, initialIsCompleted }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [search, setSearch] = useState(initialSearch)
  const [isCompleted, setIsCompleted] = useState(initialIsCompleted)

  function apply(newSearch: string, newCompleted: string) {
    const params = new URLSearchParams()
    if (newSearch) params.set('search', newSearch)
    if (newCompleted !== '') params.set('isCompleted', newCompleted)
    params.set('page', '1')
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <form
        onSubmit={(e) => { e.preventDefault(); apply(search, isCompleted) }}
        className="flex flex-1 gap-2"
      >
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

      <select
        value={isCompleted}
        onChange={(e) => { setIsCompleted(e.target.value); apply(search, e.target.value) }}
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none sm:w-36"
      >
        <option value="">전체</option>
        <option value="false">진행중</option>
        <option value="true">완료</option>
      </select>
    </div>
  )
}
