import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import EmptyState from '../components/ui/EmptyState'
import { searchWikiPages, makeSnippet, findFirstMatch } from '@/lib/wiki/search'

export const dynamic = 'force-dynamic'

type SearchParams = { q?: string; tagId?: string; author?: string; period?: string }

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

  // 검색 로직은 /api/wiki/search와 공용 (lib/wiki/search.ts) — 토큰 AND·제목 우선 정렬·첨부 파일명 포함·절단 건수
  const { rows: pages, total, tokens } = hasQuery
    ? await searchWikiPages({ q, tagId, author, period })
    : { rows: [], total: 0, tokens: [] as string[] }

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
          <div className="mt-6 text-xs text-[var(--wiki-text-muted)]">
            {total > pages.length
              ? `${total.toLocaleString('ko-KR')}건 중 상위 ${pages.length}건 표시 — 검색어를 더 구체적으로 입력하면 좁힐 수 있습니다`
              : `${pages.length}건 결과`}
          </div>
          <ul className="mt-3 overflow-hidden rounded-[10px] border border-[var(--wiki-border)] bg-[var(--wiki-bg)]">
            {pages.map((p) => (
              <li key={p.id} className="border-b border-[var(--wiki-border)] last:border-0">
                <Link href={`/wiki/${p.id}`} className="flex gap-2.5 px-4 py-3 transition hover:bg-[var(--wiki-hover)]">
                  <span className="shrink-0 pt-0.5 text-base leading-none">{p.icon || '📄'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-[var(--wiki-text)]">
                      <Highlight text={p.title || '제목 없음'} tokens={tokens} />
                    </span>
                    {tokens.length > 0 && p.plainText && <Snippet text={p.plainText} tokens={tokens} />}
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--wiki-text-muted)]">
                      <span>
                        {p.lastEditorName ?? p.authorName ?? '-'} ·{' '}
                        {new Date(p.updatedAt).toLocaleDateString('ko-KR')}
                      </span>
                      {p.tags.map((t) => (
                        <span
                          key={t.id}
                          className="rounded border px-1.5 py-0.5 text-[10px]"
                          style={
                            t.color
                              ? { borderColor: t.color, color: t.color, background: `${t.color}10` }
                              : { borderColor: 'var(--wiki-border-strong)', color: 'var(--wiki-text-muted)' }
                          }
                        >
                          #{t.name}
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
          placeholder="제목·본문·첨부 파일명 검색 (띄어쓰기로 여러 단어)"
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

function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  const hit = findFirstMatch(text, tokens)
  if (!hit) return <>{text}</>
  return (
    <>
      {text.slice(0, hit.index)}
      <mark className="bg-yellow-200 px-0.5">{text.slice(hit.index, hit.index + hit.length)}</mark>
      {text.slice(hit.index + hit.length)}
    </>
  )
}

function Snippet({ text, tokens }: { text: string; tokens: string[] }) {
  const snip = makeSnippet(text, tokens)
  if (!snip) return null
  return (
    <span className="mt-1 block text-xs text-[var(--wiki-text-soft)]">
      {snip.leading && '… '}
      {snip.before}
      <mark className="bg-yellow-200 px-0.5">{snip.match}</mark>
      {snip.after}
      {snip.trailing && ' …'}
    </span>
  )
}
