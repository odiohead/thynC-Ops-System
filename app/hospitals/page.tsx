import Link from 'next/link'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyToken, isAdminOrAbove } from '@/lib/auth'
import StatusBadge from '@/app/components/StatusBadge'

export const dynamic = 'force-dynamic'
import HospitalFilters from './_components/HospitalFilters'
import Pagination from './_components/Pagination'
import ExportToDriveButton from './_components/ExportToDriveButton'
import ImportButton from './_components/ImportButton'

const PAGE_SIZE = 20

const fmtDate = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '-')

interface PageProps {
  searchParams: { [key: string]: string | string[] | undefined }
}

export const metadata = {
  title: '병원 목록',
}

export default async function HospitalsPage({ searchParams }: PageProps) {
  const cookieStore = cookies()
  const token = cookieStore.get('auth-token')?.value
  const user = token ? await verifyToken(token) : null
  const isAdmin = user ? isAdminOrAbove(user.role) : false

  const page = Math.max(1, parseInt((searchParams.page as string) ?? '1'))
  const search = (searchParams.search as string) ?? ''
  const sido = (searchParams.sido as string) ?? ''
  const rawStatus = searchParams.status
  const statusFilter: string[] = rawStatus
    ? Array.isArray(rawStatus) ? rawStatus : [rawStatus]
    : []

  const rawType = searchParams.type
  const typeFilter: string[] = rawType
    ? Array.isArray(rawType) ? rawType : [rawType]
    : []

  const TYPE_ORDER = [
    '상급종합', '종합병원', '병원', '요양병원', '정신병원', '한방병원',
    '치과병원', '의원', '보건소', '보건지소', '보건진료소', '보건의료원', '기타',
  ]

  const where = {
    ...(search && {
      OR: [
        { hospitalName: { contains: search, mode: 'insensitive' as const } },
        { hiraHospitalName: { contains: search, mode: 'insensitive' as const } },
      ],
    }),
    ...(sido && { sidoName: sido }),
    ...(statusFilter.length > 0 && { status: { in: statusFilter } }),
    ...(typeFilter.length > 0 && { type: { in: typeFilter } }),
  }

  const [hospitals, total, sidoRows, statusCodes, typeRows] = await Promise.all([
    prisma.hospital.findMany({
      where,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        hospitalCode: true,
        hospitalName: true,
        type: true,
        address: true,
        status: true,
        contractDate: true,
        meta: {
          select: { driveProjectFolderId: true },
        },
      },
    }),
    prisma.hospital.count({ where }),
    prisma.hospital.findMany({
      where: { sidoName: { not: null } },
      select: { sidoName: true },
      distinct: ['sidoName'],
      orderBy: { sidoName: 'asc' },
    }),
    prisma.statusCode.findMany({
      where: { category: 'HOSPITAL' },
      select: { name: true, color: true },
      orderBy: { order: 'asc' },
    }),
    prisma.hospital.findMany({
      select: { type: true },
      distinct: ['type'],
    }),
  ])

  const statusColorMap = new Map(statusCodes.map((sc) => [sc.name, sc.color]))

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const sidoOptions = sidoRows.map((r) => r.sidoName!).filter(Boolean)
  const allTypes = typeRows.map((r) => r.type).filter(Boolean)
  const typeOptions = TYPE_ORDER.filter((t) => allTypes.includes(t))

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">병원 목록</h1>
            <p className="mt-1 text-sm text-gray-500">총 {total.toLocaleString()}개</p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && <ExportToDriveButton />}
            {isAdmin && <ImportButton />}
            <Link
              href="/hospitals/register"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              병원 등록
            </Link>
          </div>
        </div>

        {/* 검색 & 필터 */}
        <HospitalFilters
          sidoOptions={sidoOptions}
          statusOptions={statusCodes}
          typeOptions={typeOptions}
          initialSearch={search}
          initialSido={sido}
          initialStatuses={statusFilter}
          initialTypes={typeFilter}
        />

        {/* 모바일 카드 리스트 */}
        <div className="mt-4 space-y-2.5 md:hidden">
          {hospitals.length === 0 ? (
            <div className="rounded-xl border border-border bg-card py-16 text-center text-sm text-muted-foreground">
              검색 결과가 없습니다.
            </div>
          ) : (
            hospitals.map((h) => (
              <Link
                key={h.id}
                href={`/hospitals/${h.hospitalCode}`}
                className="block w-full rounded-xl border border-border bg-card p-4 text-left shadow-xs transition active:scale-[0.99]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                    {h.hospitalName}
                  </span>
                  <span className="shrink-0">
                    <StatusBadge label={h.status} color={statusColorMap.get(h.status)} />
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>코드 <span className="font-mono text-foreground">{h.hospitalCode}</span></span>
                  {h.type && (
                    <span>병원종 <span className="text-foreground">{h.type}</span></span>
                  )}
                  <span>계약일 <span className="text-foreground">{fmtDate(h.contractDate)}</span></span>
                  <span className="w-full truncate">주소 <span className="text-foreground">{h.address ?? '-'}</span></span>
                </div>
              </Link>
            ))
          )}
        </div>

        {/* 테이블 (데스크탑) */}
        <div className="mt-4 hidden overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm md:block">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['병원코드', '병원명', '주소', '상태', '계약일', '관리폴더'].map((col) => (
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
                  hospitals.map((h) => (
                    <tr key={h.id} className="transition-colors hover:bg-gray-50">
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">
                          {h.hospitalCode}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          <div className="flex items-center gap-1.5">
                            <Link href={`/hospitals/${h.hospitalCode}`} className="hover:text-blue-600 hover:underline">
                              {h.hospitalName}
                            </Link>
                            {h.type && (
                              <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-normal text-gray-500">
                                {h.type}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {h.address ?? '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <StatusBadge label={h.status} color={statusColorMap.get(h.status)} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                          {fmtDate(h.contractDate)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm">
                          {h.meta?.driveProjectFolderId ? (
                            <a
                              href={`https://drive.google.com/drive/folders/${h.meta.driveProjectFolderId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              바로가기
                            </a>
                          ) : (
                            <span className="text-gray-400">-</span>
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
        <Pagination page={page} totalPages={totalPages} search={search} sido={sido} statuses={statusFilter} types={typeFilter} />
      </div>
    </div>
  )
}
