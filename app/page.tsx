import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import StatusBadge from '@/app/components/StatusBadge'

export const dynamic = 'force-dynamic'
export const metadata = { title: '대시보드' }

// 한국 시간(Asia/Seoul) 기준 이번주/차주 월~일 UTC 범위 계산
function getWeekRange(offsetWeeks: number): { start: Date; end: Date } {
  const KST_OFFSET = 9 * 60 * 60 * 1000
  const kstNow = new Date(Date.now() + KST_OFFSET)
  const dayOfWeek = kstNow.getUTCDay()
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const monday = new Date(kstNow)
  monday.setUTCDate(kstNow.getUTCDate() + diffToMonday + offsetWeeks * 7)
  monday.setUTCHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  sunday.setUTCHours(23, 59, 59, 999)
  return {
    start: new Date(monday.getTime() - KST_OFFSET),
    end: new Date(sunday.getTime() - KST_OFFSET),
  }
}

const projectSelect = {
  projectCode: true,
  startDate: true,
  endDateExpected: true,
  issueNote: true,
  hospital: { select: { hospitalName: true, hiraHospitalName: true } },
  buildStatus: { select: { label: true, color: true } },
} as const

type DashboardProject = {
  projectCode: string
  startDate: Date | null
  endDateExpected: Date | null
  issueNote: string | null
  hospital: { hospitalName: string; hiraHospitalName: string }
  buildStatus: { label: string; color: string | null } | null
}

function fmt(date: Date | null): string {
  if (!date) return '미정'
  return new Date(date).toISOString().slice(0, 10)
}

function hospitalName(h: { hospitalName: string; hiraHospitalName: string }): string {
  return h.hospitalName || h.hiraHospitalName
}

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
  const thisWeek = getWeekRange(0)
  const nextWeek = getWeekRange(1)

  // 이번주: (A) buildStatus null 또는 "완료" 아님, (B) 이번주 startDate — OR 후 중복 제거
  const thisWeekRaw = await prisma.project.findMany({
    where: {
      OR: [
        { buildStatus: null },
        { buildStatus: { label: { not: '완료' } } },
        { startDate: { gte: thisWeek.start, lte: thisWeek.end } },
      ],
    },
    select: projectSelect,
    orderBy: [{ endDateExpected: { sort: 'asc', nulls: 'last' } }],
  }) as DashboardProject[]

  const seen = new Set<string>()
  const thisWeekProjects = thisWeekRaw.filter((p) => {
    if (seen.has(p.projectCode)) return false
    seen.add(p.projectCode)
    return true
  })

  // 차주: startDate가 차주 범위
  const nextWeekProjects = await prisma.project.findMany({
    where: { startDate: { gte: nextWeek.start, lte: nextWeek.end } },
    select: projectSelect,
    orderBy: { startDate: 'asc' },
  }) as DashboardProject[]

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
              {thisWeekProjects.length > 0 && (
                <span className="text-xs text-gray-400">{buildStatusSummary(thisWeekProjects)}</span>
              )}
            </div>
            {thisWeekProjects.length === 0 ? (
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
                    {thisWeekProjects.map((p, i) => (
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
              {nextWeekProjects.length > 0 && (
                <span className="text-xs text-gray-400">{nextWeekProjects.length}건 신규구축</span>
              )}
            </div>
            {nextWeekProjects.length === 0 ? (
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
                    {nextWeekProjects.map((p, i) => (
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
