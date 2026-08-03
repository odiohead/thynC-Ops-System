'use client'

/**
 * 영업현황 탭 — 대시보드 A(실적)가 메인, 도입현황이 두 번째.
 * 컨셉 탭(차수 원장·파이프라인·병원 요약·대시보드 B/C)은 2026-08-03 폐기.
 * 접근 권한은 각 페이지의 checkSalesAccess가 강제한다.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/sales/dashboard', label: '대시보드' },
  { href: '/sales/deals', label: '도입현황' },
]

export default function SalesConceptTabs() {
  const pathname = usePathname()

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 px-6 pt-4">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
            pathname === t.href
              ? 'border border-b-0 border-gray-200 bg-white text-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  )
}
