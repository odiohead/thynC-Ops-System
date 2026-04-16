import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  if (!code) {
    return NextResponse.json({ error: 'code 파라미터가 필요합니다.' }, { status: 400 })
  }

  const redirectUri = process.env.NEXT_PUBLIC_APP_URL + '/api/auth/calendar/callback'

  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    redirectUri
  )

  try {
    const { tokens } = await oauth2Client.getToken(code)

    if (!tokens.refresh_token) {
      return NextResponse.json({
        error: 'refresh_token이 발급되지 않았습니다. Google 계정에서 앱 액세스 권한을 제거한 후 다시 시도하세요.',
      }, { status: 400 })
    }

    // app_settings 테이블에 저장
    await prisma.appSetting.upsert({
      where: { key: 'google_calendar_refresh_token' },
      update: { value: tokens.refresh_token },
      create: { key: 'google_calendar_refresh_token', value: tokens.refresh_token },
    })

    return NextResponse.json({
      message: 'Google Calendar 연동이 완료되었습니다. refresh_token이 DB에 저장되었습니다.',
    })
  } catch (err) {
    console.error('Calendar OAuth callback error:', err)
    return NextResponse.json({ error: 'OAuth 토큰 교환 실패' }, { status: 500 })
  }
}
