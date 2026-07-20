'use client'

import { usePathname } from 'next/navigation'

/** 네비게이션 없이 전체 화면을 쓰는 경로 (로그인, 사이니지 대시보드, 운행일지 인쇄) */
const FULLSCREEN_PATHS = ['/login', '/dashboard', '/vehicle-reservations/logs/print']

export default function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (FULLSCREEN_PATHS.includes(pathname)) return <>{children}</>

  return (
    <div className="lg:pl-60">
      <div className="pt-14 lg:pt-0">
        {children}
      </div>
    </div>
  )
}
