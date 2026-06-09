import Link from 'next/link'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function WikiHomePage() {
  const pages = await prisma.wikiPage.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 20,
    select: {
      id: true,
      title: true,
      updatedAt: true,
      author: { select: { name: true } },
      lastEditor: { select: { name: true } },
    },
  })

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-xl font-bold mb-1">사내 위키</h1>
      <p className="text-sm text-gray-500 mb-6">
        좌측 사이드바에서 페이지를 선택하거나 새 페이지를 작성하세요.
      </p>

      <h2 className="text-sm font-semibold text-gray-700 mb-2">최근 수정 페이지</h2>
      {pages.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-400 border rounded">
          아직 페이지가 없습니다.
        </div>
      ) : (
        <ul className="divide-y border rounded bg-white">
          {pages.map((p) => (
            <li key={p.id} className="hover:bg-gray-50">
              <Link href={`/wiki/${p.id}`} className="block p-3">
                <div className="text-sm font-medium text-gray-900">{p.title}</div>
                <div className="mt-0.5 text-xs text-gray-500">
                  {p.lastEditor?.name ?? p.author?.name ?? '-'} ·{' '}
                  {new Date(p.updatedAt).toLocaleString('ko-KR')}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
