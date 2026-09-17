'use client'

import { useEffect, useState } from 'react'

/**
 * 상태 기반 페이저 (2026-09-16, AS접수 목록 요청) — 첫/마지막 페이지 · ±5페이지 · 한 페이지 이동 · 번호 직접 입력.
 * 페이지 상태를 부모가 소유(setPage)하는 목록에서 사용. Link 기반 서버 목록은 hospitals/_components/Pagination 유지.
 */
interface Props {
  page: number
  totalPages: number
  onChange: (page: number) => void
  /** 총 건수 (있으면 '전체 n건' 표시) */
  total?: number
  /** ±점프 단위 (기본 5) */
  jump?: number
  className?: string
}

export default function Pager({ page, totalPages, onChange, total, jump = 5, className = '' }: Props) {
  const [input, setInput] = useState(String(page))
  useEffect(() => { setInput(String(page)) }, [page])
  if (totalPages <= 1) return null

  const go = (p: number) => {
    const next = Math.min(totalPages, Math.max(1, p))
    if (next !== page) onChange(next)
    else setInput(String(page))
  }
  const submitInput = () => {
    const n = parseInt(input, 10)
    if (Number.isFinite(n)) go(n)
    else setInput(String(page))
  }

  const btn = 'inline-flex h-8 min-w-[2rem] items-center justify-center rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40'
  const atFirst = page <= 1
  const atLast = page >= totalPages

  return (
    <div className={`flex flex-wrap items-center justify-center gap-1 text-sm ${className}`}>
      <button type="button" className={btn} disabled={atFirst} onClick={() => go(1)} title="첫 페이지" aria-label="첫 페이지">«</button>
      <button type="button" className={btn} disabled={atFirst} onClick={() => go(page - jump)} title={`${jump}페이지 앞으로`} aria-label={`${jump}페이지 앞으로`}>‹{jump}</button>
      <button type="button" className={btn} disabled={atFirst} onClick={() => go(page - 1)} title="이전 페이지" aria-label="이전 페이지">‹</button>
      <span className="mx-1 inline-flex items-center gap-1 text-gray-600">
        <input
          type="number"
          min={1}
          max={totalPages}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitInput() } }}
          onBlur={submitInput}
          className="h-8 w-16 rounded-md border border-gray-300 px-2 text-center text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          aria-label="페이지 번호 입력"
        />
        <span className="text-gray-500">/ {totalPages.toLocaleString()}</span>
      </span>
      <button type="button" className={btn} disabled={atLast} onClick={() => go(page + 1)} title="다음 페이지" aria-label="다음 페이지">›</button>
      <button type="button" className={btn} disabled={atLast} onClick={() => go(page + jump)} title={`${jump}페이지 뒤로`} aria-label={`${jump}페이지 뒤로`}>{jump}›</button>
      <button type="button" className={btn} disabled={atLast} onClick={() => go(totalPages)} title="마지막 페이지" aria-label="마지막 페이지">»</button>
      {total !== undefined && <span className="ml-2 text-xs text-gray-400">전체 {total.toLocaleString()}건</span>}
    </div>
  )
}
