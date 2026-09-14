import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getWikiAuthUser } from '@/lib/wiki/access'
import { getSignedUrl } from '@/lib/s3'

type Ctx = { params: { id: string } }

/**
 * 파일 조회 — 인증된 사용자에게 presigned URL로 307 redirect.
 * BlockNote 본문에는 이 영구 URL이 박혀있고, 렌더 시점마다 fresh presigned URL을 받음.
 * 저장 파일명은 원래 이름(한글 포함)으로 — S3 키는 ASCII로 정규화돼 있어 Content-Disposition 없이는
 * `1781222127463_01_SEERS_2026____.docx` 꼴로 내려온다 (2026-09-12 A-11①).
 *
 * 첨부 DELETE 엔드포인트는 2026-09-12에 제거 — 클라이언트 호출처가 없는 죽은 API였고 USER 전원에게
 * 즉시 S3 삭제가 열려 있었다. 첨부 정리는 페이지 영구삭제(ADMIN/wiki.admin) 경로에서만.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  const authUser = await getWikiAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const attachment = await prisma.wikiAttachment.findUnique({
    where: { id: params.id },
    select: { s3Key: true, fileName: true },
  })
  if (!attachment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    // 24시간 유효 — 페이지 렌더 후 사용자가 일정 시간 후 클릭해도 동작
    const url = await getSignedUrl(attachment.s3Key, 60 * 60 * 24, {
      downloadName: attachment.fileName,
      inline: true,
    })
    return NextResponse.redirect(url, 307)
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
