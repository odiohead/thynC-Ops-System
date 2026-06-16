import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import EmptyState from '../components/ui/EmptyState'

export const dynamic = 'force-dynamic'

type SearchParams = { q?: string; tagId?: string; author?: string; period?: string }

const PERIODS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 }

export default async function WikiSearchPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const q = (searchParams.q ?? '').trim()
  const tagId = searchParams.tagId ?? null
  const author = (searchParams.author ?? '').trim()
  const period = searchParams.period ?? ''

  const tags = await prisma.wikiTag.findMany({ orderBy: { name: 'asc' } })

  const hasQuery = !!(q || tagId || author || period)

  const where: Prisma.WikiPageWhereInput = { deletedAt: null, isTemplate: false }
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { plainText: { contains: q, mode: 'insensitive' } },
    ]
  }
  if (tagId) where.tags = { some: { tagId } }
  if (author) where.author = { name: { contains: author, mode: 'insensitive' } }
  if (period && PERIODS[period]) {
    const since = new Date(Date.now() - PERIODS[period] * 24 * 60 * 60 * 1000)
    where.updatedAt = { gte: since }
  }

  const pages = hasQuery
    ? await prisma.wikiPage.findMany({
        where,
        take: 50,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          title: true,
          icon: true,
          plainText: true,
          updatedAt: true,
          author: { select: { name: true } },
          lastEditor: { select: { name: true } },
          tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
        },
      })
    : []

  return (
    <div className="wiki-content py-10">
      <h1 className="wiki-page-title mb-5">🔍 위키 검색</h1>
      <SearchForm q={q} author={author} period={period} tagId={tagId} />
      <TagFilter tags={tags} selectedTagId={tagId} q={q} author={author} period={period} />

      {!hasQuery ? (
        <div className="mt-6 text-sm text-[var(--wiki-text-soft)]">
          검색어를 입력하거나 태그·작성자·기간으로 필터하세요.
        </div>
      ) : pages.length === 0 ? (
        <div className="mt-5">
          <EmptyState icon="🔍" title="일치하는 페이지가 없습니다" description="다른 검색어나 필터를 시도해보세요." />
        </div>
      ) : (
        <>
          <div className="mt-6 text-xs text-[var(--wiki-text-muted)]">{pages.length}건 결과</div>
          <ul className="mt-3 overflow-hidden rounded-[10px] border border-[var(--wiki-border)] bg-[var(--wiki-bg)]">
            {pages.map((p) => (
              <li key={p.id} className="border-b border-[var(--wiki-border)] last:border-0">
                <Link href={`/wiki/${p.id}`} className="flex gap-2.5 px-4 py-3 transition hover:bg-[var(--wiki-hover)]">
                  <span className="shrink-0 pt-0.5 text-base leading-none">{p.icon || '📄'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-[var(--wiki-text)]">
                      <Highlight text={p.title || '제목 없음'} query={q} />
                    </span>
                    {q && p.plainText && <Snippet text={p.plainText} query={q} />}
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--wiki-text-muted)]">
                      <span>
                        {p.lastEditor?.name ?? p.author?.name ?? '-'} ·{' '}
                        {new Date(p.updatedAt).toLocaleDateString('ko-KR')}
                      </span>
                      {p.tags.map((t) => (
                        <span
                          key={t.tag.id}
                          className="rounded border px-1.5 py-0.5 text-[10px]"
                          style={
                            t.tag.color
                              ? { borderColor: t.tag.color, color: t.tag.color, background: `${t.tag.color}10` }
                              : { borderColor: 'var(--wiki-border-strong)', color: 'var(--wiki-text-muted)' }
                          }
                        >
                          #{t.tag.name}
                        </span>
                      ))}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function SearchForm({
  q,
  author,
  period,
  tagId,
}: {
  q: string
  author: string
  period: string
  tagId: string | null
}) {
  return (
    <form method="GET" action="/wiki/search" className="space-y-2">
      {tagId && <input type="hidden" name="tagId" value={tagId} />}
      <div className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="제목·본문 검색"
          className="flex-1 rounded-[6px] border border-[var(--wiki-border)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--wiki-accent)]"
        />
        <button
          type="submit"
          className="rounded-[6px] bg-[var(--wiki-accent)] px-4 py-2 text-sm font-medium text-white transition hover:brightness-95"
        >
          검색
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          name="author"
          defaultValue={author}
          placeholder="작성자"
          className="w-40 rounded-[6px] border border-[var(--wiki-border)] px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--wiki-accent)]"
        />
        <select
          name="period"
          defaultValue={period}
          className="rounded-[6px] border border-[var(--wiki-border)] px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--wiki-accent)]"
        >
          <option value="">전체 기간</option>
          <option value="7d">최근 7일</option>
          <option value="30d">최근 30일</option>
          <option value="90d">최근 90일</option>
        </select>
      </div>
    </form>
  )
}

function TagFilter({
  tags,
  selectedTagId,
  q,
  author,
  period,
}: {
  tags: { id: string; name: string; color: string | null }[]
  selectedTagId: string | null
  q: string
  author: string
  period: string
}) {
  if (tags.length === 0) return null
  const base = new URLSearchParams()
  if (q) base.set('q', q)
  if (author) base.set('author', author)
  if (period) base.set('period', period)
  const hrefFor = (id?: string) => {
    const p = new URLSearchParams(base)
    if (id) p.set('tagId', id)
    return `/wiki/search?${p.toString()}`
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="self-center text-xs text-[var(--wiki-text-muted)]">태그:</span>
      <Link
        href={hrefFor()}
        className={`rounded border px-2 py-0.5 text-xs transition ${
          !selectedTagId
            ? 'border-[var(--wiki-border-strong)] bg-[var(--wiki-active)]'
            : 'border-[var(--wiki-border)] hover:bg-[var(--wiki-hover)]'
        }`}
      >
        전체
      </Link>
      {tags.map((t) => (
        <Link
          key={t.id}
          href={hrefFor(t.id)}
          className={`rounded border px-2 py-0.5 text-xs transition ${
            selectedTagId === t.id
              ? 'border-[var(--wiki-accent)] bg-[var(--wiki-accent-soft)]'
              : 'border-[var(--wiki-border)] hover:bg-[var(--wiki-hover)]'
          }`}
          style={t.color ? { color: t.color } : undefined}
        >
          #{t.name}
        </Link>
      ))}
    </div>
  )
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
}

function Snippet({ text, query }: { text: string; query: string }) {
  const lower = text.toLowerCase()
  const idx = lower.indexOf(query.toLowerCase())
  if (idx < 0) return null
  const RADIUS = 60
  const from = Math.max(0, idx - RADIUS)
  const to = Math.min(text.length, idx + query.length + RADIUS)
  return (
    <span className="mt-1 block text-xs text-[var(--wiki-text-soft)]">
      {from > 0 && '… '}
      {text.slice(from, idx)}
      <mark className="bg-yellow-200 px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length, to)}
      {to < text.length && ' …'}
    </span>
  )
}
