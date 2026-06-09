import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { getSignedUrl, deleteFromS3 } from '@/lib/s3'

type Ctx = { params: { id: string } }

/**
 * 파일 조회 — 인증된 사용자에게 presigned URL로 307 redirect.
 * BlockNote 본문에는 이 영구 URL이 박혀있고, 렌더 시점마다 fresh presigned URL을 받음.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const attachment = await prisma.wikiAttachment.findUnique({
    where: { id: params.id },
    select: { s3Key: true, fileName: true },
  })
  if (!attachment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    // 24시간 유효 — 페이지 렌더 후 사용자가 일정 시간 후 클릭해도 동작
    const url = await getSignedUrl(attachment.s3Key, 60 * 60 * 24)
    return NextResponse.redirect(url, 307)
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const attachment = await prisma.wikiAttachment.findUnique({ where: { id: params.id } })
  if (!attachment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // S3 삭제 best-effort. 실패해도 DB 행은 지움
  try {
    await deleteFromS3(attachment.s3Key)
  } catch (e) {
    console.error('[wiki] S3 삭제 실패 — DB 정리는 계속 진행', e)
  }

  await prisma.wikiAttachment.delete({ where: { id: params.id } })
  return new NextResponse(null, { status: 204 })
}
