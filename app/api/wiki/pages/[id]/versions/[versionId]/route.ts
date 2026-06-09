import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { extractPlainTextFromBlocks } from '@/lib/wiki/blockText'

type Ctx = { params: { id: string; versionId: string } }

export async function GET(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
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
 * 버전 복원 — 현재 본문을 새 스냅샷으로 보존한 뒤, 지정 버전의 title/contentJson을 페이지에 적용.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
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
      data: {
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
    after: { restoredFromVersion: params.versionId },
  })

  return NextResponse.json({ ok: true })
}
