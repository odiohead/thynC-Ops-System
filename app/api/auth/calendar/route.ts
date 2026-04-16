import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { verifyToken, isSuperAdmin } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const token = request.cookies.get('auth-token')?.value
  if (!token) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const user = await verifyToken(token)
  if (!user || !isSuperAdmin(user.role)) {
    return NextResponse.json({ error: '권한 없음' }, { status: 403 })
  }

  const redirectUri = process.env.NEXT_PUBLIC_APP_URL + '/api/auth/calendar/callback'

  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    redirectUri
  )

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar'],
  })

  return NextResponse.redirect(authUrl)
}
