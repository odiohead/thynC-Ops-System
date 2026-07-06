import Link from 'next/link'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import EmptyState from './components/ui/EmptyState'

export const dynamic = 'force-dynamic'

type Card = {
  id: string
  title: string
  icon: string | null
  updatedAt: Date
  by: string | null
}

function PageRow({ p }: { p: Card }) {
  return (
    <li className="border-b border-[var(--wiki-border)] last:border-0">
      <Link
        href={`/wiki/${p.id}`}
        className="flex items-center gap-2.5 px-4 py-2.5 transition hover:bg-[var(--wiki-hover)]"
      >
        <span className="shrink-0 text-base leading-none">{p.icon || '📄'}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-[var(--wiki-text)]">
            {p.title || '제목 없음'}
          </span>
        </span>
        <span className="shrink-0 text-xs text-[var(--wiki-text-muted)]">
          {p.by ? `${p.by} · ` : ''}
          {new Date(p.updatedAt).toLocaleDateString('ko-KR')}
        </span>
      </Link>
    </li>
  )
}

function Section({ title, cards }: { title: string; cards: Card[] }) {
  if (cards.length === 0) return null
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--wiki-text-muted)]">
        {title}
      </h2>
      <ul className="overflow-hidden rounded-[10px] border border-[var(--wiki-border)] bg-[var(--wiki-bg)]">
        {cards.map((p) => (
          <PageRow key={p.id} p={p} />
        ))}
      </ul>
    </section>
  )
}

export default async function WikiHomePage() {
  const token = cookies().get('auth-token')?.value
  const jwt = token ? await verifyToken(token) : null
  const userId = jwt?.userId ?? null

  const pageSelect = {
    id: true,
    title: true,
    icon: true,
    updatedAt: true,
    author: { select: { name: true } },
    lastEditor: { select: { name: true } },
  } as const

  const [recentEdited, favRels, viewLogs] = await Promise.all([
    prisma.wikiPage.findMany({
      where: { isTemplate: false, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: pageSelect,
    }),
    userId
      ? prisma.wikiFavorite.findMany({
          where: { userId, page: { deletedAt: null } },
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: { page: { select: pageSelect } },
        })
      : Promise.resolve([]),
    userId
      ? prisma.wikiViewLog.findMany({
          where: { userId, page: { deletedAt: null } },
          orderBy: { viewedAt: 'desc' },
          take: 40,
          select: { pageId: true, page: { select: pageSelect } },
        })
      : Promise.resolve([]),
  ])

  const toCard = (p: {
    id: string
    title: string
    icon: string | null
    updatedAt: Date
    author: { name: string } | null
    lastEditor: { name: string } | null
  }): Card => ({
    id: p.id,
    title: p.title,
    icon: p.icon,
    updatedAt: p.updatedAt,
    by: p.lastEditor?.name ?? p.author?.name ?? null,
  })

  const favorites = favRels.map((f) => toCard(f.page)).slice(0, 6)

  // 최근 본 — pageId 기준 중복 제거 후 5개
  const seen = new Set<string>()
  const recentViewed: Card[] = []
  for (const v of viewLogs) {
    if (seen.has(v.pageId)) continue
    seen.add(v.pageId)
    recentViewed.push(toCard(v.page))
    if (recentViewed.length >= 5) break
  }

  const recentCards = recentEdited.map(toCard)

  return (
    <div className="wiki-content py-6 sm:py-10">
      <h1 className="wiki-page-title mb-1.5">사내 위키</h1>
      <p className="mb-8 text-sm text-[var(--wiki-text-soft)]">
        좌측 사이드바에서 페이지를 선택하거나 새 페이지를 작성하세요.
      </p>

      {recentCards.length === 0 ? (
        <EmptyState
          icon="📝"
          title="아직 페이지가 없습니다"
          description="첫 위키 페이지를 만들어 팀의 지식을 기록해보세요."
          cta={{ label: '+ 새 페이지 작성', href: '/wiki/new' }}
        />
      ) : (
        <>
          <Section title="⭐ 즐겨찾기" cards={favorites} />
          <Section title="🕐 최근 본 페이지" cards={recentViewed} />
          <Section title="📝 최근 수정 페이지" cards={recentCards} />
        </>
      )}
    </div>
  )
}
