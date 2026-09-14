import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken, isSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import HiraSyncPageClient from './_components/HiraSyncPageClient'
import { DETAIL_CL_CODES, DETAIL_ITEMS, DAILY_CALL_BUDGET } from '@/lib/hira-detail-sync'

export const dynamic = 'force-dynamic'
export const metadata = { title: '심평원 연동 관리' }

export default async function HiraSyncPage() {
  const cookieStore = cookies()
  const token = cookieStore.get('auth-token')?.value
  const user = token ? await verifyToken(token) : null

  if (!user || !isSuperAdmin(user.role)) redirect('/')

  const jobs = await prisma.hiraSyncJob.findMany({
    orderBy: { startedAt: 'desc' },
    take: 50,
  })

  const serialized = jobs.map((j) => ({
    id: j.id,
    startedAt: j.startedAt.toISOString(),
    endedAt: j.endedAt ? j.endedAt.toISOString() : null,
    status: j.status,
    totalCount: j.totalCount,
    jobType: j.jobType,
    params: j.params as { typeCodes: string[]; items: string[] } | null,
    totalTargets: j.totalTargets,
    doneCount: j.doneCount,
    failedCount: j.failedCount,
    nextRunAt: j.nextRunAt ? j.nextRunAt.toISOString() : null,
  }))

  // 병원상세정보연동 대상 종별 — lib/hira-detail-sync.ts DETAIL_CL_CODES 단일 소스 (v2: 의원 포함)
  const typeCounts = await prisma.hiraHospital.groupBy({
    by: ['typeCode'],
    where: { typeCode: { in: DETAIL_CL_CODES.map((c) => c.code) } },
    _count: { _all: true },
  })
  const detailTypes = DETAIL_CL_CODES.map((c) => ({
    ...c,
    count: typeCounts.find((t) => t.typeCode === c.code)?._count._all ?? 0,
  }))

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">심평원 연동 관리</h1>
          <p className="mt-1 text-sm text-gray-500">심평원 병원 데이터를 최신 상태로 갱신합니다.</p>
        </div>
        <HiraSyncPageClient initialJobs={serialized} detailTypes={detailTypes} detailItems={DETAIL_ITEMS.map((d) => ({ key: d.key, name: d.name }))} dailyCallBudget={DAILY_CALL_BUDGET} />
      </div>
    </div>
  )
}
