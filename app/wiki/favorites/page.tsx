import Link from 'next/link'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function FavoritesPage() {
  const token = cookies().get('auth-token')?.value
  const jwt = token ? await verifyToken(token) : null

  if (!jwt) {
    return <div className="p-6 text-sm text-gray-500">로그인이 필요합니다.</div>
  }

  const favorites = await prisma.wikiFavorite.findMany({
    where: { userId: jwt.userId },
    orderBy: { createdAt: 'desc' },
    include: {
      page: {
        select: {
          id: true,
          title: true,
          updatedAt: true,
          author: { select: { name: true } },
          lastEditor: { select: { name: true } },
        },
      },
    },
  })

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-xl font-bold mb-4">⭐ 즐겨찾기</h1>
      {favorites.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-400 border rounded">
          즐겨찾기한 페이지가 없습니다. 페이지 상단의 ☆ 버튼으로 추가하세요.
        </div>
      ) : (
        <ul className="divide-y border rounded bg-white">
          {favorites.map((f) => (
            <li key={f.page.id} className="hover:bg-gray-50">
              <Link href={`/wiki/${f.page.id}`} className="block p-3">
                <div className="text-sm font-medium text-gray-900">{f.page.title}</div>
                <div className="mt-0.5 text-xs text-gray-500">
                  최근 수정: {f.page.lastEditor?.name ?? f.page.author?.name ?? '-'} ·{' '}
                  {new Date(f.page.updatedAt).toLocaleString('ko-KR')} · 즐겨찾기 추가{' '}
                  {new Date(f.createdAt).toLocaleDateString('ko-KR')}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
