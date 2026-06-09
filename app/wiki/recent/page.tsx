import Link from 'next/link'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function RecentPage() {
  const token = cookies().get('auth-token')?.value
  const jwt = token ? await verifyToken(token) : null
  if (!jwt) return <div className="p-6 text-sm text-gray-500">로그인이 필요합니다.</div>

  // 사용자별 페이지당 가장 최근 1건만 → 최근 50개
  // 사용자 view 로그가 많을 수 있어서 분리된 쿼리로 처리
  const recent = await prisma.$queryRaw<
    { id: string; title: string; viewed_at: Date }[]
  >`
    SELECT DISTINCT ON (page_id) page_id AS id, p.title, v.viewed_at
    FROM wiki.wiki_view_logs v
    JOIN wiki.wiki_pages p ON p.id = v.page_id
    WHERE v.user_id = ${jwt.userId}
    ORDER BY page_id, viewed_at DESC
    LIMIT 200
  `
  const sorted = recent.sort((a, b) => b.viewed_at.getTime() - a.viewed_at.getTime()).slice(0, 50)

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-xl font-bold mb-4">🕐 최근 본 페이지</h1>
      {sorted.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-400 border rounded">
          아직 열람 기록이 없습니다.
        </div>
      ) : (
        <ul className="divide-y border rounded bg-white">
          {sorted.map((r) => (
            <li key={r.id} className="hover:bg-gray-50">
              <Link href={`/wiki/${r.id}`} className="block p-3">
                <div className="text-sm font-medium text-gray-900">{r.title}</div>
                <div className="mt-0.5 text-xs text-gray-500">
                  열람: {new Date(r.viewed_at).toLocaleString('ko-KR')}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
