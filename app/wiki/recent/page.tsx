import Link from 'next/link'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import EmptyState from '../components/ui/EmptyState'

export const dynamic = 'force-dynamic'

export default async function RecentPage() {
  const token = cookies().get('auth-token')?.value
  const jwt = token ? await verifyToken(token) : null
  if (!jwt)
    return <div className="wiki-content py-10 text-sm text-[var(--wiki-text-soft)]">로그인이 필요합니다.</div>

  const recent = await prisma.$queryRaw<
    { id: string; title: string; icon: string | null; viewed_at: Date }[]
  >`
    SELECT DISTINCT ON (page_id) page_id AS id, p.title, p.icon, v.viewed_at
    FROM wiki.wiki_view_logs v
    JOIN wiki.wiki_pages p ON p.id = v.page_id
    WHERE v.user_id = ${jwt.userId} AND p.deleted_at IS NULL
    ORDER BY page_id, viewed_at DESC
    LIMIT 200
  `
  const sorted = recent.sort((a, b) => b.viewed_at.getTime() - a.viewed_at.getTime()).slice(0, 50)

  return (
    <div className="wiki-content py-10">
      <h1 className="wiki-page-title mb-5">🕐 최근 본 페이지</h1>
      {sorted.length === 0 ? (
        <EmptyState icon="🕐" title="아직 열람 기록이 없습니다" description="페이지를 열람하면 여기에 표시됩니다." />
      ) : (
        <ul className="overflow-hidden rounded-[10px] border border-[var(--wiki-border)] bg-[var(--wiki-bg)]">
          {sorted.map((r) => (
            <li key={r.id} className="border-b border-[var(--wiki-border)] last:border-0">
              <Link
                href={`/wiki/${r.id}`}
                className="flex items-center gap-2.5 px-4 py-2.5 transition hover:bg-[var(--wiki-hover)]"
              >
                <span className="shrink-0 text-base leading-none">{r.icon || '📄'}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--wiki-text)]">
                  {r.title || '제목 없음'}
                </span>
                <span className="shrink-0 text-xs text-[var(--wiki-text-muted)]">
                  {new Date(r.viewed_at).toLocaleString('ko-KR')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
