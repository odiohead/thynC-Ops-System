import Link from 'next/link'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type SearchParams = { q?: string; tagId?: string }

export default async function WikiSearchPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const q = (searchParams.q ?? '').trim()
  const tagId = searchParams.tagId ?? null

  const tags = await prisma.wikiTag.findMany({ orderBy: { name: 'asc' } })

  if (!q && !tagId) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-xl font-bold mb-4">🔍 위키 검색</h1>
        <SearchForm q="" />
        <TagFilter tags={tags} selectedTagId={null} />
        <div className="text-sm text-gray-500 mt-6">
          검색어를 입력하거나 태그를 선택하세요.
        </div>
      </div>
    )
  }

  const where: Record<string, unknown> = {}
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { plainText: { contains: q, mode: 'insensitive' } },
    ]
  }
  if (tagId) {
    where.tags = { some: { tagId } }
  }

  const pages = await prisma.wikiPage.findMany({
    where,
    take: 50,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      plainText: true,
      updatedAt: true,
      author: { select: { name: true } },
      lastEditor: { select: { name: true } },
      tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
    },
  })

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-xl font-bold mb-4">🔍 위키 검색</h1>
      <SearchForm q={q} />
      <TagFilter tags={tags} selectedTagId={tagId} />

      <div className="mt-6 text-xs text-gray-500">
        {pages.length}건 결과
      </div>

      {pages.length === 0 ? (
        <div className="mt-4 text-center py-12 text-sm text-gray-400 border rounded">
          일치하는 페이지가 없습니다.
        </div>
      ) : (
        <ul className="mt-3 divide-y border rounded bg-white">
          {pages.map((p) => (
            <li key={p.id} className="hover:bg-gray-50">
              <Link href={`/wiki/${p.id}`} className="block p-3">
                <div className="text-sm font-medium text-gray-900">
                  <Highlight text={p.title} query={q} />
                </div>
                {q && p.plainText && (
                  <Snippet text={p.plainText} query={q} />
                )}
                <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                  <span>
                    {p.lastEditor?.name ?? p.author?.name ?? '-'} ·{' '}
                    {new Date(p.updatedAt).toLocaleDateString('ko-KR')}
                  </span>
                  {p.tags.length > 0 && (
                    <span className="flex gap-1">
                      {p.tags.map((t) => (
                        <span
                          key={t.tag.id}
                          className="px-1.5 py-0.5 text-[10px] rounded border"
                          style={
                            t.tag.color
                              ? { borderColor: t.tag.color, color: t.tag.color, background: `${t.tag.color}10` }
                              : { borderColor: '#d1d5db', color: '#6b7280' }
                          }
                        >
                          #{t.tag.name}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SearchForm({ q }: { q: string }) {
  return (
    <form method="GET" action="/wiki/search" className="flex gap-2">
      <input
        type="search"
        name="q"
        defaultValue={q}
        placeholder="제목·본문 검색"
        className="flex-1 px-3 py-2 border rounded text-sm"
      />
      <button
        type="submit"
        className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
      >
        검색
      </button>
    </form>
  )
}

function TagFilter({
  tags,
  selectedTagId,
}: {
  tags: { id: string; name: string; color: string | null }[]
  selectedTagId: string | null
}) {
  if (tags.length === 0) return null
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      <span className="text-xs text-gray-500 self-center">태그 필터:</span>
      <Link
        href="/wiki/search"
        className={`text-xs px-2 py-0.5 rounded border ${
          !selectedTagId ? 'bg-gray-200 border-gray-400' : 'border-gray-300 hover:bg-gray-50'
        }`}
      >
        전체
      </Link>
      {tags.map((t) => (
        <Link
          key={t.id}
          href={`/wiki/search?tagId=${t.id}`}
          className={`text-xs px-2 py-0.5 rounded border ${
            selectedTagId === t.id ? 'bg-blue-100 border-blue-400' : 'border-gray-300 hover:bg-gray-50'
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
  const before = text.slice(from, idx)
  const match = text.slice(idx, idx + query.length)
  const after = text.slice(idx + query.length, to)
  return (
    <div className="mt-1 text-xs text-gray-600">
      {from > 0 && '… '}
      {before}
      <mark className="bg-yellow-200 px-0.5">{match}</mark>
      {after}
      {to < text.length && ' …'}
    </div>
  )
}
