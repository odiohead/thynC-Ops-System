import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { uploadToS3, getSignedUrl } from '@/lib/s3'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { downloadFromS3, s3KeyOf } from '@/lib/gateway-planner/runner'
import { generatePptx } from '@/lib/gateway-planner/pptx'
import { DEFAULT_RULES, GwPlacementResult, GwRules } from '@/lib/gateway-planner/types'

export const dynamic = 'force-dynamic'

// PPTX 생성 → S3 저장 → presigned URL 반환
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const id = parseInt(params.id, 10)
  const job = await prisma.gatewayPlanJob.findUnique({ where: { id } })
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (job.status !== 'PLACED') {
    return NextResponse.json({ error: '스케일 확정 후 PPTX를 생성할 수 있습니다.' }, { status: 409 })
  }
  const placements = job.placements as unknown as GwPlacementResult | null
  if (!placements || !job.imageKey || !job.imageWidth || !job.imageHeight || !job.visionWidth || !job.visionHeight) {
    return NextResponse.json({ error: '배치 결과가 없습니다.' }, { status: 409 })
  }

  const imagePng = await downloadFromS3(job.imageKey)
  const rules = { ...DEFAULT_RULES, ...((job.rulesSnapshot as Partial<GwRules> | null) ?? {}) }
  const pptxBuffer = await generatePptx({
    title: job.title,
    imagePng,
    imageWidth: job.imageWidth,
    imageHeight: job.imageHeight,
    points: placements.points,
    visionWidth: job.visionWidth,
    visionHeight: job.visionHeight,
    rules,
  })

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const safeTitle = job.title.replace(/[^\w가-힣-]+/g, '_').slice(0, 60) || 'floorplan'
  const key = s3KeyOf(id, `GW배치_${safeTitle}_${dateStr}.pptx`)
  await uploadToS3(pptxBuffer, key, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
  await prisma.gatewayPlanJob.update({ where: { id }, data: { pptxKey: key } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'gateway_plan',
    resourceId: id,
    resourceLabel: `${job.title} (PPTX 생성)`,
    after: { pptxKey: key, gatewayCount: placements.points.length },
  })

  const url = await getSignedUrl(key, 3600)
  return NextResponse.json({ ok: true, url })
}
