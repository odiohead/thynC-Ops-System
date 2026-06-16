import { prisma } from '@/lib/prisma'
import EmptyState from '../components/ui/EmptyState'
import TrashActions from './TrashActions'

export const dynamic = 'force-dynamic'

export default async function TrashPage() {
  const pages = await prisma.wikiPage.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: 'desc' },
    take: 200,
    select: {
      id: true,
      title: true,
      icon: true,
      deletedAt: true,
      author: { select: { name: true } },
      lastEditor: { select: { name: true } },
    },
  })

  return (
    <div className="wiki-content py-10">
      <h1 className="wiki-page-title mb-2">🗑 휴지통</h1>
      <p className="mb-6 text-sm text-[var(--wiki-text-soft)]">
        삭제된 페이지는 여기에서 복구하거나 영구 삭제할 수 있습니다. 하위 페이지는 부모와 함께 복구됩니다.
      </p>

      {pages.length === 0 ? (
        <EmptyState icon="🗑" title="휴지통이 비어 있습니다" description="삭제한 페이지가 여기에 표시됩니다." />
      ) : (
        <ul className="overflow-hidden rounded-[10px] border border-[var(--wiki-border)] bg-[var(--wiki-bg)]">
          {pages.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2.5 border-b border-[var(--wiki-border)] px-4 py-2.5 last:border-0"
            >
              <span className="shrink-0 text-base leading-none opacity-70">{p.icon || '📄'}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--wiki-text-soft)]">
                  {p.title || '제목 없음'}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--wiki-text-muted)]">
                  {p.lastEditor?.name ?? p.author?.name ?? '-'} · 삭제{' '}
                  {p.deletedAt ? new Date(p.deletedAt).toLocaleString('ko-KR') : ''}
                </span>
              </span>
              <TrashActions pageId={p.id} title={p.title} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
