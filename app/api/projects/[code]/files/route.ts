import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

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

  const { fileCategory, fileName, driveFileId, driveUrl } = await request.json()

  if (!fileCategory || !VALID_CATEGORIES.includes(fileCategory)) {
    return NextResponse.json(
      { error: `fileCategory는 ${VALID_CATEGORIES.join(' | ')} 중 하나여야 합니다.` },
      { status: 400 }
    )
  }
  if (!fileName?.trim()) {
    return NextResponse.json({ error: '파일명은 필수입니다.' }, { status: 400 })
  }

  const file = await prisma.projectFile.create({
    data: {
      projectId: project.id,
      fileCategory,
      fileName: fileName.trim(),
      driveFileId: driveFileId ?? '',
      driveUrl: driveUrl ?? '',
    },
  })

  return NextResponse.json({ file }, { status: 201 })
}
