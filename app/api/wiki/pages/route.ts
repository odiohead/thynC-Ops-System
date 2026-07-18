import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { extractPlainTextFromBlocks } from '@/lib/wiki/blockText'
import { sanitizeHtmlDocument, extractPlainTextFromHtml, HTML_DOC_MAX_BYTES } from '@/lib/wiki/htmlText'
import { getIssueNoteRootSetting } from '@/lib/wiki/projectIssueNote'
import { getHospitalNoteRootSetting } from '@/lib/wiki/hospitalNote'

export async function GET(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const parentId = searchParams.get('parentId')
  const refType = searchParams.get('refType')
  const refCode = searchParams.get('refCode')
  const templates = searchParams.get('templates')

  // 템플릿 목록 (신규 작성 화면 갤러리용)
  if (templates) {
    const tpls = await prisma.wikiPage.findMany({
      where: { isTemplate: true, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, icon: true },
    })
    return NextResponse.json({ templates: tpls })
  }

  // 역참조 조회: 특정 병원/프로젝트를 참조하는 위키 페이지 목록
  if (refType && refCode) {
    const refs = await prisma.wikiPageReference.findMany({
      where: { refType, refCode, page: { deletedAt: null } },
      orderBy: { createdAt: 'desc' },
      select: {
        page: {
          select: {
            id: true,
            title: true,
            updatedAt: true,
            isPublished: true,
            author: { select: { name: true } },
            lastEditor: { select: { name: true } },
          },
        },
      },
    })
    return NextResponse.json({ pages: refs.map((r) => r.page) })
  }

  const where =
    parentId === 'null' || parentId === ''
      ? { parentId: null, isTemplate: false, deletedAt: null }
      : parentId
        ? { parentId, isTemplate: false, deletedAt: null }
        : { isTemplate: false, deletedAt: null }

  const pages = await prisma.wikiPage.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
    select: {
      id: true,
      parentId: true,
      title: true,
      slug: true,
      isPublished: true,
      sortOrder: true,
      authorId: true,
      lastEditorId: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, name: true } },
      lastEditor: { select: { id: true, name: true } },
      _count: { select: { children: true, attachments: true } },
    },
  })

  return NextResponse.json({ pages })
}

export async function POST(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { title, parentId, slug, contentJson, pageType, contentHtml } = body as {
    title?: string
    parentId?: string | null
    slug?: string | null
    contentJson?: unknown
    pageType?: string
    contentHtml?: string
  }

  if (!title || typeof title !== 'string') {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  // HTML 문서 페이지 검증
  const isHtmlPage = pageType === 'html'
  if (pageType !== undefined && pageType !== 'block' && pageType !== 'html') {
    return NextResponse.json({ error: 'pageType은 block 또는 html이어야 합니다.' }, { status: 400 })
  }
  if (isHtmlPage) {
    if (!contentHtml || typeof contentHtml !== 'string' || !contentHtml.trim()) {
      return NextResponse.json({ error: 'HTML 문서 내용(contentHtml)이 필요합니다.' }, { status: 400 })
    }
    if (Buffer.byteLength(contentHtml, 'utf8') > HTML_DOC_MAX_BYTES) {
      return NextResponse.json({ error: 'HTML 문서는 최대 2MB까지 업로드할 수 있습니다.' }, { status: 400 })
    }
  }

  // 시스템 카테고리(프로젝트 이슈노트/병원 노트) 직속 페이지는 전용 API에서만 생성 가능
  if (parentId) {
    const issueRootId = await getIssueNoteRootSetting()
    if (issueRootId && parentId === issueRootId) {
      return NextResponse.json(
        { error: '프로젝트 이슈노트 카테고리에는 프로젝트 상세에서만 페이지를 추가할 수 있습니다.' },
        { status: 400 },
      )
    }
    const hospitalNoteRootId = await getHospitalNoteRootSetting()
    if (hospitalNoteRootId && parentId === hospitalNoteRootId) {
      return NextResponse.json(
        { error: '병원 노트 카테고리에는 병원 상세·상담 정리에서만 페이지를 추가할 수 있습니다.' },
        { status: 400 },
      )
    }
  }

  const contentArr = (contentJson ?? []) as unknown
  const sanitizedHtml = isHtmlPage ? sanitizeHtmlDocument(contentHtml as string) : null
  const created = await prisma.wikiPage.create({
    data: {
      title,
      parentId: parentId ?? null,
      slug: slug ?? null,
      contentJson: contentArr as Prisma.InputJsonValue,
      pageType: isHtmlPage ? 'html' : 'block',
      contentHtml: sanitizedHtml,
      plainText: isHtmlPage
        ? extractPlainTextFromHtml(sanitizedHtml as string)
        : extractPlainTextFromBlocks(contentArr),
      authorId: authUser.userId,
      lastEditorId: authUser.userId,
    },
    select: { id: true, title: true, parentId: true, isPublished: true },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(authUser),
    action: 'CREATE',
    resource: 'wiki_page',
    resourceId: created.id,
    resourceLabel: created.title,
    after: {
      title: created.title,
      parentId: created.parentId,
      isPublished: created.isPublished,
    },
  })

  return NextResponse.json({ id: created.id }, { status: 201 })
}
