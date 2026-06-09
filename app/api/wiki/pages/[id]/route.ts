import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { deleteFromS3 } from '@/lib/s3'
import { extractPlainTextFromBlocks } from '@/lib/wiki/blockText'

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
  const { title, slug, contentJson, isPublished, parentId, sortOrder } = body as {
    title?: string
    slug?: string | null
    contentJson?: unknown
    isPublished?: boolean
    parentId?: string | null
    sortOrder?: number
  }

  const existing = await prisma.wikiPage.findUnique({ where: { id: params.id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (parentId === params.id) {
    return NextResponse.json({ error: 'Cannot set self as parent' }, { status: 400 })
  }

  // 본문 변경 시 plainText 동기화 + 변경 전 버전 스냅샷 저장
  const willChangeContent = contentJson !== undefined
  const updated = await prisma.$transaction(async (tx) => {
    // 본문이 바뀌면 직전 상태를 wiki_versions에 스냅샷
    if (willChangeContent) {
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

  const existing = await prisma.wikiPage.findUnique({ where: { id: params.id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // 자식 페이지 + 첨부 파일 통째로 수집해서 S3 정리 (CASCADE는 DB만 처리)
  const descendantIds = await collectDescendantIds(params.id)
  const allPageIds = [params.id, ...descendantIds]
  const attachments = await prisma.wikiAttachment.findMany({
    where: { pageId: { in: allPageIds } },
    select: { s3Key: true },
  })

  // S3 best-effort — 실패해도 DB 삭제는 진행
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
