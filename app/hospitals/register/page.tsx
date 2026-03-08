'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface HiraHospital {
  id: number
  hiraId: string
  name: string
  typeName: string
  sidoName: string
  sigunguName: string
  isRegistered: boolean
}

interface ApiResponse {
  hiraHospitals: HiraHospital[]
  total: number
  page: number
  totalPages: number
}

export default function RegisterPage() {
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [sido, setSido] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [sidoOptions, setSidoOptions] = useState<string[]>([])
  const [registering, setRegistering] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ page: String(page) })
    if (appliedSearch) params.set('search', appliedSearch)
    if (sido) params.set('sido', sido)
    try {
      const res = await fetch(`/api/hira-hospitals?${params}`)
      setData(await res.json())
    } catch {
      setError('데이터를 불러오는 데 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }, [page, appliedSearch, sido])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    fetch('/api/hira-hospitals?sidoOnly=true')
      .then((r) => r.json())
      .then((d) => setSidoOptions(d.sidoOptions ?? []))
  }, [])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setPage(1)
    setAppliedSearch(searchInput)
  }

  function handleSido(value: string) {
    setSido(value)
    setPage(1)
  }

  async function handleRegister(hiraId: string) {
    setRegistering(hiraId)
    setError(null)
    try {
      const res = await fetch('/api/hospitals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hiraId }),
      })
      if (res.ok) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                hiraHospitals: prev.hiraHospitals.map((h) =>
                  h.hiraId === hiraId ? { ...h, isRegistered: true } : h
                ),
              }
            : prev
        )
      } else {
        const json = await res.json()
        setError(json.error ?? '등록에 실패했습니다.')
      }
    } catch {
      setError('등록 중 오류가 발생했습니다.')
    } finally {
      setRegistering(null)
    }
  }

  const totalPages = data?.totalPages ?? 1

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6 flex items-center gap-4">
          <Link
            href="/hospitals"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100"
          >
            ← 목록으로
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">병원 등록</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              심평원 병원 목록에서 등록할 병원을 선택하세요.
            </p>
          </div>
        </div>

        {/* 에러 */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* 검색 & 필터 */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <form onSubmit={handleSearch} className="flex flex-1 gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
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
            onChange={(e) => handleSido(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-40"
          >
            <option value="">전체 시도</option>
            {sidoOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* 테이블 */}
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          {/* 결과 수 */}
          {data && (
            <div className="border-b border-gray-200 px-4 py-2.5">
              <span className="text-sm text-gray-500">
                총 <span className="font-medium text-gray-900">{data.total.toLocaleString()}</span>개
              </span>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['병원명', '종별', '시도', '시군구', ''].map((col, i) => (
                    <th
                      key={i}
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-16 text-center text-sm text-gray-400">
                      불러오는 중...
                    </td>
                  </tr>
                ) : !data || data.hiraHospitals.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-16 text-center text-sm text-gray-400">
                      검색 결과가 없습니다.
                    </td>
                  </tr>
                ) : (
                  data.hiraHospitals.map((h) => (
                    <tr
                      key={h.id}
                      className={h.isRegistered ? 'bg-gray-50' : 'hover:bg-blue-50 transition-colors'}
                    >
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {h.name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {h.typeName}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {h.sidoName}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {h.sigunguName}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {h.isRegistered ? (
                          <span className="inline-flex rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-500">
                            등록완료
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleRegister(h.hiraId)}
                            disabled={registering === h.hiraId}
                            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                          >
                            {registering === h.hiraId ? '등록 중...' : '등록'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-1">
            {page > 1 && (
              <button
                onClick={() => setPage(page - 1)}
                className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 transition-colors"
              >
                ← 이전
              </button>
            )}

            {(() => {
              const delta = 2
              const range: number[] = []
              for (let i = Math.max(1, page - delta); i <= Math.min(totalPages, page + delta); i++) {
                range.push(i)
              }
              return (
                <>
                  {range[0] > 1 && (
                    <>
                      <button onClick={() => setPage(1)} className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">1</button>
                      {range[0] > 2 && <span className="px-1 text-gray-400">…</span>}
                    </>
                  )}
                  {range.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                        p === page ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                  {range[range.length - 1] < totalPages && (
                    <>
                      {range[range.length - 1] < totalPages - 1 && <span className="px-1 text-gray-400">…</span>}
                      <button onClick={() => setPage(totalPages)} className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">{totalPages}</button>
                    </>
                  )}
                </>
              )
            })()}

            {page < totalPages && (
              <button
                onClick={() => setPage(page + 1)}
                className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 transition-colors"
              >
                다음 →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
