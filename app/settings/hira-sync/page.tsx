import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken, isSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import HiraSyncPageClient from './_components/HiraSyncPageClient'

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
  }))

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">심평원 연동 관리</h1>
          <p className="mt-1 text-sm text-gray-500">심평원 병원 데이터를 최신 상태로 갱신합니다.</p>
        </div>
        <HiraSyncPageClient initialJobs={serialized} />
      </div>
    </div>
  )
}
