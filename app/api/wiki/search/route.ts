import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const authUser = await getAuthUser(request)
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') ?? '').trim()
  const tagId = searchParams.get('tagId')

  if (!q && !tagId) return NextResponse.json({ results: [] })

  const where: Record<string, unknown> = { deletedAt: null, isTemplate: false }
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

  const SNIPPET_RADIUS = 60
  const results = pages.map((p) => {
    let snippet: string | null = null
    if (q) {
      const lower = p.plainText.toLowerCase()
      const idx = lower.indexOf(q.toLowerCase())
      if (idx >= 0) {
        const from = Math.max(0, idx - SNIPPET_RADIUS)
        const to = Math.min(p.plainText.length, idx + q.length + SNIPPET_RADIUS)
        snippet =
          (from > 0 ? '… ' : '') +
          p.plainText.slice(from, to) +
          (to < p.plainText.length ? ' …' : '')
      }
    }
    return {
      id: p.id,
      title: p.title,
      snippet,
      updatedAt: p.updatedAt,
      author: p.author?.name ?? null,
      lastEditor: p.lastEditor?.name ?? null,
      tags: p.tags.map((t) => t.tag),
    }
  })

  return NextResponse.json({ results, query: q, total: results.length })
}
