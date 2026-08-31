import Link from 'next/link'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyToken, isAdminOrAbove } from '@/lib/auth'
import StatusBadge from '@/app/components/StatusBadge'

export const dynamic = 'force-dynamic'
import HospitalFilters from './_components/HospitalFilters'
import Pagination from './_components/Pagination'
import ExportToDriveButton from './_components/ExportToDriveButton'
import ExportExcelButton from './_components/ExportExcelButton'
import ImportButton from './_components/ImportButton'

const PAGE_SIZE = 20

// 상품유형 배지 — /sales/deals 목록과 동일한 솔리드 컬러 pill (일반/라이트 복수 공존 표시)
const PRODUCT_TYPE_COLORS: Record<string, string> = { 일반: '#64748b', 라이트: '#0ea5e9' }

function ProductTypeBadge({ t }: { t: string }) {
  return (
    <span
      className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
      style={{ backgroundColor: PRODUCT_TYPE_COLORS[t] ?? '#94a3b8' }}
    >
      {t}
    </span>
  )
}

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
        hiraHospital: {
          select: { permSbdCnt: true },
        },
        introTypes: { select: { statusCode: { select: { name: true } } }, orderBy: { statusCode: { order: 'asc' } } },
        salesDeals: { select: { productType: true }, distinct: ['productType'] },
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

  // 병원별 판매모델(도입형태)·상품유형(딜 합집합, 일반/라이트 순 고정)
  const introNames = (h: (typeof hospitals)[number]) => h.introTypes.map((it) => it.statusCode.name)
  const productTypes = (h: (typeof hospitals)[number]) =>
    ['일반', '라이트'].filter((t) => h.salesDeals.some((d) => d.productType === t))

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
            <ExportExcelButton statusOptions={statusCodes} typeOptions={typeOptions} />
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
                  {h.hiraHospital?.permSbdCnt != null && (
                    <span>전체병상 <span className="text-foreground">{h.hiraHospital.permSbdCnt.toLocaleString()}</span></span>
                  )}
                  <span className="w-full truncate">주소 <span className="text-foreground">{h.address ?? '-'}</span></span>
                </div>
                {(introNames(h).length > 0 || productTypes(h).length > 0) && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {introNames(h).map((n) => (
                      <span key={n} className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">{n}</span>
                    ))}
                    {productTypes(h).map((t) => (
                      <ProductTypeBadge key={t} t={t} />
                    ))}
                  </div>
                )}
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
                  {['병원코드', '병원명', '주소', '전체병상', '상태', '판매모델', '상품유형'].map((col) => (
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
                    <td colSpan={7} className="py-16 text-center text-sm text-gray-400">
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
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums text-gray-600">
                          {h.hiraHospital?.permSbdCnt != null ? h.hiraHospital.permSbdCnt.toLocaleString() : '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <StatusBadge label={h.status} color={statusColorMap.get(h.status)} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {introNames(h).length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {introNames(h).map((n) => (
                                <span key={n} className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                                  {n}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {productTypes(h).length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {productTypes(h).map((t) => (
                                <ProductTypeBadge key={t} t={t} />
                              ))}
                            </div>
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
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
