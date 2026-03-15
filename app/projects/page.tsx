import Link from 'next/link'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import ProjectFilters from './_components/ProjectFilters'
import ProjectPagination from './_components/ProjectPagination'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

interface PageProps {
  searchParams: { [key: string]: string | string[] | undefined }
}

export const metadata = { title: '프로젝트 관리' }

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
        hospital: { select: { hospitalName: true, hospitalCode: true } },
        builder: { select: { name: true } },
      },
    }),
    prisma.project.count({ where }),
  ])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">

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
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['프로젝트 코드', '프로젝트명', '병원명', '차수', '계약일', '구축 담당자', '완료 여부'].map((col) => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {projects.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-sm text-gray-400">
                      {search || isCompletedParam ? '검색 결과가 없습니다.' : '등록된 프로젝트가 없습니다.'}
                    </td>
                  </tr>
                ) : (
                  projects.map((p) => (
                    <tr key={p.id} className="cursor-pointer transition-colors hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">
                        <Link href={`/projects/${p.projectCode}`} className="hover:text-blue-600">
                          {p.projectCode}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        <Link href={`/projects/${p.projectCode}`} className="hover:text-blue-600 hover:underline">
                          {p.projectName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        <Link href={`/hospitals/${p.hospital.hospitalCode}`} className="hover:text-blue-600 hover:underline">
                          {p.hospital.hospitalName}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{p.orderNumber}차</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {p.contractDate ? new Date(p.contractDate).toLocaleDateString('ko-KR') : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {p.builder?.name ?? p.builderNameManual ?? <span className="text-gray-400">-</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          p.isCompleted ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {p.isCompleted ? '완료' : '진행중'}
                        </span>
                      </td>
                    </tr>
                  ))
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
