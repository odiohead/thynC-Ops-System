'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState } from 'react'

interface Props {
  initialSearch: string
}

export default function ProjectFilters({ initialSearch }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [search, setSearch] = useState(initialSearch)

  function apply(newSearch: string) {
    const params = new URLSearchParams()
    if (newSearch) params.set('search', newSearch)
    params.set('page', '1')
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); apply(search) }}
      className="flex gap-2"
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
  )
}
