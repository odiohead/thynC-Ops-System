'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface SiteVisit {
  id: number
  hospital: { hospitalCode: string; hospitalName: string; hiraHospitalName: string }
  daewoongUser: { id: string; name: string } | null
  assignee: { id: string; name: string } | null
  status: { id: number; name: string; color: string | null } | null
  requestDate: string | null
  visitDate: string | null
  replyDate: string | null
  installPlanUrl: string | null
}

function formatDate(val: string | null): string {
  if (!val) return '-'
  return val.slice(0, 10)
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

  const fetchData = useCallback(async (p: number) => {
    setLoading(true)
    const res = await fetch(`/api/site-visits?page=${p}`)
    if (res.ok) {
      const data = await res.json()
      setSiteVisits(data.siteVisits)
      setTotalPages(data.totalPages)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData(page) }, [fetchData, page])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">답사 현황</h1>
          <button
            type="button"
            onClick={() => router.push('/site-visits/new')}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            + 답사 등록
          </button>
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">병원명</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">대웅 담당자</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">담당자</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">상태</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">요청일</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">답사 날짜</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">설치계획서</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">회신 날짜</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-sm text-gray-400">불러오는 중...</td>
                  </tr>
                ) : siteVisits.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-sm text-gray-400">등록된 답사가 없습니다.</td>
                  </tr>
                ) : (
                  siteVisits.map((sv) => (
                    <tr key={sv.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/site-visits/${sv.id}`}
                          className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {sv.hospital.hospitalName || sv.hospital.hiraHospitalName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {sv.daewoongUser?.name ?? '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {sv.assignee?.name ?? '-'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={sv.status} />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{formatDate(sv.requestDate)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{formatDate(sv.visitDate)}</td>
                      <td className="px-4 py-3 text-sm">
                        {sv.installPlanUrl ? (
                          <a href={sv.installPlanUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                            보기
                          </a>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{formatDate(sv.replyDate)}</td>
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
