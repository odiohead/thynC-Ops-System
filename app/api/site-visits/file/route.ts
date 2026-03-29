import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { deleteFromS3 } from '@/lib/s3'

export async function DELETE(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { s3Key } = body

  if (!s3Key) {
    return NextResponse.json({ error: 's3Key는 필수입니다.' }, { status: 400 })
  }

  await deleteFromS3(s3Key)
  return NextResponse.json({ success: true })
}
