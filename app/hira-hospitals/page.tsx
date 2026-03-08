import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import HiraFilters from './_components/HiraFilters'
import Pagination from './_components/Pagination'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

interface PageProps {
  searchParams: { [key: string]: string | string[] | undefined }
}

export const metadata = { title: '심평원 병원목록' }

export default async function HiraHospitalsPage({ searchParams }: PageProps) {
  const page = Math.max(1, parseInt((searchParams.page as string) ?? '1'))
  const search = (searchParams.search as string) ?? ''
  const sido = (searchParams.sido as string) ?? ''
  const typeCode = (searchParams.typeCode as string) ?? ''

  const where = {
    ...(search && { name: { contains: search, mode: 'insensitive' as const } }),
    ...(sido && { sidoName: sido }),
    ...(typeCode && { typeCode }),
  }

  const [hospitals, total, sidoRows, typeRows] = await Promise.all([
    prisma.hiraHospital.findMany({
      where,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        typeCode: true,
        typeName: true,
        address: true,
        openedAt: true,
      },
    }),
    prisma.hiraHospital.count({ where }),
    prisma.hiraHospital.findMany({
      select: { sidoName: true },
      distinct: ['sidoName'],
      orderBy: { sidoName: 'asc' },
    }),
    prisma.hiraHospital.findMany({
      select: { typeCode: true, typeName: true },
      distinct: ['typeCode'],
      orderBy: { typeName: 'asc' },
    }),
  ])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">심평원 병원목록</h1>
          <p className="mt-1 text-sm text-gray-500">총 {total.toLocaleString()}개</p>
        </div>

        {/* 필터 */}
        <HiraFilters
          sidoOptions={sidoRows.map((r) => r.sidoName)}
          typeOptions={typeRows}
          initialSearch={search}
          initialSido={sido}
          initialTypeCode={typeCode}
        />

        {/* 테이블 */}
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['병원명', '종별코드', '종별명', '주소', '개설일'].map((col) => (
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
                    <td colSpan={5} className="py-16 text-center text-sm text-gray-400">
                      검색 결과가 없습니다.
                    </td>
                  </tr>
                ) : (
                  hospitals.map((h) => (
                    <tr key={h.id} className="transition-colors hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        <Link href={`/hira-hospitals/${h.id}`} className="hover:text-blue-600 hover:underline">
                          {h.name}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">
                        {h.typeCode}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {h.typeName}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        <span className="block max-w-xs truncate" title={h.address ?? ''}>
                          {h.address ?? '-'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {h.openedAt ?? '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 페이지네이션 */}
        <Pagination
          page={page}
          totalPages={totalPages}
          search={search}
          sido={sido}
          typeCode={typeCode}
        />
      </div>
    </div>
  )
}
