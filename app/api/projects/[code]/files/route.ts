import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { uploadBufferToDrive } from '@/lib/googleDrive'

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

  if (!project.driveFolderId) {
    return NextResponse.json(
      { error: '프로젝트 Drive 폴더가 준비되지 않았습니다. 페이지를 새로고침 후 다시 시도해 주세요.' },
      { status: 400 }
    )
  }

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

  const driveFile = await uploadBufferToDrive({
    fileName: file.name,
    buffer,
    mimeType: file.type || 'application/octet-stream',
    folderId: project.driveFolderId,
  })

  const projectFile = await prisma.projectFile.create({
    data: {
      projectId: project.id,
      fileCategory,
      fileName: file.name,
      driveFileId: driveFile.id,
      driveUrl: driveFile.webViewLink,
    },
  })

  return NextResponse.json({ file: projectFile }, { status: 201 })
}
