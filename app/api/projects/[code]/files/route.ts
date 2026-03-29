import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { uploadToS3 } from '@/lib/s3'

type Params = { params: { code: string } }

const VALID_CATEGORIES = [
  'INSTALL_PLAN',
  'CONTRACTOR_CONFIRM',
  'INSTALL_CONFIRM',
  'INSPECTION_CHECKLIST',
]

export async function GET(_req: NextRequest, { params }: Params) {
  const project = await prisma.project.findUnique({ where: { projectCode: params.code } })
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })

  const files = await prisma.projectFile.findMany({
    where: { projectId: project.id },
    orderBy: { uploadedAt: 'asc' },
  })

  return NextResponse.json({ files })
}

export async function POST(request: NextRequest, { params }: Params) {
  const project = await prisma.project.findUnique({ where: { projectCode: params.code } })
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const fileCategory = formData.get('fileCategory') as string | null

  if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
  if (!fileCategory || !VALID_CATEGORIES.includes(fileCategory)) {
    return NextResponse.json(
      { error: `fileCategory는 ${VALID_CATEGORIES.join(' | ')} 중 하나여야 합니다.` },
      { status: 400 }
    )
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const timestamp = Date.now()
  const s3Key = `projects/${params.code}/${timestamp}_${file.name}`

  await uploadToS3(buffer, s3Key, file.type || 'application/octet-stream')

  const projectFile = await prisma.projectFile.create({
    data: {
      projectId: project.id,
      fileCategory,
      fileName: file.name,
      driveFileId: '',
      driveUrl: '',
      s3Key,
    },
  })

  return NextResponse.json({ file: projectFile }, { status: 201 })
}
