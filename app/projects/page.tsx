import Link from 'next/link'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import ProjectFilters from './_components/ProjectFilters'
import ProjectPagination from './_components/ProjectPagination'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

const ECG_MODEL = 'MC200MT-T'
const SPO2_MODEL = 'MP1000W'

interface PageProps {
  searchParams: { [key: string]: string | string[] | undefined }
}

export const metadata = { title: '프로젝트 관리' }

function fmt(date: Date | null | undefined): string {
  if (!date) return '-'
  return new Date(date).toISOString().slice(0, 10)
}

function Num({ v }: { v: number | null | undefined }) {
  return <span>{v != null ? v : '-'}</span>
}

export default async function ProjectsPage({ searchParams }: PageProps) {
  const cookieStore = cookies()
  const token = cookieStore.get('auth-token')?.value
  const user = token ? await verifyToken(token) : null
  const isAdmin = user?.role === 'ADMIN'

  const page = Math.max(1, parseInt((searchParams.page as string) ?? '1'))
  const search = (searchParams.search as string) ?? ''
  const isCompletedParam = (searchParams.isCompleted as string) ?? ''

  const where = {
    ...(search && {
      OR: [
        { projectName: { contains: search, mode: 'insensitive' as const } },
        { hospital: { hospitalName: { contains: search, mode: 'insensitive' as const } } },
      ],
    }),
    ...(isCompletedParam !== '' && { isCompleted: isCompletedParam === 'true' }),
  }

  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      orderBy: { createdAt: 'desc' },
      include: {
        hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true } },
        builder: { select: { name: true } },
        contractor: { select: { name: true } },
        devices: {
          include: { deviceInfo: { select: { deviceModel: true } } },
        },
      },
    }),
    prisma.project.count({ where }),
  ])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const cols = [
    '프로젝트 코드', '프로젝트명', '차수', '계약일',
    '병동 수', '병상 수', 'G/W', '심전계', '산소포화도',
    '담당자', '구축업체', '구축 시작일', '구축 종료일(예상)', '프로젝트 폴더',
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-full px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">프로젝트 관리</h1>
            <p className="mt-1 text-sm text-gray-500">총 {total.toLocaleString()}개</p>
          </div>
          {isAdmin && (
            <Link
              href="/projects/new"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              프로젝트 등록
            </Link>
          )}
        </div>

        {/* 필터 */}
        <ProjectFilters initialSearch={search} initialIsCompleted={isCompletedParam} />

        {/* 테이블 */}
        <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {cols.map((col) => (
                    <th
                      key={col}
                      className="whitespace-nowrap px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {projects.length === 0 ? (
                  <tr>
                    <td colSpan={cols.length} className="py-16 text-center text-sm text-gray-400">
                      {search || isCompletedParam ? '검색 결과가 없습니다.' : '등록된 프로젝트가 없습니다.'}
                    </td>
                  </tr>
                ) : (
                  projects.map((p) => {
                    const ecgQty = p.devices.find((d) => d.deviceInfo.deviceModel === ECG_MODEL)?.quantity ?? null
                    const spo2Qty = p.devices.find((d) => d.deviceInfo.deviceModel === SPO2_MODEL)?.quantity ?? null

                    return (
                      <tr key={p.id} className="transition-colors hover:bg-gray-50">
                        {/* 프로젝트 코드 */}
                        <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-gray-500" style={{ minWidth: '160px' }}>
                          <Link href={`/projects/${p.projectCode}`} className="hover:text-blue-600">
                            {p.projectCode}
                          </Link>
                        </td>

                        {/* 프로젝트명 */}
                        <td className="px-3 py-3 font-medium text-gray-900" style={{ minWidth: '160px' }}>
                          <Link href={`/projects/${p.projectCode}`} className="hover:text-blue-600 hover:underline">
                            {p.projectName}
                          </Link>
                        </td>

                        {/* 차수 */}
                        <td className="whitespace-nowrap px-3 py-3 text-center text-gray-600" style={{ minWidth: '56px' }}>
                          {p.orderNumber}차
                        </td>

                        {/* 계약일 */}
                        <td className="whitespace-nowrap px-3 py-3 text-gray-600" style={{ minWidth: '100px' }}>
                          {fmt(p.contractDate)}
                        </td>

                        {/* 병동 수 */}
                        <td className="whitespace-nowrap px-3 py-3 text-center text-gray-600" style={{ minWidth: '64px' }}>
                          <Num v={p.wardCount} />
                        </td>

                        {/* 병상 수 */}
                        <td className="whitespace-nowrap px-3 py-3 text-center text-gray-600" style={{ minWidth: '64px' }}>
                          <Num v={p.bedCount} />
                        </td>

                        {/* G/W */}
                        <td className="whitespace-nowrap px-3 py-3 text-center text-gray-600" style={{ minWidth: '56px' }}>
                          <Num v={p.gatewayCount} />
                        </td>

                        {/* 심전계 */}
                        <td className="whitespace-nowrap px-3 py-3 text-center text-gray-600" style={{ minWidth: '64px' }}>
                          <Num v={ecgQty} />
                        </td>

                        {/* 산소포화도 */}
                        <td className="whitespace-nowrap px-3 py-3 text-center text-gray-600" style={{ minWidth: '80px' }}>
                          <Num v={spo2Qty} />
                        </td>

                        {/* 담당자 */}
                        <td className="whitespace-nowrap px-3 py-3 text-gray-600" style={{ minWidth: '80px' }}>
                          {p.builder?.name ?? p.builderNameManual ?? <span className="text-gray-400">-</span>}
                        </td>

                        {/* 구축업체 */}
                        <td className="whitespace-nowrap px-3 py-3 text-gray-600" style={{ minWidth: '100px' }}>
                          {p.contractor?.name ?? <span className="text-gray-400">-</span>}
                        </td>

                        {/* 구축 시작일 */}
                        <td className="whitespace-nowrap px-3 py-3 text-gray-600" style={{ minWidth: '100px' }}>
                          {fmt(p.startDate)}
                        </td>

                        {/* 구축 종료일(예상) */}
                        <td className="whitespace-nowrap px-3 py-3 text-gray-600" style={{ minWidth: '120px' }}>
                          {fmt(p.endDateExpected)}
                        </td>

                        {/* 프로젝트 폴더 */}
                        <td className="whitespace-nowrap px-3 py-3" style={{ minWidth: '80px' }}>
                          {p.driveFolderId ? (
                            <a
                              href={`https://drive.google.com/drive/folders/${p.driveFolderId}`}
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
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 페이지네이션 */}
        <ProjectPagination page={page} totalPages={totalPages} search={search} isCompleted={isCompletedParam} />

      </div>
    </div>
  )
}
