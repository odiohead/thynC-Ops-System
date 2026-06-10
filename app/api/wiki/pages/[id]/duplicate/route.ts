import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { Prisma } from '@prisma/client'

type Ctx = { params: { id: string } }

/**
 * 페이지 복제 — POST { includeChildren?: boolean }
 *
 * 복사 대상: 본문(contentJson/plainText), 발행 상태, 태그, 관련 항목(참조)
 * 복사 제외: 댓글, 버전 히스토리, 즐겨찾기, 열람 로그, 첨부 파일 메타
 *   (본문 내 이미지 URL은 원본 페이지의 첨부를 그대로 가리킴 — S3 복사 안 함)
 *
 * 사본은 원본과 같은 부모의 최하단에 배치, 최상위 사본 제목에만 " (사본)" suffix.
 * 작성자/최근 수정자는 복제를 실행한 사용자.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const includeChildren = Boolean((body as { includeChildren?: boolean }).includeChildren)

  const source = await prisma.wikiPage.findUnique({
    where: { id: params.id },
    select: { id: true, parentId: true, title: true },
  })
  if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const last = await prisma.wikiPage.findFirst({
    where: { parentId: source.parentId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })

  let copiedCount = 0

  async function copyPage(
    srcId: string,
    newParentId: string | null,
    titleSuffix: string,
    sortOrder: number,
  ): Promise<string> {
    const src = await prisma.wikiPage.findUniqueOrThrow({
      where: { id: srcId },
      select: {
        title: true,
        contentJson: true,
        plainText: true,
        isPublished: true,
        tags: { select: { tagId: true } },
        references: { select: { refType: true, refCode: true } },
      },
    })

    const created = await prisma.wikiPage.create({
      data: {
        title: src.title + titleSuffix,
        parentId: newParentId,
        contentJson: src.contentJson as Prisma.InputJsonValue,
        plainText: src.plainText,
        isPublished: src.isPublished,
        sortOrder,
        authorId: authUser!.userId,
        lastEditorId: authUser!.userId,
        tags: {
          create: src.tags.map((t) => ({ tagId: t.tagId })),
        },
        references: {
          create: src.references.map((r) => ({
            refType: r.refType,
            refCode: r.refCode,
            createdById: authUser!.userId,
          })),
        },
      },
      select: { id: true },
    })
    copiedCount++

    if (includeChildren) {
      const children = await prisma.wikiPage.findMany({
        where: { parentId: srcId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, sortOrder: true },
      })
      for (const child of children) {
        await copyPage(child.id, created.id, '', child.sortOrder)
      }
    }

    return created.id
  }

  try {
    const newId = await copyPage(
      source.id,
      source.parentId,
      ' (사본)',
      (last?.sortOrder ?? -1) + 1,
    )

    await logAudit({
      req: request,
      actor: auditActorFromJWT(authUser),
      action: 'CREATE',
      resource: 'wiki_page',
      resourceId: newId,
      resourceLabel: `${source.title} (사본)`,
      after: {
        duplicatedFrom: source.id,
        includeChildren,
        copiedCount,
      },
    })

    return NextResponse.json({ id: newId, copied: copiedCount }, { status: 201 })
  } catch (e) {
    console.error('[wiki duplicate]', e)
    return NextResponse.json({ error: '복제 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
