import { NextRequest, NextResponse } from 'next/server'
import { getWikiAuthUser } from '@/lib/wiki/access'
import { searchWikiPages, makeSnippet } from '@/lib/wiki/search'

/**
 * 위키 검색 API — 에디터 '기존 페이지 링크' 피커가 사용. 응답 형식(results[].id/title/snippet/updatedAt/author/lastEditor/tags)은 유지.
 * 검색 로직은 검색 페이지와 공용 `lib/wiki/search.ts` (2026-09-12 B-2: 토큰 AND·제목 우선 정렬·첨부 파일명·절단 안내).
 */
export async function GET(request: NextRequest) {
  const authUser = await getWikiAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') ?? '').trim()
  const tagId = searchParams.get('tagId')

  if (!q && !tagId) return NextResponse.json({ results: [] })

  const { rows, total, tokens } = await searchWikiPages({ q, tagId })

  const results = rows.map((p) => {
    const snip = makeSnippet(p.plainText, tokens)
    const snippet = snip
      ? `${snip.leading ? '… ' : ''}${snip.before}${snip.match}${snip.after}${snip.trailing ? ' …' : ''}`
      : null
    return {
      id: p.id,
      title: p.title,
      snippet,
      updatedAt: p.updatedAt,
      author: p.authorName,
      lastEditor: p.lastEditorName,
      tags: p.tags,
    }
  })

  return NextResponse.json({ results, query: q, total, truncated: total > results.length })
}
