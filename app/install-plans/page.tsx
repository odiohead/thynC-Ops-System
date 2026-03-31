'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Hospital {
  hospitalCode: string
  hospitalName: string
  hiraHospitalName: string
}

interface UserOption {
  id: string
  name: string
}

interface InstallPlan {
  id: number
  planCode: string | null
  hospital: Hospital | null
  requestDate: string | null
  writeStatus: string
  replyStatus: string
  author: UserOption | null
  replyDate: string | null
  createdAt: string
}

function fmt(d: string | null | undefined) {
  if (!d) return '-'
  return d.slice(0, 10)
}

function StatusBadge({ value }: { value: string }) {
  if (value === '완료') return <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">완료</span>
  if (value === '미완료') return <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">미완료</span>
  return <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">-</span>
}

type SortKey = 'requestDate' | 'replyDate' | 'writeStatus' | 'replyStatus' | 'createdAt'

export default function InstallPlansPage() {
  const router = useRouter()
  const [plans, setPlans] = useState<InstallPlan[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [isAdmin, setIsAdmin] = useState(false)

  const [search, setSearch] = useState('')
  const [writeStatusFilter, setWriteStatusFilter] = useState('')
  const [replyStatusFilter, setReplyStatusFilter] = useState('')
  const [authorIdFilter, setAuthorIdFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  const fetchPlans = useCallback(async () => {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (writeStatusFilter) params.set('writeStatus', writeStatusFilter)
    if (replyStatusFilter) params.set('replyStatus', replyStatusFilter)
    if (authorIdFilter) params.set('authorId', authorIdFilter)
    params.set('orderBy', sortKey)
    params.set('order', sortOrder)

    const res = await fetch(`/api/install-plans?${params}`)
    const data = await res.json()
    setPlans(data.installPlans ?? [])
  }, [search, writeStatusFilter, replyStatusFilter, authorIdFilter, sortKey, sortOrder])

  useEffect(() => {
    fetchPlans()
  }, [fetchPlans])

  useEffect(() => {
    Promise.all([
      fetch('/api/users?organization=SEERS').then((r) => r.json()),
      fetch('/api/auth/me').then((r) => r.json()),
    ]).then(([userData, me]) => {
      setUsers(Array.isArray(userData) ? userData : [])
      setIsAdmin(me?.role === 'SUPER_ADMIN' || me?.role === 'ADMIN')
    })
  }, [])

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortOrder('desc')
    }
  }

  function SortIndicator({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span className="ml-1 text-gray-300">↕</span>
    return <span className="ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span>
  }

  const thClass = 'whitespace-nowrap px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 cursor-pointer hover:bg-gray-100 select-none'
  const thStaticClass = 'whitespace-nowrap px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500'
  const selectClass = 'rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none bg-white'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-full px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">설치계획(가안) 관리</h1>
            <p className="mt-1 text-sm text-gray-500">총 {plans.length.toLocaleString()}개</p>
          </div>
          {isAdmin && (
            <Link
              href="/install-plans/new"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              등록
            </Link>
          )}
        </div>

        {/* 필터 바 */}
        <div className="space-y-2">
          <form
            onSubmit={(e) => { e.preventDefault(); fetchPlans() }}
            className="flex gap-2"
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
              className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
            >
              검색
            </button>
          </form>
          <div className="flex flex-wrap gap-2">
            <select value={writeStatusFilter} onChange={(e) => setWriteStatusFilter(e.target.value)} className={selectClass}>
              <option value="">작성완료여부 전체</option>
              <option value="-">-</option>
              <option value="미완료">미완료</option>
              <option value="완료">완료</option>
            </select>
            <select value={replyStatusFilter} onChange={(e) => setReplyStatusFilter(e.target.value)} className={selectClass}>
              <option value="">회신여부 전체</option>
              <option value="-">-</option>
              <option value="미완료">미완료</option>
              <option value="완료">완료</option>
            </select>
            <select value={authorIdFilter} onChange={(e) => setAuthorIdFilter(e.target.value)} className={selectClass}>
              <option value="">작성자 전체</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>

        {/* 테이블 */}
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className={thStaticClass}>코드</th>
                  <th className={thStaticClass}>병원명</th>
                  <th className={thClass} onClick={() => handleSort('requestDate')}>요청일 <SortIndicator col="requestDate" /></th>
                  <th className={thClass} onClick={() => handleSort('writeStatus')}>작성완료여부 <SortIndicator col="writeStatus" /></th>
                  <th className={thClass} onClick={() => handleSort('replyStatus')}>회신여부 <SortIndicator col="replyStatus" /></th>
                  <th className={thStaticClass}>작성자</th>
                  <th className={thClass} onClick={() => handleSort('replyDate')}>회신일 <SortIndicator col="replyDate" /></th>
                  <th className={thClass} onClick={() => handleSort('createdAt')}>등록일 <SortIndicator col="createdAt" /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {plans.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-16 text-center text-sm text-gray-400">
                      등록된 설치계획(가안)이 없습니다.
                    </td>
                  </tr>
                ) : (
                  plans.map((p) => (
                    <tr
                      key={p.id}
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                      onClick={() => router.push(`/install-plans/${p.id}`)}
                    >
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-gray-500">
                        {p.planCode ?? '-'}
                      </td>
                      <td className="px-3 py-3 font-medium text-gray-900" style={{ minWidth: '160px' }}>
                        {p.hospital
                          ? (p.hospital.hospitalName || p.hospital.hiraHospitalName)
                          : <span className="text-gray-400">-</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-600">{fmt(p.requestDate)}</td>
                      <td className="whitespace-nowrap px-3 py-3"><StatusBadge value={p.writeStatus} /></td>
                      <td className="whitespace-nowrap px-3 py-3"><StatusBadge value={p.replyStatus} /></td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-600">{p.author?.name ?? '-'}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-600">{fmt(p.replyDate)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-600">{fmt(p.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
