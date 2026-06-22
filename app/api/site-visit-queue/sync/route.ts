import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, isUserOrAbove } from '@/lib/auth'
import { syncSiteVisitMails } from '@/lib/mail-sync'

export async function POST(request: NextRequest) {
  // 인증: JWT 쿠키 또는 CRON_SECRET Bearer
  const token = request.cookies.get('auth-token')?.value
  const authHeader = request.headers.get('authorization')
  let authenticated = false

  if (token) {
    const user = await verifyToken(token)
    if (user && isUserOrAbove(user.role)) {
      authenticated = true
    }
  }

  if (!authenticated && authHeader) {
    const bearer = authHeader.replace('Bearer ', '')
    if (bearer && bearer === process.env.CRON_SECRET) {
      authenticated = true
    }
  }

  if (!authenticated) {
    return NextResponse.json({ error: '인증 필요' }, { status: 401 })
  }

  try {
    const { newCount, total } = await syncSiteVisitMails()
    return NextResponse.json({ success: true, newCount, total })
  } catch (err) {
    console.error('[site-visit-queue/sync] 동기화 실패:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '동기화 실패' },
      { status: 500 }
    )
  }
}
