import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import {
  getIssueNoteRootSetting,
  PROJECT_ISSUE_REF_TYPE,
} from '@/lib/wiki/projectIssueNote'

export async function GET(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pages = await prisma.wikiPage.findMany({
    where: { isTemplate: false, deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      parentId: true,
      title: true,
      sortOrder: true,
      icon: true,
      isPublished: true,
      updatedAt: true,
    },
  })

  // 프로젝트 이슈노트 보호 정보 — 사이드바가 이동·추가 컨트롤을 숨기는 데 사용
  const [issueRootId, issueRefs] = await Promise.all([
    getIssueNoteRootSetting(),
    prisma.wikiPageReference.findMany({
      where: { refType: PROJECT_ISSUE_REF_TYPE },
      select: { pageId: true },
    }),
  ])

  return NextResponse.json({
    pages,
    projectIssueRootId: issueRootId,
    projectIssuePageIds: issueRefs.map((r) => r.pageId),
  })
}
