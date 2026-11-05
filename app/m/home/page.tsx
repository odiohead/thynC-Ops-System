'use client'

import Link from 'next/link'
import { Car, Truck, Boxes, Monitor, LogOut, ChevronRight } from 'lucide-react'
import MobileHeader from '../_components/MobileHeader'
import InstallBanner from '../_components/InstallBanner'
import { useMobileMe, hasInventoryMenu } from '../_components/useMobileMe'

const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: '최고관리자', ADMIN: '관리자', USER: '사용자', VIEWER: '뷰어' }

export default function MobileHomePage() {
  const { me } = useMobileMe()

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    window.location.replace('/m/login')
  }

  // 홈 메뉴 — 주차등록·출고요청(전원) + 자재관리(재고담당·재고책임자 역할만)
  const tiles = [
    {
      href: '/m/parking',
      title: '주차등록',
      desc: me?.role === 'VIEWER' ? '조회만 가능 (뷰어)' : '방문차량 할인권 자동 등록',
      Icon: Car,
    },
    { href: '/m/stock-out-requests', title: '출고요청', desc: '출고요청 등록·진행 확인', Icon: Truck },
    ...(hasInventoryMenu(me)
      ? [{ href: '/m/inventory', title: '자재관리', desc: '입고·출고·이동, 시리얼 조회', Icon: Boxes }]
      : []),
  ]

  return (
    <>
      <MobileHeader title="thynC Ops" />
      <main className="mx-auto max-w-lg space-y-4 p-4">
        <div className="px-1">
          <p className="text-xl font-bold">{me ? `${me.name}님` : ' '}</p>
          <p className="text-sm text-muted-foreground">
            {me ? [me.organization?.name, ROLE_LABEL[me.role]].filter(Boolean).join(' · ') : ' '}
          </p>
        </div>

        <InstallBanner />

        <div className="space-y-3">
          {tiles.map(({ href, title, desc, Icon }) => (
            <Link key={href} href={href} className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 active:bg-accent">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary">
                <Icon size={26} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold">{title}</span>
                <span className="block truncate text-sm text-muted-foreground">{desc}</span>
              </span>
              <ChevronRight size={20} className="shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </div>

        <div className="flex gap-2 pt-2">
          <a href="/" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-medium text-muted-foreground active:bg-accent">
            <Monitor size={16} /> PC 화면 열기
          </a>
          <button type="button" onClick={logout} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-medium text-muted-foreground active:bg-accent">
            <LogOut size={16} /> 로그아웃
          </button>
        </div>
      </main>
    </>
  )
}
