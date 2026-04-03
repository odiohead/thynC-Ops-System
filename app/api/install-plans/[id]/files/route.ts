import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { uploadToS3 } from '@/lib/s3'

type Params = { params: { id: string } }

const VALID_CATEGORIES = ['FLOOR_PLAN', 'INSTALL_PLAN']

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getAuthUser(_req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const files = await prisma.installPlanFile.findMany({
    where: { installPlanId: id },
    orderBy: { uploadedAt: 'asc' },
  })

  return NextResponse.json({ files })
}

export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const installPlan = await prisma.installPlan.findUnique({ where: { id } })
  if (!installPlan) return NextResponse.json({ error: '설치계획을 찾을 수 없습니다.' }, { status: 404 })

  if (!installPlan.hospitalCode) {
    return NextResponse.json({ error: '병원이 매핑되지 않은 설치계획에는 파일을 첨부할 수 없습니다.' }, { status: 400 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const fileCategory = formData.get('fileCategory') as string | null

  if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
  if (!fileCategory || !VALID_CATEGORIES.includes(fileCategory)) {
    return NextResponse.json({ error: `fileCategory는 ${VALID_CATEGORIES.join(' | ')} 중 하나여야 합니다.` }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const timestamp = Date.now()
  const planCode = installPlan.planCode ?? `id-${id}`
  const s3Key = `hospital/${installPlan.hospitalCode}/install-plans/${planCode}/${timestamp}_${file.name}`

  await uploadToS3(buffer, s3Key, file.type || 'application/octet-stream')

  const saved = await prisma.installPlanFile.create({
    data: {
      installPlanId: id,
      fileCategory,
      fileName: file.name,
      s3Key,
    },
  })

  return NextResponse.json({ file: saved }, { status: 201 })
}
