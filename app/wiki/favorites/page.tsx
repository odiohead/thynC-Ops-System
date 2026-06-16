import Link from 'next/link'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import EmptyState from '../components/ui/EmptyState'

export const dynamic = 'force-dynamic'

export default async function FavoritesPage() {
  const token = cookies().get('auth-token')?.value
  const jwt = token ? await verifyToken(token) : null

  if (!jwt) {
    return <div className="wiki-content py-10 text-sm text-[var(--wiki-text-soft)]">로그인이 필요합니다.</div>
  }

  const favorites = await prisma.wikiFavorite.findMany({
    where: { userId: jwt.userId, page: { deletedAt: null } },
    orderBy: { createdAt: 'desc' },
    include: {
      page: {
        select: {
          id: true,
          title: true,
          icon: true,
          updatedAt: true,
          author: { select: { name: true } },
          lastEditor: { select: { name: true } },
        },
      },
    },
  })

  return (
    <div className="wiki-content py-10">
      <h1 className="wiki-page-title mb-5">⭐ 즐겨찾기</h1>
      {favorites.length === 0 ? (
        <EmptyState
          icon="⭐"
          title="즐겨찾기한 페이지가 없습니다"
          description="페이지 상단의 ☆ 버튼으로 추가하세요."
        />
      ) : (
        <ul className="overflow-hidden rounded-[10px] border border-[var(--wiki-border)] bg-[var(--wiki-bg)]">
          {favorites.map((f) => (
            <li key={f.page.id} className="border-b border-[var(--wiki-border)] last:border-0">
              <Link
                href={`/wiki/${f.page.id}`}
                className="flex items-center gap-2.5 px-4 py-2.5 transition hover:bg-[var(--wiki-hover)]"
              >
                <span className="shrink-0 text-base leading-none">{f.page.icon || '📄'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--wiki-text)]">
                    {f.page.title || '제목 없음'}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--wiki-text-muted)]">
                    {f.page.lastEditor?.name ?? f.page.author?.name ?? '-'} ·{' '}
                    {new Date(f.page.updatedAt).toLocaleDateString('ko-KR')}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
