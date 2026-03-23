import { NextRequest, NextResponse } from 'next/server'
import { uploadBufferToDrive } from '@/lib/googleDrive'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const hospitalCode = formData.get('hospitalCode') as string | null

    if (!file || !hospitalCode) {
      return NextResponse.json({ error: 'file과 hospitalCode는 필수입니다.' }, { status: 400 })
    }

    const meta = await prisma.hospitalMeta.findUnique({ where: { hospitalCode } })
    if (!meta?.driveProjectFolderId) {
      return NextResponse.json({ error: '해당 병원의 Drive 폴더가 설정되지 않았습니다.' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await uploadBufferToDrive({
      fileName: file.name,
      buffer,
      mimeType: file.type || 'application/octet-stream',
      folderId: meta.driveProjectFolderId,
    })

    return NextResponse.json({ fileId: result.id, fileName: result.name, webViewLink: result.webViewLink }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
