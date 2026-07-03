import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { uploadToS3 } from '@/lib/s3'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getAuthUser(_req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const files = await prisma.etcTaskFile.findMany({
    where: { etcTaskId: id },
    orderBy: { uploadedAt: 'asc' },
  })

  return NextResponse.json({ files })
}

export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const etcTask = await prisma.etcTask.findUnique({ where: { id } })
  if (!etcTask) return NextResponse.json({ error: '기타업무를 찾을 수 없습니다.' }, { status: 404 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const fileCategory = formData.get('fileCategory') as string | null

  if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
  if (!fileCategory) return NextResponse.json({ error: 'fileCategory는 필수입니다.' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  const timestamp = Date.now()
  const s3Key = `etc-tasks/${id}/${timestamp}_${file.name}`

  await uploadToS3(buffer, s3Key, file.type || 'application/octet-stream')

  const saved = await prisma.etcTaskFile.create({
    data: {
      etcTaskId: id,
      fileCategory,
      fileName: file.name,
      s3Key,
    },
  })

  return NextResponse.json({ file: saved }, { status: 201 })
}
