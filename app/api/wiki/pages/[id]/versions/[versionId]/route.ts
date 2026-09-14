import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getWikiAuthUser } from '@/lib/wiki/access'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { extractPlainTextFromBlocks } from '@/lib/wiki/blockText'

type Ctx = { params: { id: string; versionId: string } }

export async function GET(request: NextRequest, { params }: Ctx) {
  const authUser = await getWikiAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const version = await prisma.wikiVersion.findUnique({
    where: { id: params.versionId },
    include: { savedBy: { select: { id: true, name: true } } },
  })
  if (!version || version.pageId !== params.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({ version })
}

/**
 * 버전 복원 — 현재 본문을 새 스냅샷으로 보존한 뒤 지정 버전을 적용.
 *
 * 협업 페이지(wiki_page_ydoc 보유 — 2026-06-30 이후 사실상 전부)에서는 본문의 진실의 원천이 Y.Doc이라
 * 서버가 content_json을 고쳐도 편집기에 반영되지 않고 다음 store()가 되돌린다(2026-09-12 검토 A-4).
 * 그래서 협업 페이지는 서버가 **스냅샷 보존 + 제목**만 처리하고 `mode: 'client'`와 복원할 블록을 돌려준다.
 * 클라이언트(VersionHistoryModal → WikiPageView)가 라이브 협업 세션에서 `editor.replaceBlocks`로 적용하면
 * 일반 편집과 같은 경로로 Yjs에 전파되고 store()가 스냅샷·최근 수정자를 갱신한다.
 * Y.Doc이 없는 페이지(협업 전환 후 한 번도 열리지 않음)는 기존대로 서버가 content_json을 직접 적용한다.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const authUser = await getWikiAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const version = await prisma.wikiVersion.findUnique({
    where: { id: params.versionId },
    select: {
      pageId: true,
      title: true,
      contentJson: true,
    },
  })
  if (!version || version.pageId !== params.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const hasYdoc = !!(await prisma.wikiPageYdoc.findUnique({
    where: { pageId: params.id },
    select: { pageId: true },
  }))

  await prisma.$transaction(async (tx) => {
    const current = await tx.wikiPage.findUnique({
      where: { id: params.id },
      select: { title: true, contentJson: true },
    })
    if (current) {
      await tx.wikiVersion.create({
        data: {
          pageId: params.id,
          title: current.title,
          contentJson: current.contentJson as Prisma.InputJsonValue,
          savedById: authUser.userId,
        },
      })
    }
    await tx.wikiPage.update({
      where: { id: params.id },
      data: hasYdoc
        ? { title: version.title, lastEditorId: authUser.userId }
        : {
            title: version.title,
            contentJson: version.contentJson as Prisma.InputJsonValue,
            plainText: extractPlainTextFromBlocks(version.contentJson),
            lastEditorId: authUser.userId,
          },
    })
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(authUser),
    action: 'UPDATE',
    resource: 'wiki_page',
    resourceId: params.id,
    resourceLabel: `${version.title} (버전 복원)`,
    after: { restoredFromVersion: params.versionId, mode: hasYdoc ? 'client' : 'server' },
  })

  return NextResponse.json({
    ok: true,
    mode: hasYdoc ? 'client' : 'server',
    title: version.title,
    blocks: hasYdoc ? version.contentJson : undefined,
  })
}
