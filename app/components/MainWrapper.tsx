'use client'

import { usePathname } from 'next/navigation'

/** 네비게이션 없이 전체 화면을 쓰는 경로 (로그인, 사이니지 대시보드, 운행일지 인쇄) */
const FULLSCREEN_PATHS = ['/login', '/dashboard', '/vehicle-reservations/logs/print']

export default function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  // 모바일 앱 셸(/m/*)은 자체 레이아웃 — startsWith('/m') 는 /maintenances 와 충돌하므로 '/m/' 로 판정
  if (FULLSCREEN_PATHS.includes(pathname) || pathname === '/m' || pathname.startsWith('/m/')) return <>{children}</>

  return (
    <div className="lg:pl-60">
      <div className="pt-14 lg:pt-0">
        {children}
      </div>
    </div>
  )
}
