import { google } from 'googleapis'
import { prisma } from '@/lib/prisma'

async function getCalendarClient() {
  const setting = await prisma.appSetting.findUnique({
    where: { key: 'google_calendar_refresh_token' },
  })

  if (!setting?.value) {
    throw new Error('Google Calendar refresh_token이 설정되지 않았습니다.')
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  )
  oauth2Client.setCredentials({ refresh_token: setting.value })

  return google.calendar({ version: 'v3', auth: oauth2Client })
}

/** 캘린더 종류별 환경변수 매핑 */
type CalendarType = 'project' | 'maintenance' | 'site-visit'

function getCalendarId(type: CalendarType): string {
  const envMap: Record<CalendarType, string> = {
    'project': 'GOOGLE_CALENDAR_PROJECT_ID',
    'maintenance': 'GOOGLE_CALENDAR_MAINTENANCE_ID',
    'site-visit': 'GOOGLE_CALENDAR_SITE_VISIT_ID',
  }
  const envKey = envMap[type]
  const id = process.env[envKey]
  if (!id) throw new Error(`${envKey} 환경변수가 설정되지 않았습니다.`)
  return id
}

/** All-day 이벤트용 날짜 포맷 (YYYY-MM-DD) */
function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Google Calendar all-day 이벤트 end는 exclusive이므로 +1일 */
function addOneDay(dateStr: string): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + 1)
  return formatDate(d)
}

interface CalendarEventData {
  summary: string
  description: string
  startDate: Date
  endDate?: Date | null
  attendeeEmails?: string[]
}

/**
 * Google Calendar 이벤트 생성
 * @returns eventId (실패 시 null)
 */
export async function createCalendarEvent(
  type: CalendarType,
  data: CalendarEventData
): Promise<string | null> {
  try {
    const calendar = await getCalendarClient()
    const calendarId = getCalendarId(type)

    const startDate = formatDate(data.startDate)
    const endDate = data.endDate
      ? addOneDay(formatDate(data.endDate))
      : addOneDay(startDate)

    const attendees = (data.attendeeEmails ?? [])
      .filter(e => e)
      .map(email => ({ email }))

    const res = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: data.summary,
        description: data.description,
        start: { date: startDate },
        end: { date: endDate },
        ...(attendees.length > 0 ? { attendees } : {}),
      },
    })

    return res.data.id ?? null
  } catch (err) {
    console.error(`[Calendar:${type}] createCalendarEvent failed:`, err)
    return null
  }
}

/**
 * Google Calendar 이벤트 수정
 */
export async function updateCalendarEvent(
  type: CalendarType,
  eventId: string,
  data: CalendarEventData
): Promise<void> {
  try {
    const calendar = await getCalendarClient()
    const calendarId = getCalendarId(type)

    const startDate = formatDate(data.startDate)
    const endDate = data.endDate
      ? addOneDay(formatDate(data.endDate))
      : addOneDay(startDate)

    const attendees = (data.attendeeEmails ?? [])
      .filter(e => e)
      .map(email => ({ email }))

    await calendar.events.update({
      calendarId,
      eventId,
      requestBody: {
        summary: data.summary,
        description: data.description,
        start: { date: startDate },
        end: { date: endDate },
        attendees,
      },
    })
  } catch (err) {
    console.error(`[Calendar:${type}] updateCalendarEvent failed:`, err)
  }
}

/**
 * Google Calendar 이벤트 삭제
 */
export async function deleteCalendarEvent(
  type: CalendarType,
  eventId: string
): Promise<void> {
  try {
    const calendar = await getCalendarClient()
    const calendarId = getCalendarId(type)

    await calendar.events.delete({ calendarId, eventId })
  } catch (err) {
    console.error(`[Calendar:${type}] deleteCalendarEvent failed:`, err)
  }
}
