'use client'

/**
 * 영업현황 탭 — 기본 노출은 도입현황(/sales/deals)·대시보드 A 2개.
 * 나머지 컨셉 탭(차수 원장·파이프라인·병원 요약·대시보드 B/C)은 SUPER_ADMIN에게만 노출 (2026-08-01).
 * 노출만 제어하며 실제 접근 권한은 각 페이지의 checkSalesAccess가 강제한다.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const MAIN_TABS = [
  { href: '/sales/deals', label: '도입현황' },
  { href: '/sales/dashboard', label: '대시보드 A · 실적' },
]

const SUPER_ADMIN_TABS = [
  { href: '/sales', label: '차수 원장' },
  { href: '/sales2', label: '영업 파이프라인' },
  { href: '/sales3', label: '병원 요약' },
  { href: '/sales/dashboard2', label: '대시보드 B · 파이프라인' },
  { href: '/sales/dashboard3', label: '대시보드 C · 인사이트' },
]

export default function SalesConceptTabs() {
  const pathname = usePathname()
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => setIsSuperAdmin(u?.role === 'SUPER_ADMIN'))
      .catch(() => setIsSuperAdmin(false))
  }, [])

  const tabs = isSuperAdmin ? [...MAIN_TABS, ...SUPER_ADMIN_TABS] : MAIN_TABS

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 px-6 pt-4">
      {tabs.map((t) => (
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
      {isSuperAdmin && <span className="ml-2 pb-1 text-[11px] text-gray-400">컨셉 탭(차수 원장~대시보드 C)은 최고관리자만 표시</span>}
    </div>
  )
}
