import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { runPipeline } from '@/lib/gateway-planner/runner'

export const dynamic = 'force-dynamic'

// AI 공간 인식 재실행 (토큰 비용 발생 — 원본을 S3에서 내려받아 파이프라인 재수행)
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const id = parseInt(params.id, 10)
  const job = await prisma.gatewayPlanJob.findUnique({ where: { id } })
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (['RASTERIZING', 'ANALYZING'].includes(job.status)) {
    return NextResponse.json({ error: '이미 분석이 진행 중입니다.' }, { status: 409 })
  }

  await prisma.gatewayPlanJob.update({
    where: { id },
    data: { status: 'PENDING', scaleMPerPx: null, scaleSource: null, pptxKey: null },
  })
  runPipeline(id).catch(() => {})
  return NextResponse.json({ ok: true })
}
