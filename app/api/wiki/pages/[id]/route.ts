import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { deleteFromS3 } from '@/lib/s3'
import { extractPlainTextFromBlocks, extractPageLinks } from '@/lib/wiki/blockText'

type Ctx = { params: { id: string } }

function metaSnapshot(p: {
  title: string
  parentId: string | null
  isPublished: boolean
  slug: string | null
}) {
  return { title: p.title, parentId: p.parentId, isPublished: p.isPublished, slug: p.slug }
}

export async function GET(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const page = await prisma.wikiPage.findUnique({
    where: { id: params.id },
    include: {
      author: { select: { id: true, name: true } },
      lastEditor: { select: { id: true, name: true } },
    },
  })

  if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ page })
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const {
    title,
    slug,
    contentJson,
    isPublished,
    parentId,
    sortOrder,
    icon,
    coverUrl,
    coverOffsetY,
    isTemplate,
    baseUpdatedAt,
  } = body as {
    title?: string
    slug?: string | null
    contentJson?: unknown
    isPublished?: boolean
    parentId?: string | null
    sortOrder?: number
    icon?: string | null
    coverUrl?: string | null
    coverOffsetY?: number
    isTemplate?: boolean
    baseUpdatedAt?: string
  }

  const existing = await prisma.wikiPage.findUnique({ where: { id: params.id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (parentId === params.id) {
    return NextResponse.json({ error: 'Cannot set self as parent' }, { status: 400 })
  }

  // 충돌 감지: 클라이언트가 보고 있던 시점(baseUpdatedAt) 이후 다른 곳에서 수정됐으면 409
  // (실시간 협업 대신 lost-update 방지. baseUpdatedAt 없으면 검사 생략 — 내부 즉시저장 등)
  if (baseUpdatedAt) {
    const baseMs = new Date(baseUpdatedAt).getTime()
    if (!Number.isNaN(baseMs) && existing.updatedAt.getTime() > baseMs) {
      return NextResponse.json(
        {
          error: '다른 곳에서 이 페이지가 수정되었습니다. 새로고침 후 다시 시도하세요.',
          conflict: true,
          serverUpdatedAt: existing.updatedAt.toISOString(),
        },
        { status: 409 },
      )
    }
  }

  // 본문 변경 시 plainText 동기화 + 변경 전 버전 스냅샷 저장
  const willChangeContent = contentJson !== undefined
  const updated = await prisma.$transaction(async (tx) => {
    // 본문이 바뀌면 직전 상태를 wiki_versions에 스냅샷.
    // 단, 자동저장으로 스냅샷이 폭증하지 않도록 마지막 스냅샷이 2분 이상 지났을 때만 기록.
    if (willChangeContent) {
      const lastVersion = await tx.wikiVersion.findFirst({
        where: { pageId: params.id },
        orderBy: { savedAt: 'desc' },
        select: { savedAt: true },
      })
      const SNAPSHOT_INTERVAL_MS = 2 * 60 * 1000
      const shouldSnapshot =
        !lastVersion || existing.updatedAt.getTime() - lastVersion.savedAt.getTime() > SNAPSHOT_INTERVAL_MS
      if (shouldSnapshot) {
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
      }
    }
    // 백링크 인덱스 갱신: 본문이 바뀌면 이 페이지의 outgoing 링크를 재계산
    if (willChangeContent) {
      const rawTargets = extractPageLinks(contentJson).filter((t) => t !== params.id)
      await tx.wikiPageLink.deleteMany({ where: { sourcePageId: params.id } })
      if (rawTargets.length > 0) {
        // 삭제된 페이지를 가리키는 링크는 FK 위반이 되므로 실존 페이지만 기록
        const existing = await tx.wikiPage.findMany({
          where: { id: { in: rawTargets } },
          select: { id: true },
        })
        if (existing.length > 0) {
          await tx.wikiPageLink.createMany({
            data: existing.map((e) => ({ sourcePageId: params.id, targetPageId: e.id })),
            skipDuplicates: true,
          })
        }
      }
    }
    return tx.wikiPage.update({
      where: { id: params.id },
      data: {
        ...(title !== undefined && { title }),
        ...(slug !== undefined && { slug }),
        ...(contentJson !== undefined && {
          contentJson: contentJson as Prisma.InputJsonValue,
          plainText: extractPlainTextFromBlocks(contentJson),
        }),
        ...(isPublished !== undefined && { isPublished }),
        ...(parentId !== undefined && { parentId }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(icon !== undefined && { icon }),
        ...(coverUrl !== undefined && { coverUrl }),
        ...(coverOffsetY !== undefined && { coverOffsetY }),
        ...(isTemplate !== undefined && { isTemplate }),
        lastEditorId: authUser.userId,
      },
      select: {
        id: true,
        updatedAt: true,
        title: true,
        parentId: true,
        isPublished: true,
        slug: true,
      },
    })
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(authUser),
    action: 'UPDATE',
    resource: 'wiki_page',
    resourceId: updated.id,
    resourceLabel: updated.title,
    before: metaSnapshot(existing),
    after: { ...metaSnapshot(updated), contentChanged: contentJson !== undefined },
  })

  return NextResponse.json({ id: updated.id, updatedAt: updated.updatedAt })
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const permanent = new URL(request.url).searchParams.get('permanent') === '1'

  const existing = await prisma.wikiPage.findUnique({ where: { id: params.id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const descendantIds = await collectDescendantIds(params.id)
  const allPageIds = [params.id, ...descendantIds]

  if (!permanent) {
    // 휴지통으로 이동 (soft delete) — 페이지 + 하위 전체
    const now = new Date()
    await prisma.wikiPage.updateMany({
      where: { id: { in: allPageIds }, deletedAt: null },
      data: { deletedAt: now },
    })
    await logAudit({
      req: request,
      actor: auditActorFromJWT(authUser),
      action: 'DELETE',
      resource: 'wiki_page',
      resourceId: existing.id,
      resourceLabel: existing.title,
      before: metaSnapshot(existing),
      after: { trashed: true },
    })
    return new NextResponse(null, { status: 204 })
  }

  // 영구 삭제 — 첨부 S3 정리 후 hard delete (CASCADE)
  const attachments = await prisma.wikiAttachment.findMany({
    where: { pageId: { in: allPageIds } },
    select: { s3Key: true },
  })
  for (const a of attachments) {
    try {
      await deleteFromS3(a.s3Key)
    } catch (e) {
      console.error('[wiki] S3 정리 실패:', a.s3Key, e)
    }
  }

  await prisma.wikiPage.delete({ where: { id: params.id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(authUser),
    action: 'DELETE',
    resource: 'wiki_page',
    resourceId: existing.id,
    resourceLabel: existing.title,
    before: metaSnapshot(existing),
    after: { permanent: true },
  })

  return new NextResponse(null, { status: 204 })
}

async function collectDescendantIds(rootId: string): Promise<string[]> {
  const all = await prisma.wikiPage.findMany({ select: { id: true, parentId: true } })
  const childrenOf = new Map<string, string[]>()
  for (const p of all) {
    if (p.parentId) {
      const arr = childrenOf.get(p.parentId) ?? []
      arr.push(p.id)
      childrenOf.set(p.parentId, arr)
    }
  }
  const descendants: string[] = []
  const queue = [rootId]
  while (queue.length > 0) {
    const cur = queue.shift()!
    const kids = childrenOf.get(cur) ?? []
    for (const k of kids) {
      descendants.push(k)
      queue.push(k)
    }
  }
  return descendants
}
