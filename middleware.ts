import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // 공개 경로 제외
  if (
    pathname === '/login' ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/mail-queue') ||
    pathname === '/api/health' ||           // 사이니지 생존 확인 (무인증)
    pathname === '/sw.js' ||                // 사이니지 서비스 워커
    pathname === '/dashboard-offline.html' || // 사이니지 오프라인 폴백 페이지
    pathname === '/m/login' ||              // 모바일 앱 로그인 (앱 범위 안 — mobile_pwa_design.md §3.3)
    pathname === '/manifest.webmanifest' || // PWA manifest
    pathname === '/m-sw.js' ||              // 모바일 앱 서비스 워커 (scope /m/)
    pathname === '/m-offline.html' ||       // 모바일 앱 오프라인 안내
    pathname.startsWith('/icons/') ||       // 앱 아이콘
    pathname.startsWith('/vendor/') ||      // 바코드 스캔 엔진(wasm) 등 정적 자원
    pathname.startsWith('/_next') ||
    pathname.startsWith('/fonts') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  // 모바일 앱(/m/*)은 앱 범위 안 로그인으로 — iOS 홈 화면 앱이 범위 밖 /login 으로 나가면 쿠키가 분리될 수 있음
  const isMobileApp = pathname === '/m' || pathname.startsWith('/m/')
  const loginUrl = () => {
    if (!isMobileApp) return new URL('/login', req.url)
    const u = new URL('/m/login', req.url)
    if (pathname.startsWith('/m/')) u.searchParams.set('next', pathname + req.nextUrl.search)
    return u
  }

  const token = req.cookies.get('auth-token')?.value
  if (!token) {
    return NextResponse.redirect(loginUrl())
  }

  const payload = await verifyToken(token)
  if (!payload || !payload.isActive) {
    const res = NextResponse.redirect(loginUrl())
    res.cookies.delete('auth-token')
    return res
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
