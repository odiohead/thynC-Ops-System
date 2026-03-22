import Link from 'next/link'

interface Props {
  page: number
  totalPages: number
  search: string
  buildStatusId: string
  contractorId: string
  builderId: string
  orderBy: string
  order: string
}

function buildHref(page: number, props: Omit<Props, 'page' | 'totalPages'>) {
  const params = new URLSearchParams()
  params.set('page', String(page))
  if (props.search) params.set('search', props.search)
  if (props.buildStatusId) params.set('buildStatusId', props.buildStatusId)
  if (props.contractorId) params.set('contractorId', props.contractorId)
  if (props.builderId) params.set('builderId', props.builderId)
  if (props.orderBy) params.set('orderBy', props.orderBy)
  if (props.order) params.set('order', props.order)
  return `/projects?${params.toString()}`
}

export default function ProjectPagination(props: Props) {
  const { page, totalPages } = props
  if (totalPages <= 1) return null

  const delta = 2
  const range: number[] = []
  for (let i = Math.max(1, page - delta); i <= Math.min(totalPages, page + delta); i++) {
    range.push(i)
  }

  const rest = { search: props.search, buildStatusId: props.buildStatusId, contractorId: props.contractorId, builderId: props.builderId, orderBy: props.orderBy, order: props.order }
  const linkBase = 'rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 transition-colors'
  const activeLink = 'rounded px-3 py-1.5 text-sm font-semibold bg-blue-600 text-white'

  return (
    <div className="mt-6 flex items-center justify-center gap-1">
      {page > 1 && <Link href={buildHref(page - 1, rest)} className={linkBase}>← 이전</Link>}
      {range[0] > 1 && (
        <>
          <Link href={buildHref(1, rest)} className={linkBase}>1</Link>
          {range[0] > 2 && <span className="px-1 text-gray-400">…</span>}
        </>
      )}
      {range.map((p) => (
        <Link key={p} href={buildHref(p, rest)} className={p === page ? activeLink : linkBase}>{p}</Link>
      ))}
      {range[range.length - 1] < totalPages && (
        <>
          {range[range.length - 1] < totalPages - 1 && <span className="px-1 text-gray-400">…</span>}
          <Link href={buildHref(totalPages, rest)} className={linkBase}>{totalPages}</Link>
        </>
      )}
      {page < totalPages && <Link href={buildHref(page + 1, rest)} className={linkBase}>다음 →</Link>}
    </div>
  )
}
