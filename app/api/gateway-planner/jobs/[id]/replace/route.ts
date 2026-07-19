import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { runPlacement } from '@/lib/gateway-planner/runner'
import { GwScaleCandidate } from '@/lib/gateway-planner/types'

export const dynamic = 'force-dynamic'

// 현재 규칙으로 재배치 (AI 재호출 없음)
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const id = parseInt(params.id, 10)
  const job = await prisma.gatewayPlanJob.findUnique({ where: { id } })
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!job.analysis) return NextResponse.json({ error: '분석 결과가 아직 없습니다.' }, { status: 409 })

  const scaleMeta = (job.scaleMeta as { candidate?: GwScaleCandidate } | null) ?? {}
  const mPerPx = job.scaleMPerPx ?? scaleMeta.candidate?.mPerPx ?? null
  const { count } = await runPlacement(id, mPerPx)
  return NextResponse.json({ ok: true, gatewayCount: count })
}
