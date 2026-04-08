import Link from 'next/link'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { CalendarDays } from 'lucide-react'
import ProjectFilters from './_components/ProjectFilters'
import StatusBadge from '@/app/components/StatusBadge'

export const dynamic = 'force-dynamic'

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
  const isAdmin = !!user && user.role !== 'VIEWER'

  const search = (searchParams.search as string) ?? ''
  const buildStatusId = (searchParams.buildStatusId as string) ?? ''
  const contractorId = (searchParams.contractorId as string) ?? ''
  const builderId = (searchParams.builderId as string) ?? ''
  const orderBy = (searchParams.orderBy as string) ?? 'startDate'
  const order = ((searchParams.order as string) ?? 'desc') as 'asc' | 'desc'

  const buildStatusIds = buildStatusId ? buildStatusId.split(',').map(Number).filter(Boolean) : []
  const contractorIds = contractorId ? contractorId.split(',').map(Number).filter(Boolean) : []
  const builderIdList = builderId ? builderId.split(',').filter(Boolean) : []

  const startDateNulls = order === 'desc' ? 'first' : 'last'
  const orderByMap: Record<string, object> = {
    contractDate: { contractDate: { sort: order, nulls: 'last' } },
    startDate: { startDate: { sort: order, nulls: startDateNulls } },
  }
  const orderByClause = orderByMap[orderBy] ?? { startDate: { sort: 'desc', nulls: 'first' } }

  const where = {
    ...(search && {
      OR: [
        { projectName: { contains: search, mode: 'insensitive' as const } },
        { hospital: { hospitalName: { contains: search, mode: 'insensitive' as const } } },
      ],
    }),
    ...(buildStatusIds.length > 0 && { buildStatusId: { in: buildStatusIds } }),
    ...(contractorIds.length > 0 && { constructorId: { in: contractorIds } }),
    ...(builderIdList.length > 0 && { assignees: { some: { userId: { in: builderIdList } } } }),
  }

  const rawProjects = await prisma.project.findMany({
    where,
    orderBy: orderByClause,
    include: {
      hospital: { select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true } },
      assignees: { include: { user: { select: { name: true } } } },
      contractor: { select: { name: true } },
      buildStatus: { select: { label: true, color: true } },
      devices: {
        include: { deviceInfo: { select: { deviceModel: true } } },
      },
    },
  })

  // 보류 상태 항목은 배열 맨 뒤로 정렬
  const projects = [...rawProjects].sort((a, b) => {
    const aHold = a.buildStatus?.label === '보류' ? 1 : 0
    const bHold = b.buildStatus?.label === '보류' ? 1 : 0
    return aHold - bHold
  })

  const cols = [
    '프로젝트명', '진행상태', '담당자', '구축 시작일', '구축 종료일(예상)', '도입형태', '계약일',
    '병동 수', '병상 수', 'G/W', '심전계', '산소포화도', '구축업체',
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-full px-4 py-8 sm:px-6 lg:px-8">

        {/* 헤더 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">프로젝트 관리</h1>
            <p className="mt-1 text-sm text-gray-500">총 {projects.length.toLocaleString()}개</p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/projects/calendar"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              <CalendarDays size={15} />
              캘린더 보기
            </a>
            {isAdmin && (
              <Link
                href="/projects/new"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                프로젝트 등록
              </Link>
            )}
          </div>
        </div>

        {/* 필터 */}
        <ProjectFilters
          initialSearch={search}
          initialBuildStatusId={buildStatusId}
          initialContractorId={contractorId}
          initialBuilderId={builderId}
          initialOrderBy={orderBy}
          initialOrder={order}
        />

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
                      {search ? '검색 결과가 없습니다.' : '등록된 프로젝트가 없습니다.'}
                    </td>
                  </tr>
                ) : (
                  projects.map((p) => {
                    const ecgQty = p.devices.find((d) => d.deviceInfo.deviceModel === ECG_MODEL)?.quantity ?? null
                    const spo2Qty = p.devices.find((d) => d.deviceInfo.deviceModel === SPO2_MODEL)?.quantity ?? null

                    return (
                      <tr key={p.id} className="transition-colors hover:bg-gray-50">
                        <td className="px-3 py-3 font-medium text-gray-900" style={{ minWidth: '160px' }}>
                          <Link href={`/projects/${p.projectCode}`} className="hover:text-blue-600 hover:underline">
                            {p.projectName}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3" style={{ minWidth: '100px' }}>
                          {p.buildStatus
                            ? <StatusBadge label={p.buildStatus.label} color={p.buildStatus.color} />
                            : <span className="text-gray-400">-</span>}
                        </td>
                        <td className="px-3 py-3 text-gray-600" style={{ minWidth: '100px' }}>
                          {p.assignees.length > 0
                            ? p.assignees.map((a) => a.user.name).join(', ')
                            : <span className="text-gray-400">-</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-gray-600" style={{ minWidth: '100px' }}>
                          {fmt(p.startDate)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-gray-600" style={{ minWidth: '120px' }}>
                          {fmt(p.endDateExpected)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-gray-600" style={{ minWidth: '88px' }}>
                          {p.contractType ?? <span className="text-gray-400">-</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-gray-600" style={{ minWidth: '100px' }}>
                          {fmt(p.contractDate)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-center text-gray-600" style={{ minWidth: '64px' }}>
                          <Num v={p.wardCount} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-center text-gray-600" style={{ minWidth: '64px' }}>
                          <Num v={p.bedCount} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-center text-gray-600" style={{ minWidth: '56px' }}>
                          <Num v={p.gatewayCount} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-center text-gray-600" style={{ minWidth: '64px' }}>
                          <Num v={ecgQty} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-center text-gray-600" style={{ minWidth: '80px' }}>
                          <Num v={spo2Qty} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-gray-600" style={{ minWidth: '100px' }}>
                          {p.contractor?.name ?? <span className="text-gray-400">-</span>}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
