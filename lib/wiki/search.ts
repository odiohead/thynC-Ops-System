import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * 위키 사람용 검색 — 단일 소스 (검색 페이지 `/wiki/search`와 `/api/wiki/search` 공용).
 *
 * 2026-09-12 검토 B-2:
 * - 공백으로 나눈 토큰을 **모두 포함(AND)** 해야 매칭 (기존: 질의 문자열 전체 부분일치 → '설치 계획'과 '설치계획'이 갈림)
 * - 대상: 제목 · 본문(plain_text) · **첨부 파일명** (위키를 양식 보관소로 쓰는 실사용)
 * - 정렬: 제목 완전 일치 → 제목에 포함된 토큰 수 → 최근 수정 (기존: 최신순뿐이라 제목 일치 문서가 꼴찌로 밀림)
 * - `total`(절단 전 건수)을 함께 돌려 "50건 이상"을 사용자에게 알린다
 * pg_trgm GIN 인덱스(title/plain_text)가 ILIKE를 가속한다. 한글 동작은 dev2·PROD 모두 C.UTF-8 로케일로 확인.
 */

export const WIKI_SEARCH_LIMIT = 50
export const WIKI_SEARCH_MAX_TOKENS = 5

export type WikiSearchParams = {
  q?: string
  tagId?: string | null
  author?: string
  /** '7d' | '30d' | '90d' */
  period?: string
  limit?: number
}

export type WikiSearchRow = {
  id: string
  title: string
  icon: string | null
  plainText: string
  updatedAt: Date
  authorName: string | null
  lastEditorName: string | null
  tags: { id: string; name: string; color: string | null }[]
}

export type WikiSearchResult = {
  rows: WikiSearchRow[]
  /** 절단 전 일치 건수 */
  total: number
  tokens: string[]
}

const PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 }

export function tokenizeQuery(q: string): string[] {
  return q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, WIKI_SEARCH_MAX_TOKENS)
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`)
}

type RawRow = {
  id: string
  title: string
  icon: string | null
  plainText: string
  updatedAt: Date
  authorName: string | null
  lastEditorName: string | null
  total: number | bigint
}

export async function searchWikiPages(params: WikiSearchParams): Promise<WikiSearchResult> {
  const q = (params.q ?? '').trim()
  const tokens = tokenizeQuery(q)
  const tagId = params.tagId || null
  const author = (params.author ?? '').trim()
  const days = params.period ? PERIOD_DAYS[params.period] : undefined
  const limit = params.limit ?? WIKI_SEARCH_LIMIT

  if (!tokens.length && !tagId && !author && !days) return { rows: [], total: 0, tokens }

  const conds: Prisma.Sql[] = [Prisma.sql`p.deleted_at IS NULL`, Prisma.sql`p.is_template = false`]
  for (const t of tokens) {
    const like = `%${escapeLike(t)}%`
    conds.push(
      Prisma.sql`(p.title ILIKE ${like} OR p.plain_text ILIKE ${like} OR EXISTS (
        SELECT 1 FROM wiki.wiki_attachments a WHERE a.page_id = p.id AND a.file_name ILIKE ${like}
      ))`,
    )
  }
  if (tagId) {
    conds.push(Prisma.sql`EXISTS (SELECT 1 FROM wiki.wiki_page_tags pt WHERE pt.page_id = p.id AND pt.tag_id = ${tagId})`)
  }
  if (author) {
    conds.push(Prisma.sql`u.name ILIKE ${`%${escapeLike(author)}%`}`)
  }
  if (days) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    conds.push(Prisma.sql`p.updated_at >= ${since}`)
  }

  const exactTitle = q ? Prisma.sql`(lower(p.title) = lower(${q}))::int` : Prisma.sql`0`
  const titleHits = tokens.length
    ? Prisma.sql`(${Prisma.join(
        tokens.map((t) => Prisma.sql`(p.title ILIKE ${`%${escapeLike(t)}%`})::int`),
        ' + ',
      )})`
    : Prisma.sql`0`

  const raw = await prisma.$queryRaw<RawRow[]>`
    SELECT p.id, p.title, p.icon, p.plain_text AS "plainText", p.updated_at AS "updatedAt",
           u.name AS "authorName", le.name AS "lastEditorName",
           count(*) OVER()::int AS total
    FROM wiki.wiki_pages p
    LEFT JOIN public.users u ON u.id = p.author_id
    LEFT JOIN public.users le ON le.id = p.last_editor_id
    WHERE ${Prisma.join(conds, ' AND ')}
    ORDER BY ${exactTitle} DESC, ${titleHits} DESC, p.updated_at DESC
    LIMIT ${limit}
  `

  const ids = raw.map((r) => r.id)
  const tagRels = ids.length
    ? await prisma.wikiPageTag.findMany({
        where: { pageId: { in: ids } },
        select: { pageId: true, tag: { select: { id: true, name: true, color: true } } },
      })
    : []
  const tagsByPage = new Map<string, WikiSearchRow['tags']>()
  for (const rel of tagRels) {
    const arr = tagsByPage.get(rel.pageId) ?? []
    arr.push(rel.tag)
    tagsByPage.set(rel.pageId, arr)
  }

  const total = raw.length ? Number(raw[0].total) : 0
  const rows: WikiSearchRow[] = raw.map((r) => ({
    id: r.id,
    title: r.title,
    icon: r.icon,
    plainText: r.plainText,
    updatedAt: r.updatedAt,
    authorName: r.authorName,
    lastEditorName: r.lastEditorName,
    tags: tagsByPage.get(r.id) ?? [],
  }))
  return { rows, total, tokens }
}

/** 텍스트에서 토큰 중 첫 번째로 등장하는 위치 — 하이라이트·스니펫용 */
export function findFirstMatch(text: string, tokens: string[]): { index: number; length: number } | null {
  const lower = text.toLowerCase()
  let best: { index: number; length: number } | null = null
  for (const t of tokens) {
    const i = lower.indexOf(t.toLowerCase())
    if (i >= 0 && (!best || i < best.index)) best = { index: i, length: t.length }
  }
  return best
}

/** 본문 스니펫 — 첫 토큰 일치 위치를 중심으로 앞뒤 radius 글자 */
export function makeSnippet(
  text: string,
  tokens: string[],
  radius = 60,
): { before: string; match: string; after: string; leading: boolean; trailing: boolean } | null {
  const hit = findFirstMatch(text, tokens)
  if (!hit) return null
  const from = Math.max(0, hit.index - radius)
  const to = Math.min(text.length, hit.index + hit.length + radius)
  return {
    before: text.slice(from, hit.index),
    match: text.slice(hit.index, hit.index + hit.length),
    after: text.slice(hit.index + hit.length, to),
    leading: from > 0,
    trailing: to < text.length,
  }
}
