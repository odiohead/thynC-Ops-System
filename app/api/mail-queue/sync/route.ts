import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, isAdminOrAbove } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getGmailClient, extractHtmlBody, parseFormEmail, parseKstDate } from '@/lib/gmail'

export async function POST(request: NextRequest) {
  // 인증: JWT 쿠키 또는 CRON_SECRET Bearer
  const token = request.cookies.get('auth-token')?.value
  const authHeader = request.headers.get('authorization')
  let authenticated = false

  if (token) {
    const user = await verifyToken(token)
    if (user && isAdminOrAbove(user.role)) {
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

  const gmail = getGmailClient()
  const senderEmails = (process.env.GMAIL_SENDER_EMAIL || '').split(',').map((e) => e.trim()).filter(Boolean)
  const subjectKeyword = process.env.GMAIL_SUBJECT_KEYWORD || ''

  // 최근 1주일치만 조회
  const oneWeekAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000)
  const fromQuery = senderEmails.length > 1
    ? `from:(${senderEmails.join(' OR ')})`
    : `from:${senderEmails[0] || ''}`
  const query = `${fromQuery} subject:${subjectKeyword} after:${oneWeekAgo}`

  const messages: { id: string }[] = []
  let pageToken: string | undefined
  do {
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 100,
      pageToken,
    })
    if (listRes.data.messages) {
      messages.push(...(listRes.data.messages as { id: string }[]))
    }
    pageToken = listRes.data.nextPageToken ?? undefined
  } while (pageToken)

  let newCount = 0

  for (const msg of messages) {
    try {
      if (!msg.id) continue

      const existing = await prisma.installPlanQueue.findUnique({
        where: { gmailMessageId: msg.id },
      })
      if (existing) continue

      const fullMsg = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      })

      const payload = fullMsg.data.payload
      if (!payload) continue

      const html = extractHtmlBody(payload)
      const parsed = parseFormEmail(html)

      const headers = payload.headers || []
      const dateHeader = headers.find((h) => h.name === 'Date')?.value || ''
      const receivedAt = dateHeader ? new Date(dateHeader) : new Date()

      const requestDate = parsed.requestDateRaw
        ? parseKstDate(parsed.requestDateRaw)
        : null

      await prisma.installPlanQueue.create({
        data: {
          gmailMessageId: msg.id,
          receivedAt,
          hospitalNameRaw: parsed.hospitalName,
          requestDate,
          managerName: parsed.managerName,
          managerPhone: parsed.managerPhone,
          managerEmail: parsed.managerEmail,
          totalBeds: parsed.totalBeds,
          address: parsed.address,
          model: parsed.model,
          rawBody: html,
          fileUrl: parsed.fileUrl,
          status: 'pending',
        },
      })
      newCount++
    } catch (err) {
      console.error(`[mail-queue/sync] 메시지 처리 실패 (id: ${msg.id}):`, err)
    }
  }

  const total = await prisma.installPlanQueue.count()

  // 마지막 동기화 시간 기록
  await prisma.appSetting.upsert({
    where: { key: 'mail_sync_last' },
    update: { value: new Date().toISOString() },
    create: { key: 'mail_sync_last', value: new Date().toISOString() },
  })

  return NextResponse.json({ success: true, newCount, total })
}
