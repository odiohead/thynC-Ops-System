import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { uploadToS3 } from '@/lib/s3'

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const hospitalCode = searchParams.get('hospitalCode')

  if (!hospitalCode) {
    return NextResponse.json({ error: 'hospitalCode는 필수입니다.' }, { status: 400 })
  }

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const s3Key = `site-visits/${hospitalCode}/${file.name}`

    await uploadToS3(buffer, s3Key, file.type || 'application/octet-stream')

    return NextResponse.json({ s3Key, fileName: file.name }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
