import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { deleteFromS3 } from '@/lib/s3'

type Params = { params: { id: string; fileId: string } }

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = parseInt(params.id)
  const fileId = parseInt(params.fileId)
  if (isNaN(id) || isNaN(fileId)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })

  const file = await prisma.etcTaskFile.findFirst({
    where: { id: fileId, etcTaskId: id },
  })
  if (!file) return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 })

  await deleteFromS3(file.s3Key)
  await prisma.etcTaskFile.delete({ where: { id: fileId } })

  return NextResponse.json({ success: true })
}
