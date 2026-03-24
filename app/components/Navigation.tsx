'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

function HiraIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  )
}

function HospitalIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function LogoutIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

function ProjectIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function SiteVisitIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'VIEWER'

function isAdminOrAbove(role: UserRole | null) {
  return role === 'SUPER_ADMIN' || role === 'ADMIN'
}

const ROLE_LABEL: Record<UserRole, string> = {
  SUPER_ADMIN: '최고관리자',
  ADMIN: '관리자',
  USER: '일반',
  VIEWER: '뷰어',
}

export default function Navigation() {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(pathname.startsWith('/settings'))
  const [userRole, setUserRole] = useState<UserRole | null>(null)
  const [userName, setUserName] = useState('')

  useEffect(() => {
    if (pathname === '/login') return
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => {
        if (data?.role) {
          setUserRole(data.role)
          setUserName(data.name)
        } else {
          setUserRole(null)
          setUserName('')
        }
      })
      .catch(() => {})
  }, [pathname])

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    if (pathname.startsWith('/settings')) setSettingsOpen(true)
  }, [pathname])

  if (pathname === '/login') return null

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/')
  }

  const navItemClass = (active: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
      active
        ? 'bg-blue-50 text-blue-700 font-medium'
        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
    }`

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* 로고 */}
      <div className="flex h-14 shrink-0 items-center border-b border-gray-200 px-5">
        <Link href="/" className="text-base font-bold tracking-tight text-gray-900 hover:text-blue-600 transition-colors">{process.env.NEXT_PUBLIC_APP_NAME}</Link>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">

        {/* 심평원 병원목록 (ADMIN 이상만) */}
        {isAdminOrAbove(userRole) && (
          <Link href="/hira-hospitals" className={navItemClass(isActive('/hira-hospitals'))}>
            <HiraIcon />
            심평원 병원목록
          </Link>
        )}

        {/* 병원 목록 */}
        <Link href="/hospitals" className={navItemClass(isActive('/hospitals'))}>
          <HospitalIcon />
          병원 목록
        </Link>

        {/* 프로젝트 관리 */}
        <Link href="/projects" className={navItemClass(isActive('/projects'))}>
          <ProjectIcon />
          프로젝트 관리
        </Link>

        {/* 답사 현황 */}
        <Link href="/site-visits" className={navItemClass(isActive('/site-visits'))}>
          <SiteVisitIcon />
          답사 현황
        </Link>

        {/* 설정 */}
        <div>
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              pathname.startsWith('/settings')
                ? 'text-gray-900 font-medium'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            <SettingsIcon />
            <span className="flex-1 text-left">설정</span>
            <ChevronIcon open={settingsOpen} />
          </button>

          {settingsOpen && (
            <div className="ml-7 mt-0.5 space-y-0.5 border-l border-gray-200 pl-3">
              {/* 소속 관리: SUPER_ADMIN만 */}
              {userRole === 'SUPER_ADMIN' && (
                <Link
                  href="/settings/organizations"
                  className={navItemClass(isActive('/settings/organizations'))}
                >
                  소속 관리
                </Link>
              )}
              {/* 내 프로필: 모든 역할 */}
              <Link
                href="/settings/profile"
                className={navItemClass(isActive('/settings/profile'))}
              >
                내 프로필
              </Link>
              {/* 아래 항목: ADMIN 이상, USER */}
              {(isAdminOrAbove(userRole) || userRole === 'USER') && (
                <>
                  <Link
                    href="/settings/status"
                    className={navItemClass(isActive('/settings/status'))}
                  >
                    병원 상태코드 관리
                  </Link>
                  <Link
                    href="/settings/build-status"
                    className={navItemClass(isActive('/settings/build-status'))}
                  >
                    구축상태 관리
                  </Link>
                  <Link
                    href="/settings/devices"
                    className={navItemClass(isActive('/settings/devices'))}
                  >
                    기기 관리
                  </Link>
                  <Link
                    href="/settings/constructors"
                    className={navItemClass(isActive('/settings/constructors'))}
                  >
                    공사업체 관리
                  </Link>
                </>
              )}
              {/* 답사 상태 관리: ADMIN 이상만 */}
              {isAdminOrAbove(userRole) && (
                <Link
                  href="/settings/site-visit-status"
                  className={navItemClass(isActive('/settings/site-visit-status'))}
                >
                  답사 상태 관리
                </Link>
              )}
            </div>
          )}
        </div>

        {/* 계정 관리: 모든 역할 */}
        <Link href="/users" className={navItemClass(isActive('/users'))}>
          <UsersIcon />
          계정 관리
        </Link>

      </nav>

      {/* 하단 사용자 정보 + 로그아웃 */}
      <div className="shrink-0 border-t border-gray-200 p-3">
        {userName && (
          <div className="mb-2 px-3 py-1">
            <p className="text-xs font-medium text-gray-900 truncate">{userName}</p>
            <p className="text-xs text-gray-500">
              {userRole ? ROLE_LABEL[userRole] : ''}
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
        >
          <LogoutIcon />
          로그아웃
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* 데스크탑 사이드바 */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-gray-200 bg-white lg:flex">
        {sidebarContent}
      </aside>

      {/* 모바일 상단 헤더 */}
      <header className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4 lg:hidden">
        <Link href="/" className="text-base font-bold tracking-tight text-gray-900 hover:text-blue-600 transition-colors">{process.env.NEXT_PUBLIC_APP_NAME}</Link>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
        >
          <MenuIcon />
        </button>
      </header>

      {/* 모바일 드로어 */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-gray-200 bg-white lg:hidden">
            <div className="absolute right-3 top-3">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
              >
                <CloseIcon />
              </button>
            </div>
            {sidebarContent}
          </aside>
        </>
      )}
    </>
  )
}
