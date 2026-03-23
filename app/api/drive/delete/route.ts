import { NextRequest, NextResponse } from 'next/server'
import { deleteDriveFile } from '@/lib/googleDrive'
import { getAuthUser } from '@/lib/auth'

export async function DELETE(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const fileId = searchParams.get('fileId')

  if (!fileId) {
    return NextResponse.json({ error: 'fileId가 필요합니다.' }, { status: 400 })
  }

  try {
    await deleteDriveFile(fileId)
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
