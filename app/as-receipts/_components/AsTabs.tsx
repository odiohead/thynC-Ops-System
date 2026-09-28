'use client'

/**
 * AS업무 상단 탭 스트립 (2026-09-28 — as_repair_queue_design.md §4) — 접수 목록(/as-receipts) ↔ 수리대기(/as-receipts/queue)
 * nav 행 없이 두 페이지가 공통으로 렌더. 링크는 각 화면의 마지막 필터(sessionStorage)로 복귀.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AS_LIST_QS_KEY, AS_QUEUE_QS_KEY } from '@/lib/asReceiptShared'

function savedHref(base: string, key: string): string {
  if (typeof window === 'undefined') return base
  try {
    const qs = window.sessionStorage.getItem(key)
    return qs ? `${base}?${qs}` : base
  } catch {
    return base
  }
}

const TABS = [
  { href: '/as-receipts', key: AS_LIST_QS_KEY, label: '접수 목록', exact: true },
  { href: '/as-receipts/queue', key: AS_QUEUE_QS_KEY, label: '수리대기', exact: false },
] as const

export default function AsTabs({ right }: { right?: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <div className="mb-4 flex items-end justify-between gap-2 border-b border-gray-200">
      <nav className="-mb-px flex gap-1" aria-label="AS업무 화면">
        {TABS.map((t) => {
          const active = t.exact ? pathname === t.href : pathname.startsWith(t.href)
          return (
            <Link
              key={t.href}
              href={savedHref(t.href, t.key)}
              aria-current={active ? 'page' : undefined}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${active ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'}`}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>
      {right && <div className="pb-1">{right}</div>}
    </div>
  )
}
