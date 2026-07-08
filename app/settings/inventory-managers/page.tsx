'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Manager {
  id: number
  createdAt: string
  user: {
    id: string
    name: string
    email: string
    organization: { name: string } | null
    department: { name: string } | null
  }
}

interface Candidate {
  id: string
  name: string
  email: string
  organization: { name: string } | null
  department: { name: string } | null
}

export default function InventoryManagersPage() {
  const router = useRouter()
  const [managers, setManagers] = useState<Manager[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const limit = 20
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState<string | null>(null)

  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [candidateTotal, setCandidateTotal] = useState(0)
  const [candidatePage, setCandidatePage] = useState(1)
  const candidateLimit = 10
  const [candidateLoading, setCandidateLoading] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchManagers = useCallback(async (p: number) => {
    setLoading(true)
    const res = await fetch(`/api/settings/inventory-managers?page=${p}&limit=${limit}`)
    if (res.ok) {
      const data = await res.json()
      setManagers(data.data)
      setTotal(data.total)
    }
    setLoading(false)
  }, [])

  async function fetchMe() {
    const res = await fetch('/api/auth/me')
    if (res.ok) {
      const data = await res.json()
      setUserRole(data.role ?? null)
      if (data.role !== 'SUPER_ADMIN' && data.role !== 'ADMIN') {
        router.push('/')
      }
    }
  }

  useEffect(() => {
    fetchMe()
  }, [])

  useEffect(() => {
    setPage(1)
    fetchManagers(1)
  }, [fetchManagers])

  const fetchCandidates = useCallback(async (s: string, p: number) => {
    setCandidateLoading(true)
    setModalError(null)
    const res = await fetch(`/api/settings/inventory-managers/candidates?search=${encodeURIComponent(s)}&page=${p}&limit=${candidateLimit}`)
    if (res.ok) {
      const data = await res.json()
      setCandidates(data.data)
      setCandidateTotal(data.total)
    }
    setCandidateLoading(false)
  }, [candidateLimit])

  function openModal() {
    setShowModal(true)
    setSearch('')
    setCandidates([])
    setCandidateTotal(0)
    setCandidatePage(1)
    setModalError(null)
    fetchCandidates('', 1)
  }

  function handleSearchChange(value: string) {
    setSearch(value)
    setCandidatePage(1)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchCandidates(value, 1)
    }, 300)
  }

  function handleCandidatePageChange(newPage: number) {
    setCandidatePage(newPage)
    fetchCandidates(search, newPage)
  }

  async function handleSelect(candidate: Candidate) {
    setModalError(null)
    const res = await fetch('/api/settings/inventory-managers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: candidate.id }),
    })
    if (res.ok) {
      setShowModal(false)
      setPage(1)
      fetchManagers(1)
      router.refresh()
    } else {
      const data = await res.json()
      setModalError(data.error ?? '등록에 실패했습니다.')
    }
  }

  async function handleDelete(m: Manager) {
    if (!confirm(`'${m.user.name}' 재고 담당자를 삭제하시겠습니까?`)) return
    const res = await fetch(`/api/settings/inventory-managers/${m.id}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) {
      fetchManagers(page)
      router.refresh()
    }
  }

  const totalPages = Math.ceil(total / limit)
  const candidateTotalPages = Math.ceil(candidateTotal / candidateLimit)

  if (loading && managers.length === 0) {
    return <div className="p-8 text-sm text-gray-500">로딩 중...</div>
  }

  if (userRole && userRole !== 'SUPER_ADMIN' && userRole !== 'ADMIN') {
    return null
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-semibold text-gray-900">재고 담당자 관리</h1>
        <button
          onClick={openModal}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          + 추가
        </button>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        재고 입고·출고·이동·취소를 처리할 수 있는 담당자입니다. (ADMIN 이상은 등록 없이도 처리 가능)
      </p>

      <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">번호</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">이름</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">이메일</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">소속</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">부서</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">추가일</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">삭제</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {managers.map((m, i) => (
              <tr key={m.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{(page - 1) * limit + i + 1}</td>
                <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{m.user.name}</td>
                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{m.user.email}</td>
                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{m.user.organization?.name ?? '-'}</td>
                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{m.user.department?.name ?? '-'}</td>
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                  {new Date(m.createdAt).toLocaleDateString('ko-KR')}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <button
                    onClick={() => handleDelete(m)}
                    className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-500 hover:bg-red-50 transition-colors"
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {managers.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-500">등록된 재고 담당자가 없습니다.</div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            onClick={() => { setPage(page - 1); fetchManagers(page - 1) }}
            disabled={page === 1}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            이전
          </button>
          <span className="text-sm text-gray-600">{page} / {totalPages}</span>
          <button
            onClick={() => { setPage(page + 1); fetchManagers(page + 1) }}
            disabled={page === totalPages}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false) }}
        >
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl mx-4">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-base font-semibold text-gray-900">재고 담당자 추가</h2>
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-4">
              <input
                type="text"
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="이름 또는 이메일 검색"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />

              {modalError && (
                <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                  {modalError}
                </div>
              )}

              <div className="mt-3 overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">이름</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">이메일</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">소속</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">선택</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {candidateLoading ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-xs text-gray-400">검색 중...</td>
                      </tr>
                    ) : candidates.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-xs text-gray-400">후보 없음</td>
                      </tr>
                    ) : (
                      candidates.map((c) => (
                        <tr key={c.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium text-gray-900">{c.name}</td>
                          <td className="px-3 py-2 text-gray-600 text-xs">{c.email}</td>
                          <td className="px-3 py-2 text-gray-500 text-xs">{c.organization?.name ?? '-'}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => handleSelect(c)}
                              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
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

              {candidateTotalPages > 1 && (
                <div className="mt-3 flex items-center justify-center gap-2">
                  <button
                    onClick={() => handleCandidatePageChange(candidatePage - 1)}
                    disabled={candidatePage === 1}
                    className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                  >
                    이전
                  </button>
                  <span className="text-xs text-gray-600">{candidatePage} / {candidateTotalPages}</span>
                  <button
                    onClick={() => handleCandidatePageChange(candidatePage + 1)}
                    disabled={candidatePage === candidateTotalPages}
                    className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                  >
                    다음
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
