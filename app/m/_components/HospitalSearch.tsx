'use client'

import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { MInput } from './ui'

export interface HospitalPick { hospitalCode: string; hospitalName: string }

/** 병원 검색 선택 — 2글자 이상 입력 시 /api/hospitals?search= (전체 병원, 20건). 선택 후엔 칩 + 변경 */
export default function HospitalSearch({ value, onChange, placeholder = '병원명 2글자 이상 입력' }: {
  value: HospitalPick | null
  onChange: (h: HospitalPick | null) => void
  placeholder?: string
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<(HospitalPick & { address?: string | null })[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const needle = q.trim()
    if (value || needle.length < 2) { setResults([]); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(() => {
      fetch(`/api/hospitals?search=${encodeURIComponent(needle)}&limit=20`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { hospitals: [] }))
        .then((d) => setResults(d.hospitals ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 250)
    return () => clearTimeout(t)
  }, [q, value])

  if (value) {
    return (
      <div className="flex min-h-12 items-center justify-between gap-2 rounded-xl border border-primary/40 bg-primary-subtle px-3.5 py-2">
        <span className="min-w-0 truncate text-base font-medium">{value.hospitalName}</span>
        <button type="button" onClick={() => onChange(null)} className="flex shrink-0 items-center gap-0.5 text-sm text-primary">
          <X size={14} /> 변경
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="relative">
        <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <MInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="pl-10" enterKeyHint="search" />
      </div>
      {q.trim().length >= 2 && (
        <ul className="max-h-64 overflow-y-auto rounded-xl border border-border bg-card">
          {searching && results.length === 0 ? (
            <li className="px-3.5 py-3 text-sm text-muted-foreground">검색 중…</li>
          ) : results.length === 0 ? (
            <li className="px-3.5 py-3 text-sm text-muted-foreground">검색 결과가 없습니다</li>
          ) : (
            results.map((h) => (
              <li key={h.hospitalCode}>
                <button
                  type="button"
                  onClick={() => { onChange({ hospitalCode: h.hospitalCode, hospitalName: h.hospitalName }); setQ('') }}
                  className="block w-full border-b border-border px-3.5 py-3 text-left last:border-0 active:bg-accent"
                >
                  <span className="block text-sm font-medium">{h.hospitalName}</span>
                  {h.address && <span className="block truncate text-xs text-muted-foreground">{h.address}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
