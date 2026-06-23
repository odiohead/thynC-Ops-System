'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface StatusCode {
  id: number
  name: string
  color: string | null
}

interface SiteVisit {
  id: number
  hospital: { hospitalCode: string; hospitalName: string; hiraHospitalName: string; address: string | null }
  daewoongUser: { id: string; name: string } | null
  assignees: { user: { id: string; name: string } }[]
  status: StatusCode | null
  requestDate: string | null
  visitDate: string | null
  replyDate: string | null
}

function formatDate(val: string | null): string {
  if (!val) return '-'
  return val.slice(0, 10)
}

function formatCode(sv: { siteVisitCode?: string | null; id: number }): string {
  return sv.siteVisitCode ?? `SV-${String(sv.id).padStart(5, '0')}`
}

function StatusBadge({ status }: { status: { name: string; color: string | null } | null }) {
  if (!status) return <span className="text-gray-400">-</span>
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: status.color ? `${status.color}22` : '#F3F4F6',
        color: status.color ?? '#6B7280',
        border: `1px solid ${status.color ?? '#E5E7EB'}`,
      }}
    >
      {status.name}
    </span>
  )
}

export default function SiteVisitsPage() {
  const router = useRouter()
  const [siteVisits, setSiteVisits] = useState<SiteVisit[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [statuses, setStatuses] = useState<StatusCode[]>([])
  const [filterStatusId, setFilterStatusId] = useState('')

  // 상단 가로 스크롤바 ↔ 테이블 스크롤 동기화
  const topScrollRef = useRef<HTMLDivElement>(null)
  const tableScrollRef = useRef<HTMLDivElement>(null)
  const [scrollWidth, setScrollWidth] = useState(0)
  const syncingRef = useRef(false)

  // 테이블 실제 스크롤 폭을 상단 더미 바에 반영 (데이터/창 크기 변동 시)
  useEffect(() => {
    const measure = () => {
      if (tableScrollRef.current) setScrollWidth(tableScrollRef.current.scrollWidth)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [siteVisits, loading])

  const syncFrom = (src: HTMLDivElement | null, dst: HTMLDivElement | null) => {
    if (!src || !dst || syncingRef.current) return
    syncingRef.current = true
    dst.scrollLeft = src.scrollLeft
    requestAnimationFrame(() => { syncingRef.current = false })
  }

  useEffect(() => {
    fetch('/api/settings/site-visit-status')
      .then((r) => r.json())
      .then((data) => setStatuses(data.statusCodes ?? []))
  }, [])

  const fetchData = useCallback(async (p: number, statusId: string) => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(p) })
    if (statusId) params.set('statusId', statusId)
    const res = await fetch(`/api/site-visits?${params}`)
    if (res.ok) {
      const data = await res.json()
      setSiteVisits(data.siteVisits)
      setTotalPages(data.totalPages)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData(page, filterStatusId) }, [fetchData, page, filterStatusId])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">답사 관리</h1>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push('/site-visit-queue')}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              메일 확인
            </button>
            <button
              type="button"
              onClick={() => router.push('/site-visits/new')}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              + 답사 등록
            </button>
          </div>
        </div>

        {/* 필터 */}
        <div className="mb-4 flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700">상태</label>
          <select
            value={filterStatusId}
            onChange={(e) => { setFilterStatusId(e.target.value); setPage(1) }}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">전체</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* 상단 동기화 가로 스크롤바 — 페이지 로딩 시 바로 보임 */}
        <div
          ref={topScrollRef}
          onScroll={() => syncFrom(topScrollRef.current, tableScrollRef.current)}
          className="overflow-x-auto"
        >
          <div style={{ width: scrollWidth, height: 1 }} />
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div
            ref={tableScrollRef}
            onScroll={() => syncFrom(tableScrollRef.current, topScrollRef.current)}
            className="overflow-x-auto"
          >
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">코드</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">병원명</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">주소</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">대웅 담당자</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">담당자</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">상태</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">요청일</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">답사 날짜</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">회신 날짜</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-sm text-gray-400">불러오는 중...</td>
                  </tr>
                ) : siteVisits.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-sm text-gray-400">등록된 답사가 없습니다.</td>
                  </tr>
                ) : (
                  siteVisits.map((sv) => (
                    <tr key={sv.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs font-mono text-gray-400 whitespace-nowrap">
                        {formatCode(sv)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Link
                          href={`/site-visits/${sv.id}`}
                          className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {sv.hospital.hospitalName || sv.hospital.hiraHospitalName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">
                        {sv.hospital.address || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                        {sv.daewoongUser?.name ?? '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                        {sv.assignees?.length > 0 ? sv.assignees.map((a) => a.user.name).join(', ') : '-'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusBadge status={sv.status} />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{formatDate(sv.requestDate)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{formatDate(sv.visitDate)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{formatDate(sv.replyDate)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex justify-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              이전
            </button>
            <span className="px-3 py-1.5 text-sm text-gray-600">{page} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              다음
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
