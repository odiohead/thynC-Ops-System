import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import {
  PROJECT_ISSUE_REF_TYPE,
  ISSUE_PAGE_ICON,
  ensureIssueNoteRoot,
} from '@/lib/wiki/projectIssueNote'

/**
 * 프로젝트 이슈노트 페이지 조회/생성
 * - GET  ?projectCode= : 해당 프로젝트의 이슈노트 페이지(본문 포함) 또는 null
 * - POST { projectCode }: 이슈노트 페이지 생성 (USER 이상, 프로젝트당 1개 — 이미 있으면 기존 id 반환)
 */

export async function GET(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const projectCode = new URL(request.url).searchParams.get('projectCode')
  if (!projectCode) {
    return NextResponse.json({ error: 'projectCode is required' }, { status: 400 })
  }

  const ref = await prisma.wikiPageReference.findFirst({
    where: {
      refType: PROJECT_ISSUE_REF_TYPE,
      refCode: projectCode,
      page: { deletedAt: null },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      page: {
        select: {
          id: true,
          title: true,
          contentJson: true,
          updatedAt: true,
          collabEnabled: true,
          lastEditor: { select: { name: true } },
        },
      },
    },
  })

  return NextResponse.json({ page: ref?.page ?? null })
}

export async function POST(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (authUser.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const { projectCode } = body as { projectCode?: string }
  if (!projectCode) {
    return NextResponse.json({ error: 'projectCode is required' }, { status: 400 })
  }

  const project = await prisma.project.findUnique({
    where: { projectCode },
    select: { projectCode: true, projectName: true },
  })
  if (!project) {
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다.' }, { status: 404 })
  }

  // 이미 있으면 기존 페이지 반환 (프로젝트당 1개 보장 — 멱등)
  const existing = await prisma.wikiPageReference.findFirst({
    where: {
      refType: PROJECT_ISSUE_REF_TYPE,
      refCode: projectCode,
      page: { deletedAt: null },
    },
    select: { pageId: true },
  })
  if (existing) {
    return NextResponse.json({ id: existing.pageId, existed: true })
  }

  const rootId = await ensureIssueNoteRoot(authUser.userId)

  const created = await prisma.$transaction(async (tx) => {
    // 동시 클릭 race 최소화 — 트랜잭션 안에서 한 번 더 확인
    const dup = await tx.wikiPageReference.findFirst({
      where: {
        refType: PROJECT_ISSUE_REF_TYPE,
        refCode: projectCode,
        page: { deletedAt: null },
      },
      select: { pageId: true },
    })
    if (dup) return { id: dup.pageId, existed: true }

    const page = await tx.wikiPage.create({
      data: {
        title: project.projectName,
        icon: ISSUE_PAGE_ICON,
        parentId: rootId,
        contentJson: [],
        plainText: '',
        authorId: authUser.userId,
        lastEditorId: authUser.userId,
        references: {
          create: {
            refType: PROJECT_ISSUE_REF_TYPE,
            refCode: projectCode,
            createdById: authUser.userId,
          },
        },
      },
      select: { id: true, title: true },
    })
    return { id: page.id, existed: false, title: page.title }
  })

  if (!created.existed) {
    await logAudit({
      req: request,
      actor: auditActorFromJWT(authUser),
      action: 'CREATE',
      resource: 'wiki_page',
      resourceId: created.id,
      resourceLabel: `${project.projectName} (프로젝트 이슈노트)`,
      after: { projectCode, parentId: rootId },
    })
  }

  return NextResponse.json({ id: created.id, existed: created.existed }, { status: created.existed ? 200 : 201 })
}
