import Link from 'next/link'
import StatusBadge from '@/app/components/StatusBadge'

export const dynamic = 'force-dynamic'
export const metadata = { title: '대시보드' }

interface BuildStatus { label: string; color: string | null }
interface Hospital { hospitalName: string; hiraHospitalName: string }

interface DashboardProject {
  projectCode: string
  startDate: string | null
  endDateExpected: string | null
  issueNote: string | null
  hospital: Hospital
  buildStatus: BuildStatus | null
}

function fmt(date: string | null): string {
  if (!date) return '미정'
  return date.slice(0, 10)
}

function hospitalName(h: Hospital): string {
  return h.hospitalName || h.hiraHospitalName
}

// 이번주 buildStatus별 카운트 요약
function buildStatusSummary(projects: DashboardProject[]): string {
  const map = new Map<string, number>()
  for (const p of projects) {
    const label = p.buildStatus?.label ?? '상태없음'
    map.set(label, (map.get(label) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .map(([label, count]) => `${label} ${count}건`)
    .join(' · ')
}

export default async function Home() {
  const res = await fetch(`${process.env.NEXTAUTH_URL ?? 'http://localhost:3001'}/api/dashboard`, {
    cache: 'no-store',
  })

  let thisWeek: DashboardProject[] = []
  let nextWeek: DashboardProject[] = []

  if (res.ok) {
    const data = await res.json()
    thisWeek = data.thisWeek ?? []
    nextWeek = data.nextWeek ?? []
  }

  const thClass = 'px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500'
  const tdClass = 'px-4 py-3 text-sm text-gray-700'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">대시보드</h1>
          <p className="mt-1 text-sm text-gray-500">thynC 구축 현황을 확인합니다.</p>
        </div>

        <div className="space-y-6">

          {/* 이번주 구축현황 */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-700">이번주 thynC 구축 현황</h2>
              {thisWeek.length > 0 && (
                <span className="text-xs text-gray-400">{buildStatusSummary(thisWeek)}</span>
              )}
            </div>

            {thisWeek.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-gray-400">해당 주차 구축 일정이 없습니다.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className={`${thClass} w-10 text-center`}>No.</th>
                      <th className={thClass}>병원명</th>
                      <th className={thClass}>진행상태</th>
                      <th className={thClass}>예상종료일</th>
                      <th className={thClass}>비고</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {thisWeek.map((p, i) => (
                      <tr key={p.projectCode} className="transition-colors hover:bg-gray-50">
                        <td className={`${tdClass} text-center text-gray-400`}>{i + 1}</td>
                        <td className={tdClass}>
                          <Link href={`/projects/${p.projectCode}`} className="font-medium text-gray-900 hover:text-blue-600 hover:underline">
                            {hospitalName(p.hospital)}
                          </Link>
                        </td>
                        <td className={tdClass}>
                          {p.buildStatus
                            ? <StatusBadge label={p.buildStatus.label} color={p.buildStatus.color} />
                            : <span className="text-gray-400">-</span>}
                        </td>
                        <td className={`${tdClass} ${!p.endDateExpected ? 'text-gray-400' : ''}`}>
                          {fmt(p.endDateExpected)}
                        </td>
                        <td className={`${tdClass} max-w-xs truncate text-gray-500`}>
                          {p.issueNote ?? '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 차주 구축현황 */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-700">차주 thynC 구축 예정</h2>
              {nextWeek.length > 0 && (
                <span className="text-xs text-gray-400">{nextWeek.length}건 신규구축</span>
              )}
            </div>

            {nextWeek.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-gray-400">해당 주차 구축 일정이 없습니다.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className={`${thClass} w-10 text-center`}>No.</th>
                      <th className={thClass}>병원명</th>
                      <th className={thClass}>시작일</th>
                      <th className={thClass}>예상종료일</th>
                      <th className={thClass}>비고</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {nextWeek.map((p, i) => (
                      <tr key={p.projectCode} className="transition-colors hover:bg-gray-50">
                        <td className={`${tdClass} text-center text-gray-400`}>{i + 1}</td>
                        <td className={tdClass}>
                          <Link href={`/projects/${p.projectCode}`} className="font-medium text-gray-900 hover:text-blue-600 hover:underline">
                            {hospitalName(p.hospital)}
                          </Link>
                        </td>
                        <td className={tdClass}>{fmt(p.startDate)}</td>
                        <td className={`${tdClass} ${!p.endDateExpected ? 'text-gray-400' : ''}`}>
                          {fmt(p.endDateExpected)}
                        </td>
                        <td className={`${tdClass} max-w-xs truncate text-gray-500`}>
                          {p.issueNote ?? '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
