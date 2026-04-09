import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  if (!code) {
    return NextResponse.json({ error: 'code 파라미터가 필요합니다.' }, { status: 400 })
  }

  const redirectUri = process.env.NEXT_PUBLIC_APP_URL + '/api/auth/gmail/callback'

  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    redirectUri
  )

  const { tokens } = await oauth2Client.getToken(code)

  return NextResponse.json({
    message: '아래 refresh_token 값을 .env의 GMAIL_REFRESH_TOKEN에 저장 후 pm2 restart thync-dev 하세요.',
    refresh_token: tokens.refresh_token,
  })
}
