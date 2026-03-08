import Link from 'next/link'

interface Props {
  page: number
  totalPages: number
  search: string
  sido: string
}

function buildHref(page: number, search: string, sido: string) {
  const params = new URLSearchParams()
  params.set('page', String(page))
  if (search) params.set('search', search)
  if (sido) params.set('sido', sido)
  return `/hospitals?${params.toString()}`
}

export default function Pagination({ page, totalPages, search, sido }: Props) {
  if (totalPages <= 1) return null

  const delta = 2
  const range: number[] = []
  for (let i = Math.max(1, page - delta); i <= Math.min(totalPages, page + delta); i++) {
    range.push(i)
  }

  const linkBase = 'rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 transition-colors'
  const activeLink = 'rounded px-3 py-1.5 text-sm font-semibold bg-blue-600 text-white'

  return (
    <div className="mt-6 flex items-center justify-center gap-1">
      {page > 1 && (
        <Link href={buildHref(page - 1, search, sido)} className={linkBase}>
          ← 이전
        </Link>
      )}

      {range[0] > 1 && (
        <>
          <Link href={buildHref(1, search, sido)} className={linkBase}>
            1
          </Link>
          {range[0] > 2 && <span className="px-1 text-gray-400">…</span>}
        </>
      )}

      {range.map((p) => (
        <Link key={p} href={buildHref(p, search, sido)} className={p === page ? activeLink : linkBase}>
          {p}
        </Link>
      ))}

      {range[range.length - 1] < totalPages && (
        <>
          {range[range.length - 1] < totalPages - 1 && (
            <span className="px-1 text-gray-400">…</span>
          )}
          <Link href={buildHref(totalPages, search, sido)} className={linkBase}>
            {totalPages}
          </Link>
        </>
      )}

      {page < totalPages && (
        <Link href={buildHref(page + 1, search, sido)} className={linkBase}>
          다음 →
        </Link>
      )}
    </div>
  )
}
