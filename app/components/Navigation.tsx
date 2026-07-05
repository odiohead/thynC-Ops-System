'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { getMenuIcon } from './NavIcons'
import ThemeToggle from './theme/ThemeToggle'

/* ── 구조적 아이콘 (메뉴 아이콘이 아닌 UI용) ── */

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

function LogoutIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

/* ── 타입 ── */

type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'VIEWER'

interface NavItem {
  id: number
  menuKey: string
  label: string
  href: string
  iconKey: string | null
  parentKey: string | null
  allowedRoles: string[]
  allowedOrgCodes: string[]
  sortOrder: number
}

const ROLE_LABEL: Record<UserRole, string> = {
  SUPER_ADMIN: '최고관리자',
  ADMIN: '관리자',
  USER: '일반',
  VIEWER: '뷰어',
}

/* ── API 실패 시 폴백 메뉴 ── */

const FALLBACK_MENUS: NavItem[] = [
  { id: 0, menuKey: 'hospitals', label: '병원 목록', href: '/hospitals', iconKey: 'hospital', parentKey: null, allowedRoles: [], allowedOrgCodes: [], sortOrder: 20 },
  { id: 0, menuKey: 'projects', label: '프로젝트 관리', href: '/projects', iconKey: 'project', parentKey: null, allowedRoles: [], allowedOrgCodes: [], sortOrder: 30 },
  { id: 0, menuKey: 'install-plans', label: '설치계획(가안) 관리', href: '/install-plans', iconKey: 'file-text', parentKey: null, allowedRoles: [], allowedOrgCodes: [], sortOrder: 40 },
  { id: 0, menuKey: 'site-visits', label: '답사 관리', href: '/site-visits', iconKey: 'site-visit', parentKey: null, allowedRoles: [], allowedOrgCodes: [], sortOrder: 50 },
  { id: 0, menuKey: 'ai-assistant', label: 'AI 어시스턴트', href: '/ai-assistant', iconKey: 'bot', parentKey: null, allowedRoles: [], allowedOrgCodes: [], sortOrder: 60 },
  { id: 0, menuKey: 'settings', label: '설정', href: '/settings', iconKey: 'settings', parentKey: null, allowedRoles: [], allowedOrgCodes: [], sortOrder: 70 },
  { id: 0, menuKey: 'users', label: '계정 관리', href: '/users', iconKey: 'users', parentKey: null, allowedRoles: [], allowedOrgCodes: [], sortOrder: 80 },
  { id: 0, menuKey: 'settings/nav-menus', label: '메뉴 관리', href: '/settings/nav-menus', iconKey: null, parentKey: 'settings', allowedRoles: ['SUPER_ADMIN'], allowedOrgCodes: [], sortOrder: 5 },
  { id: 0, menuKey: 'settings/profile', label: '내 프로필', href: '/settings/profile', iconKey: null, parentKey: 'settings', allowedRoles: [], allowedOrgCodes: [], sortOrder: 50 },
]

/* ── 메뉴 노출 여부 판단 ── */

function isMenuVisible(item: NavItem, role: UserRole | null, orgCode: string | null): boolean {
  if (!role) return false
  if (item.allowedRoles.length > 0 && !item.allowedRoles.includes(role)) return false
  if (item.allowedOrgCodes.length > 0) {
    if (!orgCode || !item.allowedOrgCodes.includes(orgCode)) return false
  }
  return true
}

/* ── Navigation 컴포넌트 ── */

export default function Navigation() {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(pathname.startsWith('/settings'))
  const [userRole, setUserRole] = useState<UserRole | null>(null)
  const [userName, setUserName] = useState('')
  const [userOrgCode, setUserOrgCode] = useState<string | null>(null)
  const [menuItems, setMenuItems] = useState<NavItem[]>([])
  const [menuLoaded, setMenuLoaded] = useState(false)
  const menuFetched = useRef(false)

  // 사용자 정보 로드
  useEffect(() => {
    if (pathname === '/login') return
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => {
        if (data?.role) {
          setUserRole(data.role)
          setUserName(data.name)
          setUserOrgCode(data.organization?.code ?? null)
        } else {
          setUserRole(null)
          setUserName('')
          setUserOrgCode(null)
        }
      })
      .catch(() => {})
  }, [pathname])

  // 메뉴 데이터 로드 (최초 1회)
  useEffect(() => {
    if (pathname === '/login' || menuFetched.current) return
    menuFetched.current = true
    fetch('/api/nav-menus')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { setMenuItems(data.items); setMenuLoaded(true) })
      .catch(() => { setMenuItems(FALLBACK_MENUS); setMenuLoaded(true) })
  }, [pathname])

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    if (pathname.startsWith('/settings')) setSettingsOpen(true)
  }, [pathname])

  // 로그인·사이니지 대시보드는 네비게이션 없이 전체 화면 사용
  if (pathname === '/login' || pathname === '/dashboard') return null

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/')
  }

  const navItemClass = (active: boolean) =>
    `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
      active
        ? 'bg-primary-subtle text-primary-subtle-foreground font-medium'
        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
    }`

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  // 메뉴 분류
  const topLevelItems = menuItems
    .filter(i => i.parentKey === null && i.menuKey !== 'settings' && i.menuKey !== 'users')
    .filter(i => isMenuVisible(i, userRole, userOrgCode))
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const settingsGroup = menuItems.find(i => i.menuKey === 'settings')
  const settingsVisible = settingsGroup && isMenuVisible(settingsGroup, userRole, userOrgCode)
  const settingsChildren = menuItems
    .filter(i => i.parentKey === 'settings')
    .filter(i => isMenuVisible(i, userRole, userOrgCode))
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const usersItem = menuItems.find(i => i.menuKey === 'users')
  const usersVisible = usersItem && isMenuVisible(usersItem, userRole, userOrgCode)

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* 로고 */}
      <div className="flex h-14 shrink-0 items-center border-b border-border px-5">
        <Link href="/" className="text-base font-bold tracking-tight text-foreground hover:text-primary transition-colors">{process.env.NEXT_PUBLIC_APP_NAME}</Link>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {!menuLoaded ? (
          /* 스켈레톤 */
          <div className="space-y-2">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="h-8 rounded-md bg-muted animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {/* 최상위 메뉴 */}
            {topLevelItems.map(item => (
              <Link key={item.menuKey} href={item.href} className={navItemClass(isActive(item.href))}>
                {getMenuIcon(item.iconKey)}
                {item.label}
              </Link>
            ))}

            {/* 설정 아코디언 */}
            {settingsVisible && settingsChildren.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setSettingsOpen((v) => !v)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                    pathname.startsWith('/settings')
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  {getMenuIcon(settingsGroup!.iconKey)}
                  <span className="flex-1 text-left">{settingsGroup!.label}</span>
                  <ChevronIcon open={settingsOpen} />
                </button>

                {settingsOpen && (
                  <div className="ml-7 mt-0.5 space-y-0.5 border-l border-border pl-3">
                    {settingsChildren.map(child => (
                      <Link key={child.menuKey} href={child.href} className={navItemClass(isActive(child.href))}>
                        {getMenuIcon(child.iconKey)}
                        {child.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 계정 관리 */}
            {usersVisible && usersItem && (
              <Link href={usersItem.href} className={navItemClass(isActive(usersItem.href))}>
                {getMenuIcon(usersItem.iconKey)}
                {usersItem.label}
              </Link>
            )}
          </>
        )}
      </nav>

      {/* 하단 사용자 정보 + 로그아웃 */}
      <div className="shrink-0 border-t border-border p-3">
        <div className="mb-2 flex items-center justify-between gap-2 px-3 py-1">
          {userName ? (
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{userName}</p>
              <p className="text-xs text-muted-foreground">
                {userRole ? ROLE_LABEL[userRole] : ''}
              </p>
            </div>
          ) : <span />}
          <ThemeToggle className="shrink-0" />
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
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
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-border bg-card lg:flex">
        {sidebarContent}
      </aside>

      {/* 모바일 상단 헤더 */}
      <header className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-card px-4 lg:hidden">
        <Link href="/" className="text-base font-bold tracking-tight text-foreground hover:text-primary transition-colors">{process.env.NEXT_PUBLIC_APP_NAME}</Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <MenuIcon />
          </button>
        </div>
      </header>

      {/* 모바일 드로어 */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-foreground/40 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-card lg:hidden">
            <div className="absolute right-3 top-3">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
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
