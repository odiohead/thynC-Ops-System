'use client'

import { useState, useEffect, useCallback } from 'react'

export interface SelectedHospital {
  hospitalCode: string
  hospitalName: string
}

interface Props {
  isOpen: boolean
  onClose: () => void
  onSelect: (h: SelectedHospital) => void
}

interface Hospital {
  hospitalCode: string
  hospitalName: string
  hiraHospitalName: string
  sidoName: string | null
  status: string
}

export default function HospitalSelectModal({ isOpen, onClose, onSelect }: Props) {
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ hospitals: Hospital[]; total: number; totalPages: number } | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page) })
    if (appliedSearch) params.set('search', appliedSearch)
    try {
      const res = await fetch(`/api/hospitals?${params}`)
      setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [page, appliedSearch])

  useEffect(() => {
    if (isOpen) fetchData()
  }, [fetchData, isOpen])

  useEffect(() => {
    if (isOpen) {
      setSearchInput('')
      setAppliedSearch('')
      setPage(1)
      setData(null)
    }
  }, [isOpen])

  function handleSearch() {
    setPage(1)
    setAppliedSearch(searchInput)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[75vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">

        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">병원 선택</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {/* 검색 */}
        <div className="flex gap-3 border-b border-gray-200 p-4">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSearch() } }}
            placeholder="병원명 검색..."
            autoFocus
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={handleSearch}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
          >
            검색
          </button>
        </div>

        {/* 결과 */}
        <div className="flex-1 overflow-auto">
          {data && (
            <div className="border-b border-gray-100 px-4 py-2">
              <span className="text-xs text-gray-500">
                총 <span className="font-medium text-gray-700">{data.total.toLocaleString()}</span>개
              </span>
            </div>
          )}
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="sticky top-0 bg-gray-50">
              <tr>
                {['병원명', '지역', '상태', ''].map((col, i) => (
                  <th key={i} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr><td colSpan={4} className="py-16 text-center text-sm text-gray-400">불러오는 중...</td></tr>
              ) : !data || data.hospitals.length === 0 ? (
                <tr><td colSpan={4} className="py-16 text-center text-sm text-gray-400">검색 결과가 없습니다.</td></tr>
              ) : (
                data.hospitals.map((h) => (
                  <tr key={h.hospitalCode} className="cursor-pointer transition-colors hover:bg-blue-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{h.hospitalName}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">{h.sidoName ?? '-'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">{h.status}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => { onSelect({ hospitalCode: h.hospitalCode, hospitalName: h.hospitalName }); onClose() }}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                      >
                        선택
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 */}
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 border-t border-gray-200 px-4 py-3">
            {page > 1 && (
              <button type="button" onClick={() => setPage((p) => p - 1)} className="rounded px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100">← 이전</button>
            )}
            <span className="text-sm text-gray-500">{page} / {data.totalPages}</span>
            {page < data.totalPages && (
              <button type="button" onClick={() => setPage((p) => p + 1)} className="rounded px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100">다음 →</button>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
