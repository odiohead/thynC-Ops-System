import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/s3'

type Params = { params: { code: string; fileId: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const fileId = parseInt(params.fileId)
  if (isNaN(fileId)) return NextResponse.json({ error: '잘못된 파일 ID입니다.' }, { status: 400 })

  const file = await prisma.projectFile.findUnique({ where: { id: fileId } })
  if (!file) return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 })

  if (!file.s3Key) {
    return NextResponse.json({ error: 'S3에 업로드된 파일이 아닙니다.' }, { status: 404 })
  }

  const url = await getSignedUrl(file.s3Key)
  return NextResponse.json({ url })
}
