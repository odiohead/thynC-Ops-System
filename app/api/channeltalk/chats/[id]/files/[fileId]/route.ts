/**
 * 채널톡 상담 첨부파일 열람 (2026-10-27) — 적재된 메시지 file_meta의 key로 채널톡 서명 URL(15분)을 받아 302.
 * 파일은 우리 저장소에 복제하지 않는다(채널톡 권한·삭제를 그대로 따름). ?thumb=1 이면 previewKey(썸네일 webp). 로그인 사용자.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { ChanneltalkClient } from '@/lib/channeltalk/client'

export const dynamic = 'force-dynamic'

interface FileMeta { id?: string; key?: string; previewKey?: string; name?: string; contentType?: string }

export async function GET(request: NextRequest, { params }: { params: { id: string; fileId: string } }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ChanneltalkClient.isConfigured()) return NextResponse.json({ error: '채널톡 API 키 미설정' }, { status: 503 })
  const msgs = await prisma.channeltalkMessage.findMany({ where: { chatId: params.id, hasFiles: true }, select: { fileMeta: true } })
  let file: FileMeta | null = null
  for (const m of msgs) for (const f of (m.fileMeta as FileMeta[] | null) ?? []) if (f.id === params.fileId) file = f
  if (!file?.key) return NextResponse.json({ error: '첨부파일을 찾을 수 없습니다.' }, { status: 404 })
  const thumb = request.nextUrl.searchParams.get('thumb') === '1' && !!file.previewKey
  try {
    const url = await new ChanneltalkClient({ maxCalls: 5 }).fileUrl(params.id, thumb ? file.previewKey! : file.key)
    return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'private, max-age=600' } })
  } catch (e) {
    return NextResponse.json({ error: `파일 URL 발급 실패: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }
}
