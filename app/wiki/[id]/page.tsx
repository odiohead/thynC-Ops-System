import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import type { PartialBlock } from '@blocknote/core'
import { getIssuePageProtection } from '@/lib/wiki/projectIssueNote'
import WikiPageView from './WikiPageView'
import WikiHtmlPageView from './WikiHtmlPageView'

export const dynamic = 'force-dynamic'

async function getParentChain(startId: string): Promise<{ id: string; title: string }[]> {
  const chain: { id: string; title: string }[] = []
  const visited = new Set<string>()
  let currentId: string | null = startId
  while (currentId) {
    if (visited.has(currentId)) break
    visited.add(currentId)
    const p: { id: string; title: string; parentId: string | null } | null =
      await prisma.wikiPage.findUnique({
        where: { id: currentId },
        select: { id: true, title: true, parentId: true },
      })
    if (!p) break
    chain.unshift({ id: p.id, title: p.title })
    currentId = p.parentId
  }
  return chain
}

export default async function WikiDetailPage({ params }: { params: { id: string } }) {
  const page = await prisma.wikiPage.findUnique({
    where: { id: params.id },
    include: {
      author: { select: { id: true, name: true } },
      lastEditor: { select: { id: true, name: true } },
    },
  })

  if (!page || page.deletedAt) notFound()

  const initialContent = Array.isArray(page.contentJson)
    ? (page.contentJson as unknown as PartialBlock[])
    : []

  const parentChain = await getParentChain(page.id)
  const breadcrumb = parentChain.slice(0, -1)

  // HTML 문서 페이지 — BlockNote 대신 전용 뷰어(sandbox iframe)로 렌더
  if (page.pageType === 'html') {
    const token = cookies().get('auth-token')?.value
    const jwt = token ? await verifyToken(token) : null
    let favorited = false
    if (jwt?.userId) {
      const fav = await prisma.wikiFavorite.findUnique({
        where: { userId_pageId: { userId: jwt.userId, pageId: page.id } },
        select: { createdAt: true },
      })
      favorited = !!fav
      prisma.wikiViewLog
        .create({ data: { userId: jwt.userId, pageId: page.id } })
        .catch(() => {})
    }
    return (
      <WikiHtmlPageView
        id={page.id}
        title={page.title}
        breadcrumb={breadcrumb}
        contentHtml={page.contentHtml ?? ''}
        author={page.author.name}
        lastEditor={page.lastEditor?.name ?? page.author.name}
        updatedAt={page.updatedAt.toISOString()}
        favorited={favorited}
        currentUserRole={jwt?.role ?? 'VIEWER'}
      />
    )
  }

  // 프로젝트 이슈노트 보호 등급 — 루트 카테고리/이슈노트 페이지는 이동·삭제 등 메뉴 제한
  const issueProtection = await getIssuePageProtection(page.id)

  // 참조(병원/프로젝트) + 라벨 enrich
  const rawRefs = await prisma.wikiPageReference.findMany({
    where: { pageId: page.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, refType: true, refCode: true },
  })
  const hospitalCodes = rawRefs.filter((r) => r.refType === 'hospital').map((r) => r.refCode)
  const projectCodes = rawRefs.filter((r) => r.refType === 'project').map((r) => r.refCode)
  const [hospitals, projects] = await Promise.all([
    hospitalCodes.length
      ? prisma.hospital.findMany({
          where: { hospitalCode: { in: hospitalCodes } },
          select: { hospitalCode: true, hospitalName: true, hiraHospitalName: true },
        })
      : Promise.resolve([]),
    projectCodes.length
      ? prisma.project.findMany({
          where: { projectCode: { in: projectCodes } },
          select: { projectCode: true, projectName: true },
        })
      : Promise.resolve([]),
  ])
  const hMap = new Map(hospitals.map((h) => [h.hospitalCode, h]))
  const pMap = new Map(projects.map((p) => [p.projectCode, p]))
  const references = rawRefs.map((r) => ({
    id: r.id,
    refType: r.refType as 'hospital' | 'project',
    refCode: r.refCode,
    label:
      r.refType === 'hospital'
        ? hMap.get(r.refCode)?.hospitalName ?? hMap.get(r.refCode)?.hiraHospitalName ?? r.refCode
        : pMap.get(r.refCode)?.projectName ?? r.refCode,
  }))

  const tagRels = await prisma.wikiPageTag.findMany({
    where: { pageId: page.id },
    orderBy: { addedAt: 'asc' },
    include: { tag: true },
  })
  const tags = tagRels.map((r) => ({ id: r.tag.id, name: r.tag.name, color: r.tag.color }))

  // 백링크 — 이 페이지를 링크한 페이지들
  const backlinkRels = await prisma.wikiPageLink.findMany({
    where: { targetPageId: page.id, source: { deletedAt: null } },
    select: { source: { select: { id: true, title: true, icon: true } } },
  })
  const backlinks = backlinkRels.map((r) => ({
    id: r.source.id,
    title: r.source.title,
    icon: r.source.icon,
  }))

  // 즐겨찾기 + 열람 로그 (현재 사용자)
  const token = cookies().get('auth-token')?.value
  const jwt = token ? await verifyToken(token) : null
  let favorited = false
  if (jwt?.userId) {
    const fav = await prisma.wikiFavorite.findUnique({
      where: { userId_pageId: { userId: jwt.userId, pageId: page.id } },
      select: { createdAt: true },
    })
    favorited = !!fav
    // 열람 기록 — 비차단
    prisma.wikiViewLog
      .create({ data: { userId: jwt.userId, pageId: page.id } })
      .catch(() => {})
  }

  return (
    <WikiPageView
      id={page.id}
      title={page.title}
      parentId={page.parentId}
      breadcrumb={breadcrumb}
      initialContent={initialContent}
      icon={page.icon}
      coverUrl={page.coverUrl}
      coverOffsetY={page.coverOffsetY}
      backlinks={backlinks}
      author={page.author.name}
      lastEditor={page.lastEditor?.name ?? page.author.name}
      updatedAt={page.updatedAt.toISOString()}
      references={references}
      tags={tags}
      issueProtection={issueProtection}
      favorited={favorited}
      currentUserId={jwt?.userId ?? ''}
      currentUserRole={jwt?.role ?? 'VIEWER'}
      currentUserName={jwt?.name ?? ''}
    />
  )
}
