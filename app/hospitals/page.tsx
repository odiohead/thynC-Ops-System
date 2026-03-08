import Link from 'next/link'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
import HospitalFilters from './_components/HospitalFilters'
import Pagination from './_components/Pagination'

const PAGE_SIZE = 20

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  active: { label: '운영중', className: 'bg-green-100 text-green-700' },
  inactive: { label: '운영중단', className: 'bg-red-100 text-red-700' },
  pending: { label: '대기중', className: 'bg-yellow-100 text-yellow-700' },
}

interface PageProps {
  searchParams: { [key: string]: string | string[] | undefined }
}

export const metadata = {
  title: '병원 목록',
}

export default async function HospitalsPage({ searchParams }: PageProps) {
  const page = Math.max(1, parseInt((searchParams.page as string) ?? '1'))
  const search = (searchParams.search as string) ?? ''
  const sido = (searchParams.sido as string) ?? ''

  const where = {
    ...(search && { name: { contains: search, mode: 'insensitive' as const } }),
    ...(sido && { sidoName: sido }),
  }

  const [hospitals, total, sidoRows] = await Promise.all([
    prisma.hospital.findMany({
      where,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        hospitalCode: true,
        name: true,
        type: true,
        sidoName: true,
        sigunguName: true,
        status: true,
      },
    }),
    prisma.hospital.count({ where }),
    prisma.hospital.findMany({
      where: { sidoName: { not: null } },
      select: { sidoName: true },
      distinct: ['sidoName'],
      orderBy: { sidoName: 'asc' },
    }),
  ])

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const sidoOptions = sidoRows.map((r) => r.sidoName!).filter(Boolean)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">병원 목록</h1>
            <p className="mt-1 text-sm text-gray-500">총 {total.toLocaleString()}개</p>
          </div>
          <Link
            href="/hospitals/register"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            병원 등록
          </Link>
        </div>

        {/* 검색 & 필터 */}
        <HospitalFilters
          sidoOptions={sidoOptions}
          initialSearch={search}
          initialSido={sido}
        />

        {/* 테이블 */}
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['병원코드', '병원명', '종별', '시도', '시군구', '상태'].map((col) => (
                    <th
                      key={col}
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {hospitals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center text-sm text-gray-400">
                      검색 결과가 없습니다.
                    </td>
                  </tr>
                ) : (
                  hospitals.map((h) => {
                    const st = STATUS_MAP[h.status] ?? {
                      label: h.status,
                      className: 'bg-gray-100 text-gray-600',
                    }
                    return (
                      <tr key={h.id} className="transition-colors hover:bg-gray-50">
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">
                          {h.hospitalCode}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          <Link href={`/hospitals/${h.hospitalCode}`} className="hover:text-blue-600 hover:underline">
                            {h.name}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                          {h.type}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                          {h.sidoName ?? '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                          {h.sigunguName ?? '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${st.className}`}
                          >
                            {st.label}
                          </span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 페이지네이션 */}
        <Pagination page={page} totalPages={totalPages} search={search} sido={sido} />
      </div>
    </div>
  )
}
