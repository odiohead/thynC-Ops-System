import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || !isSuperAdmin(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const jobId = parseInt(params.id)
  if (isNaN(jobId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const job = await prisma.hiraSyncJob.findUnique({
    where: { id: jobId },
    include: { logs: { orderBy: { createdAt: 'asc' } } },
  })

  if (!job) return NextResponse.json({ error: '잡을 찾을 수 없습니다.' }, { status: 404 })

  // 상세연동(분할 실행) 잡은 진행 요약 + 실패 병원 표본을 함께 반환 (hira_detail_sync_v2_design.md §5)
  let progress = null
  if (job.jobType === 'detail' && job.params) {
    const pending = job.totalTargets - job.doneCount - job.failedCount
    const failedSample = await prisma.hiraSyncJobTarget.findMany({
      where: { jobId, status: 'failed' },
      select: { error: true, hiraHospital: { select: { id: true, name: true, typeName: true } } },
      orderBy: { processedAt: 'desc' },
      take: 20,
    })
    const remainingDays = job.dailyQuota > 0 ? Math.ceil(pending / job.dailyQuota) : null
    progress = {
      totalTargets: job.totalTargets,
      doneCount: job.doneCount,
      failedCount: job.failedCount,
      pending,
      dailyQuota: job.dailyQuota,
      callsToday: job.callsToday,
      quotaDate: job.quotaDate,
      dayCount: job.dayCount,
      nextRunAt: job.nextRunAt,
      remainingDays,
      failedSample: failedSample.map((f) => ({ ...f.hiraHospital, error: f.error })),
    }
  }

  return NextResponse.json({ job, progress })
}
