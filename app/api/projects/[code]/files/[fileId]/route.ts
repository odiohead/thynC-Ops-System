import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type Params = { params: { code: string; fileId: string } }

export async function DELETE(_req: NextRequest, { params }: Params) {
  const cookieStore = cookies()
  const token = cookieStore.get('auth-token')?.value
  const user = token ? await verifyToken(token) : null
  if (!user || user.role !== 'ADMIN') {
    return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
  }

  const fileId = parseInt(params.fileId)
  if (isNaN(fileId)) return NextResponse.json({ error: '잘못된 파일 ID입니다.' }, { status: 400 })

  const file = await prisma.projectFile.findUnique({ where: { id: fileId } })
  if (!file) return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 })

  await prisma.projectFile.delete({ where: { id: fileId } })
  return NextResponse.json({ success: true })
}
