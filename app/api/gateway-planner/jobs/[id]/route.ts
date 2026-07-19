import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getSignedUrl, deleteFromS3 } from '@/lib/s3'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// 잡 상세 (상태 폴링 겸용)
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const id = parseInt(params.id, 10)
  const job = await prisma.gatewayPlanJob.findUnique({
    where: { id },
    include: { createdBy: { select: { name: true } } },
  })
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const visionUrl = job.visionKey ? await getSignedUrl(job.visionKey, 3600) : null
  const pptxUrl = job.pptxKey ? await getSignedUrl(job.pptxKey, 3600) : null
  return NextResponse.json({ job: { ...job, visionUrl, pptxUrl } })
}

// 잡 삭제 (S3 파일 포함)
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const id = parseInt(params.id, 10)
  const job = await prisma.gatewayPlanJob.findUnique({ where: { id } })
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const keys = [job.originalKey, job.imageKey, job.visionKey, job.pptxKey].filter(
    (k): k is string => !!k && k !== 'pending',
  )
  for (const key of keys) {
    await deleteFromS3(key).catch(() => {})
  }
  await prisma.gatewayPlanJob.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'gateway_plan',
    resourceId: id,
    resourceLabel: job.title,
    before: { title: job.title, status: job.status, gatewayCount: job.gatewayCount },
  })
  return new NextResponse(null, { status: 204 })
}
