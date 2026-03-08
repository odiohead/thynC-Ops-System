'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState } from 'react'

interface TypeOption {
  typeCode: string
  typeName: string
}

interface Props {
  sidoOptions: string[]
  typeOptions: TypeOption[]
  initialSearch: string
  initialSido: string
  initialTypeCode: string
}

export default function HiraFilters({ sidoOptions, typeOptions, initialSearch, initialSido, initialTypeCode }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [search, setSearch] = useState(initialSearch)
  const [sido, setSido] = useState(initialSido)
  const [typeCode, setTypeCode] = useState(initialTypeCode)

  function apply(s: string, si: string, tc: string) {
    const params = new URLSearchParams()
    if (s) params.set('search', s)
    if (si) params.set('sido', si)
    if (tc) params.set('typeCode', tc)
    params.set('page', '1')
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <form
        onSubmit={(e) => { e.preventDefault(); apply(search, sido, typeCode) }}
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
        onChange={(e) => { setSido(e.target.value); apply(search, e.target.value, typeCode) }}
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-36"
      >
        <option value="">전체 시도</option>
        {sidoOptions.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      <select
        value={typeCode}
        onChange={(e) => { setTypeCode(e.target.value); apply(search, sido, e.target.value) }}
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-44"
      >
        <option value="">전체 종별</option>
        {typeOptions.map((t) => <option key={t.typeCode} value={t.typeCode}>{t.typeName}</option>)}
      </select>
    </div>
  )
}
