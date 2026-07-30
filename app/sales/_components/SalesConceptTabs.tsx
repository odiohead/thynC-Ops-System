'use client'

/**
 * 도입 현황 컨셉 탭 — nav는 '도입 현황' 하나만 두고, 세 컨셉(/sales·/sales2·/sales3)을
 * 페이지 상단 탭으로 전환한다. 컨셉 확정 시 채택안만 남기고 이 탭은 제거 예정.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/sales', label: '차수 원장' },
  { href: '/sales2', label: '영업 파이프라인' },
  { href: '/sales3', label: '병원 요약' },
  { href: '/sales/dashboard', label: '대시보드 A · 실적' },
  { href: '/sales/dashboard2', label: '대시보드 B · 파이프라인' },
  { href: '/sales/dashboard3', label: '대시보드 C · 인사이트' },
]

export default function SalesConceptTabs() {
  const pathname = usePathname()
  return (
    <div className="flex items-center gap-1 border-b border-gray-200 px-6 pt-4">
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
      <span className="ml-2 pb-1 text-[11px] text-gray-400">컨셉 비교 중 — 확정 후 하나로 통합</span>
    </div>
  )
}
