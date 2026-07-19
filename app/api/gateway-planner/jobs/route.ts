import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, isAdminOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { uploadToS3 } from '@/lib/s3'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { runPipeline, s3KeyOf } from '@/lib/gateway-planner/runner'

export const dynamic = 'force-dynamic'

const MAX_SIZE = 30 * 1024 * 1024
const ALLOWED_EXT = ['pdf', 'jpg', 'jpeg', 'png']

// 잡 목록
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const jobs = await prisma.gatewayPlanJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true, title: true, status: true, originalName: true, gatewayCount: true,
      pptxKey: true, errorMessage: true, createdAt: true,
      createdBy: { select: { name: true } },
    },
  })
  return NextResponse.json({ jobs })
}

// 도면 업로드 + 잡 생성 (백그라운드 파이프라인 시작)
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || !isAdminOrAbove(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const formData = await request.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: '파일이 30MB를 초과합니다.' }, { status: 400 })
  }
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (!ALLOWED_EXT.includes(ext)) {
    return NextResponse.json({ error: 'PDF, JPG, PNG 파일만 업로드할 수 있습니다.' }, { status: 400 })
  }

  const titleRaw = formData.get('title')
  const title = (typeof titleRaw === 'string' && titleRaw.trim()) || file.name.replace(/\.[^.]+$/, '')
  const pageRaw = formData.get('page')
  const pageIndex = Math.max(0, (parseInt(String(pageRaw ?? '1'), 10) || 1) - 1)

  const buffer = Buffer.from(await file.arrayBuffer())

  const job = await prisma.gatewayPlanJob.create({
    data: {
      title: title.slice(0, 300),
      status: 'PENDING',
      originalKey: 'pending',
      originalName: file.name.slice(0, 300),
      pageIndex,
      createdById: user.userId,
    },
  })

  const originalKey = s3KeyOf(job.id, `original.${ext}`)
  await uploadToS3(buffer, originalKey, file.type || 'application/octet-stream')
  await prisma.gatewayPlanJob.update({ where: { id: job.id }, data: { originalKey } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'gateway_plan',
    resourceId: job.id,
    resourceLabel: title,
    after: { title, originalName: file.name, pageIndex },
  })

  // 백그라운드 실행 — await 하지 않음 (HiraSyncJob 패턴)
  runPipeline(job.id, buffer).catch(() => {})

  return NextResponse.json({ jobId: job.id })
}
