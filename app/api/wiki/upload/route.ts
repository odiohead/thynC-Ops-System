import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { uploadToS3 } from '@/lib/s3'

const MAX_SIZE = 50 * 1024 * 1024 // 50MB (Phase 0 결정)

export async function POST(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const pageId = searchParams.get('pageId')
  if (!pageId) return NextResponse.json({ error: 'pageId는 필수입니다.' }, { status: 400 })

  const page = await prisma.wikiPage.findUnique({ where: { id: pageId }, select: { id: true } })
  if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 })

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: `파일이 너무 큽니다. 최대 ${MAX_SIZE / 1024 / 1024}MB까지 업로드 가능합니다.` },
        { status: 413 },
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const timestamp = Date.now()
    // Phase 0 결정 S3 키 패턴: wiki/{pageId}/{timestamp}_{fileName}
    const safeName = file.name.replace(/[^\w.\-]+/g, '_')
    const s3Key = `wiki/${pageId}/${timestamp}_${safeName}`
    await uploadToS3(buffer, s3Key, file.type || 'application/octet-stream')

    const attachment = await prisma.wikiAttachment.create({
      data: {
        pageId,
        fileName: file.name,
        s3Key,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        uploaderId: authUser.userId,
      },
      select: { id: true, fileName: true, mimeType: true, size: true },
    })

    return NextResponse.json(
      {
        id: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        // BlockNote가 본문에 박을 영구 URL (조회 시 presigned URL로 redirect)
        url: `/api/wiki/files/${attachment.id}`,
      },
      { status: 201 },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
