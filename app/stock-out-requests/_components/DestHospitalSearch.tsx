'use client'

/** 출고요청 납품처 병원 검색 (PC) — 2글자 이상 입력 시 /api/hospitals?search= (전체 병원). 선택 후엔 칩 + 변경 */
import { useEffect, useState } from 'react'

export interface DestHospital { hospitalCode: string; hospitalName: string }

export default function DestHospitalSearch({ value, onChange, disabled }: {
  value: DestHospital | null
  onChange: (h: DestHospital | null) => void
  disabled?: boolean
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<(DestHospital & { address?: string | null })[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const needle = q.trim()
    if (value || needle.length < 2) { setResults([]); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(() => {
      fetch(`/api/hospitals?search=${encodeURIComponent(needle)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { hospitals: [] }))
        .then((d) => setResults(d.hospitals ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 250)
    return () => clearTimeout(t)
  }, [q, value])

  if (value) {
    return (
      <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-sm">
        <span className="min-w-0 truncate font-medium text-gray-900">{value.hospitalName}</span>
        {!disabled && <button type="button" onClick={() => onChange(null)} className="shrink-0 text-xs text-blue-600 hover:underline">변경</button>}
      </div>
    )
  }

  return (
    <div className="relative mt-1">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        disabled={disabled}
        placeholder="병원명 2글자 이상 입력"
        className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
      />
      {q.trim().length >= 2 && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {searching && results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-400">검색 중…</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-400">검색 결과가 없습니다</li>
          ) : (
            results.map((h) => (
              <li key={h.hospitalCode}>
                <button
                  type="button"
                  onClick={() => { onChange({ hospitalCode: h.hospitalCode, hospitalName: h.hospitalName }); setQ('') }}
                  className="block w-full border-b border-gray-100 px-3 py-2 text-left last:border-0 hover:bg-gray-50"
                >
                  <span className="block text-sm text-gray-900">{h.hospitalName}</span>
                  {h.address && <span className="block truncate text-xs text-gray-400">{h.address}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
