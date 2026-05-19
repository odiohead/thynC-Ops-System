import { prisma } from '@/lib/prisma'
import { getGmailClient, extractHtmlBody, parseFormEmail, parseKstDate } from '@/lib/gmail'

export interface SyncResult {
  newCount: number
  total: number
}

async function listMessages(
  gmail: ReturnType<typeof getGmailClient>,
  query: string,
): Promise<{ id: string }[]> {
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
  return messages
}

function buildQuery(senderEmails: string[], subjectKeyword: string): string {
  const oneWeekAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000)
  const fromQuery = senderEmails.length > 1
    ? `from:(${senderEmails.join(' OR ')})`
    : `from:${senderEmails[0] || ''}`
  return `${fromQuery} subject:${subjectKeyword} after:${oneWeekAgo}`
}

export async function syncInstallPlanMails(): Promise<SyncResult> {
  const gmail = getGmailClient()
  const senderEmails = (process.env.GMAIL_SENDER_EMAIL || '').split(',').map((e) => e.trim()).filter(Boolean)
  const subjectKeyword = process.env.GMAIL_SUBJECT_KEYWORD || ''

  const query = buildQuery(senderEmails, subjectKeyword)
  const messages = await listMessages(gmail, query)

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
      console.error(`[mail-sync/install-plan] 메시지 처리 실패 (id: ${msg.id}):`, err)
    }
  }

  const total = await prisma.installPlanQueue.count()

  const nowIso = new Date().toISOString()
  await prisma.appSetting.upsert({
    where: { key: 'mail_sync_last_install_plan' },
    update: { value: nowIso },
    create: { key: 'mail_sync_last_install_plan', value: nowIso },
  })
  await prisma.appSetting.upsert({
    where: { key: 'mail_sync_last' },
    update: { value: nowIso },
    create: { key: 'mail_sync_last', value: nowIso },
  })

  return { newCount, total }
}

export async function syncSiteVisitMails(): Promise<SyncResult> {
  const gmail = getGmailClient()
  const senderEmails = (process.env.GMAIL_SV_SENDER_EMAIL || '').split(',').map((e) => e.trim()).filter(Boolean)
  const subjectKeyword = process.env.GMAIL_SV_SUBJECT_KEYWORD || ''

  if (senderEmails.length === 0 || !subjectKeyword) {
    throw new Error('답사 메일 환경변수가 설정되지 않았습니다. (GMAIL_SV_SENDER_EMAIL / GMAIL_SV_SUBJECT_KEYWORD)')
  }

  const query = buildQuery(senderEmails, subjectKeyword)
  const messages = await listMessages(gmail, query)

  let newCount = 0

  for (const msg of messages) {
    try {
      if (!msg.id) continue

      const existing = await prisma.siteVisitQueue.findUnique({
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

      await prisma.siteVisitQueue.create({
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
      console.error(`[mail-sync/site-visit] 메시지 처리 실패 (id: ${msg.id}):`, err)
    }
  }

  const total = await prisma.siteVisitQueue.count()

  const nowIso = new Date().toISOString()
  await prisma.appSetting.upsert({
    where: { key: 'mail_sync_last_site_visit' },
    update: { value: nowIso },
    create: { key: 'mail_sync_last_site_visit', value: nowIso },
  })

  return { newCount, total }
}
