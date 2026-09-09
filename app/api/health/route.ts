import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health — 무인증 생존 확인 (사이니지 /dashboard 자동 복구 폴링용)
 * DB를 건드리지 않고 앱 프로세스 응답 여부만 알린다. middleware 공개 경로.
 */
export function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() }, { headers: { 'Cache-Control': 'no-store' } })
}
