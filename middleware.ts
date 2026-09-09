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
    pathname.startsWith('/_next') ||
    pathname.startsWith('/fonts') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  const token = req.cookies.get('auth-token')?.value
  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const payload = await verifyToken(token)
  if (!payload || !payload.isActive) {
    const res = NextResponse.redirect(new URL('/login', req.url))
    res.cookies.delete('auth-token')
    return res
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
