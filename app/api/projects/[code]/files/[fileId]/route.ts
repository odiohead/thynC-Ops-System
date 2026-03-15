import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: { code: string; fileId: string } }

export async function DELETE(_req: NextRequest, { params }: Params) {
  const fileId = parseInt(params.fileId)
  if (isNaN(fileId)) return NextResponse.json({ error: '잘못된 파일 ID입니다.' }, { status: 400 })

  const project = await prisma.project.findUnique({ where: { projectCode: params.code } })
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })

  const file = await prisma.projectFile.findFirst({
    where: { id: fileId, projectId: project.id },
  })
  if (!file) return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 })

  await prisma.projectFile.delete({ where: { id: fileId } })

  return NextResponse.json({ success: true })
}
