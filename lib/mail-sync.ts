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

/**
 * 내용 기준 중복 판정 (2026-10-14) — 폼 알림이 수신자 2곳(thync_request@seers·thync_team@daewoong)으로 발송돼
 * 같은 응답이 Gmail 메시지 2통(ID 상이)으로 들어오는 문제. 거래처명·담당자 이메일·등록시각이 같은 큐 항목이 있으면 같은 요청으로 본다.
 * 등록시각을 못 읽은 메일은 수신시각 ±5분으로 대체 판정. 상태(대기·등록·무시) 무관.
 */
const DUP_WINDOW_MS = 5 * 60 * 1000
function contentDupWhere(p: { hospitalNameRaw: string; managerEmail: string; requestDate: Date | null; receivedAt: Date }) {
  return {
    hospitalNameRaw: p.hospitalNameRaw,
    managerEmail: p.managerEmail,
    ...(p.requestDate
      ? { requestDate: p.requestDate }
      : { receivedAt: { gte: new Date(p.receivedAt.getTime() - DUP_WINDOW_MS), lte: new Date(p.receivedAt.getTime() + DUP_WINDOW_MS) } }),
  }
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

      const dup = await prisma.installPlanQueue.findFirst({
        where: contentDupWhere({ hospitalNameRaw: parsed.hospitalName, managerEmail: parsed.managerEmail, requestDate, receivedAt }),
        select: { id: true },
      })
      if (dup) {
        console.log(`[mail-sync/install-plan] 같은 요청의 중복 메일 건너뜀 (id: ${msg.id} → 큐 #${dup.id}, ${parsed.hospitalName})`)
        continue
      }

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

      const dup = await prisma.siteVisitQueue.findFirst({
        where: contentDupWhere({ hospitalNameRaw: parsed.hospitalName, managerEmail: parsed.managerEmail, requestDate, receivedAt }),
        select: { id: true },
      })
      if (dup) {
        console.log(`[mail-sync/site-visit] 같은 요청의 중복 메일 건너뜀 (id: ${msg.id} → 큐 #${dup.id}, ${parsed.hospitalName})`)
        continue
      }

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
