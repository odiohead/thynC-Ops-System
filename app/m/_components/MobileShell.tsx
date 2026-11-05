'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Car, Truck, Boxes } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useMobileMe, hasInventoryMenu } from './useMobileMe'

const BASE_TABS = [
  { href: '/m/home', label: '홈', Icon: Home },
  { href: '/m/parking', label: '주차등록', Icon: Car },
  { href: '/m/stock-out-requests', label: '출고요청', Icon: Truck },
]
const INVENTORY_TAB = { href: '/m/inventory', label: '자재관리', Icon: Boxes }

/** 모바일 셸 — 하단 탭 + 서비스 워커 등록. 로그인 화면은 탭 없이 */
export default function MobileShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const showTabs = pathname !== '/m/login'
  const { me } = useMobileMe(showTabs)
  const tabs = hasInventoryMenu(me) ? [...BASE_TABS, INVENTORY_TAB] : BASE_TABS

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    // scope '/m/' — 사이니지 SW(/dashboard)와 겹치지 않음. 실패해도 앱 동작에는 영향 없음
    navigator.serviceWorker.register('/m-sw.js', { scope: '/m/' }).catch(() => {})
  }, [])

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className={cn(showTabs && 'pb-[calc(4rem+env(safe-area-inset-bottom))]')}>{children}</div>
      {showTabs && (
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
          <div className={cn('mx-auto grid h-16 max-w-lg', tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3')}>
            {tabs.map(({ href, label, Icon }) => {
              const active = pathname === href || pathname.startsWith(href + '/')
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
                    active ? 'text-primary' : 'text-muted-foreground'
                  )}
                >
                  <Icon size={22} strokeWidth={active ? 2.4 : 2} />
                  {label}
                </Link>
              )
            })}
          </div>
        </nav>
      )}
    </div>
  )
}
