/**
 * 알림 정책·로그 레이어 (P11 — 티켓 이벤트 전면 전환, ticket_dev_schedule.md)
 *
 * 이벤트 소스 = 티켓 레이어 단일 파이프라인:
 *   티켓 mutation(티켓 라우트·도메인 동기화) → notifyTicketCreated/notifyTicketChanged
 *   → 설정 확인 → 메시지 발송(lib/slack) → notification_logs 기록.
 * 도메인 라우트의 직접 알림 호출은 P11에서 제거됨(이중 발송 방지 규칙 자연 소멸).
 * 이 파일의 모든 export는 절대 throw하지 않는다 (호출부 API mutation을 깨면 안 됨).
 *
 * 상태 시그니처(sig) v2: `v2|status|ownerId|severity|queueId` — 직전 발송 로그와
 * 비교해 실제로 바뀐 축(상태/배정/Sev/큐)만 골라 발송한다. refCode는 ticketCode 통일.
 * Sev1 = :rotating_light: + <!channel>, Sev2 = :fire: + 큐 멤버 멘션 (P11 확정).
 */

import { Prisma, TicketSeverity, TicketStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSlackMode, resolveTargetChannel, slackPostMessage, slackLookupUserByEmail } from '@/lib/slack'
import { FIELD_CATALOG, DEFAULT_FIELDS, TASK_TYPE_LABELS, TASK_TYPES, refTypeToTaskType } from '@/lib/notifyFields'
import { summarizeStockOutItems } from '@/lib/stockOut'
import { TICKET_STATUS_LABELS, TICKET_SEVERITY_LABELS, PERSONAL_QUEUE_NAME } from '@/lib/ticket-shared'
import { resolveChannels, type NotifyRouteEvent, type ResolvedChannel } from '@/lib/notify-routes'
import { emitNotification, ticketRecipients, queueMemberIds } from '@/lib/notify-center'

export type NotifyEventType = 'task_created' | 'task_status_changed' | 'delayed' | 'ticket_assigned'
type NotifyStatus = 'sent' | 'failed' | 'skipped'
type TargetType = 'channel' | 'dm'

interface LogEntry {
  eventType: NotifyEventType
  taskType?: string | null
  refCode?: string | null
  targetType: TargetType
  targetId: string
  status: NotifyStatus
  error?: string
  payload?: Record<string, unknown>
}

/** notification_logs 기록 (실패해도 삼킴) */
async function recordLog(entry: LogEntry): Promise<void> {
  try {
    await prisma.notificationLog.create({
      data: {
        eventType: entry.eventType,
        taskType: entry.taskType ?? null,
        refCode: entry.refCode ?? null,
        targetType: entry.targetType,
        targetId: entry.targetId,
        status: entry.status,
        error: entry.error ?? null,
        payload: entry.payload ? (entry.payload as Prisma.InputJsonValue) : undefined,
      },
    })
  } catch (err) {
    console.error('[notify] notification_logs 기록 실패:', err)
  }
}

interface ChannelDispatch {
  intendedChannel: string
  /** 라우팅으로 결정된 채널일 때 — 로그 payload에 규칙 추적 정보를 남긴다 */
  routeIds?: number[]
  channelName?: string
  /** DAILY_DIGEST 발송 로그 표식 — "오늘 이 규칙으로 이미 보냈는가" 판정 근거 (1.1 P4) */
  digestRouteId?: number
  eventType: NotifyEventType
  taskType?: string | null
  refCode?: string | null
  text: string
  blocks?: unknown[]
  sig?: string | null // 상태 시그니처(변경 감지·비교용, payload에 기록)
}

/**
 * 채널 발송 코어. 모드(off/test/live) 라우팅 → 발송 → 로그.
 * - off: 미발송, skipped 로그
 * - test: 테스트 채널로 라우팅 + `[DEV]` prefix
 * - live: 의도한 채널로
 * AppSetting(notify_enabled 등) 기능 토글은 상위 이벤트 함수에서 확인한다.
 */
export async function dispatchToChannel(d: ChannelDispatch): Promise<void> {
  try {
    const mode = getSlackMode()
    if (mode === 'off') {
      await recordLog({
        eventType: d.eventType,
        taskType: d.taskType,
        refCode: d.refCode,
        targetType: 'channel',
        targetId: d.intendedChannel || '(none)',
        status: 'skipped',
        error: 'mode_off',
      })
      return
    }

    const channel = resolveTargetChannel(d.intendedChannel)
    if (!channel) {
      await recordLog({
        eventType: d.eventType,
        taskType: d.taskType,
        refCode: d.refCode,
        targetType: 'channel',
        targetId: d.intendedChannel || '(none)',
        status: 'skipped',
        error: 'no_channel',
      })
      return
    }

    // test 모드 표식: 원래 갈 채널명을 병기해 라우팅 검증이 테스트 채널만으로 가능하게 (v2 P2)
    const devTag = d.channelName ? `[DEV→#${d.channelName}]` : '[DEV]'
    const devText = mode === 'test' ? `${devTag} ${d.text}` : d.text
    let blocks = d.blocks
    if (mode === 'test' && Array.isArray(blocks) && blocks.length > 0) {
      blocks = blocks.map((b, i) => {
        if (i !== 0) return b
        const bb = b as { text?: { text?: string } }
        return bb?.text?.text ? { ...bb, text: { ...bb.text, text: `${devTag} ${bb.text.text}` } } : b
      })
    }
    const res = await slackPostMessage(channel, { text: devText, blocks })

    const bodyPreview = Array.isArray(blocks) && blocks.length
      ? (blocks as { text?: { text?: string } }[]).map((b) => b?.text?.text).filter(Boolean).join('\n')
      : devText

    await recordLog({
      eventType: d.eventType,
      taskType: d.taskType,
      refCode: d.refCode,
      targetType: 'channel',
      targetId: channel,
      status: res.ok ? 'sent' : res.skipped ? 'skipped' : 'failed',
      error: res.error,
      payload: {
        mode, textPreview: bodyPreview.slice(0, 400), sig: d.sig ?? null,
        ...(d.routeIds ? { routeIds: d.routeIds } : {}),
        ...(d.channelName ? { channelName: d.channelName } : {}),
        ...(d.digestRouteId != null ? { digestRouteId: d.digestRouteId } : {}),
      },
    })
  } catch (err) {
    console.error('[notify] dispatchToChannel 예외:', err)
  }
}

/**
 * 라우팅 규칙으로 결정된 채널 전부에 발송 (1.1 P3).
 * - 매칭 규칙 0건이면 미발송 + `no_route` 스킵 로그(조용한 실패가 아니라 근거를 남긴다)
 * - 멘션은 채널별 mention_mode에 따라 본문 마지막 줄에 덧붙인다(전역 킬스위치 통과 시에만)
 * `render(mentionLine)`은 채널별 멘션 문구를 받아 메시지를 만드는 콜백.
 */
async function dispatchToRoutes(args: {
  eventTypes: NotifyRouteEvent[]
  match: Parameters<typeof resolveChannels>[1]
  eventType: NotifyEventType
  taskType?: string | null
  refCode?: string | null
  sig?: string | null
  queueId?: number
  queueName?: string
  render: (mentionLine: string | null) => { text: string; blocks: unknown[] }
}): Promise<number> {
  const channels = args.eventTypes.length > 0 ? await resolveChannels(args.eventTypes, args.match) : []

  // 그룹 알림 채널 병합 (v2 P2) — 라우팅 규칙과 같은 채널이면 1건, 다르면 추가 발송.
  // '개인 업무' 그룹은 호출부에서 이미 걸러진다.
  if (args.queueId != null) {
    const qch = await queueNotifyChannel(args.queueId)
    if (qch && !channels.some((c) => c.slackChannelId === qch.slackChannelId)) channels.push(qch)
  }

  if (channels.length === 0) {
    await recordLog({
      eventType: args.eventType,
      taskType: args.taskType,
      refCode: args.refCode,
      targetType: 'channel',
      targetId: '(no-route)',
      status: 'skipped',
      error: 'no_route',
      payload: { sig: args.sig ?? null, eventTypes: args.eventTypes },
    })
    return 0
  }

  for (const ch of channels) {
    const mentionLine = await buildMentionLine(ch, args.queueId, args.queueName)
    const { text, blocks } = args.render(mentionLine)
    await dispatchToChannel({
      intendedChannel: ch.slackChannelId,
      channelName: ch.channelName,
      routeIds: ch.routeIds,
      eventType: args.eventType,
      taskType: args.taskType,
      refCode: args.refCode,
      text,
      blocks,
      sig: args.sig ?? null,
    })
  }
  return channels.length
}

/** 큐의 알림 채널 (v2 P2 — TicketQueue.notifyChannelId). 없으면 null */
async function queueNotifyChannel(queueId: number): Promise<ResolvedChannel | null> {
  try {
    const q = await prisma.ticketQueue.findUnique({
      where: { id: queueId },
      select: { notifyChannel: { select: { id: true, name: true, slackChannelId: true, isActive: true } } },
    })
    if (!q?.notifyChannel || !q.notifyChannel.isActive) return null
    return {
      channelId: q.notifyChannel.id,
      channelName: q.notifyChannel.name,
      slackChannelId: q.notifyChannel.slackChannelId,
      mentionMode: 'none',
      routeIds: [],
    }
  } catch (err) {
    console.error('[notify] queueNotifyChannel 조회 실패:', err)
    return null
  }
}

/** 채널의 mention_mode → 멘션 문구. 전역 토글(notify_queue_mentions·notify_sev1_channel)이 킬스위치로 남는다 */
async function buildMentionLine(ch: ResolvedChannel, queueId?: number, queueName?: string): Promise<string | null> {
  switch (ch.mentionMode) {
    case 'channel':
      return (await sev1ChannelOn()) ? '<!channel>' : null
    case 'here':
      return (await sev1ChannelOn()) ? '<!here>' : null
    case 'queue_members': {
      if (queueId == null || !(await queueMentionsOn())) return null
      const m = await queueMemberMentions(queueId)
      return m ? `${queueName ?? 'Assignment Group'}: ${m}` : null
    }
    default:
      return null
  }
}

// ─────────────────────────────────────────────────────────────
// 설정 게이트
// ─────────────────────────────────────────────────────────────

export type TaskType = 'PROJECT' | 'SITE_VISIT' | 'INSTALL_PLAN' | 'MAINTENANCE' | 'ETC' | 'VOC' | 'STOCK_OUT' | 'TICKET'

/** 업무 타입별 Slack 사용 여부 (notify_types_enabled, 기본 전부 on). 이벤트·지연·DM 모두 이 게이트 적용 */
export async function getTypesEnabled(): Promise<Record<TaskType, boolean>> {
  const result = {} as Record<TaskType, boolean>
  for (const t of TASK_TYPES) result[t] = true
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'notify_types_enabled' } })
    if (row?.value) {
      const parsed = JSON.parse(row.value) as Partial<Record<TaskType, boolean>>
      for (const t of TASK_TYPES) if (parsed[t] === false) result[t] = false
    }
  } catch (err) {
    console.error('[notify] notify_types_enabled 파싱 실패:', err)
  }
  return result
}

async function typeEnabled(taskType: TaskType): Promise<boolean> {
  return (await getTypesEnabled())[taskType]
}

/** AppSetting 이벤트 알림 게이트: notify_enabled(기본 off) && notify_events_enabled(기본 on) */
async function eventsEnabled(): Promise<boolean> {
  try {
    const rows = await prisma.appSetting.findMany({
      where: { key: { in: ['notify_enabled', 'notify_events_enabled'] } },
    })
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    const globalOn = (map['notify_enabled'] ?? 'off') === 'on'
    const eventsOn = (map['notify_events_enabled'] ?? 'on') !== 'off'
    return globalOn && eventsOn
  } catch (err) {
    console.error('[notify] eventsEnabled 조회 실패:', err)
    return false
  }
}

/** 티켓 이벤트별 채널 알림 토글 (notify_event_toggles, 기본 전부 on) — 설정 화면에서 세분 제어 */
export interface TicketEventToggles {
  created: boolean
  statusChanged: boolean
  queueTransferred: boolean
  sevEscalated: boolean
  assigned: boolean // v2 P2 — 담당자 배정 채널 알림 (구 배정 DM 대체)
}

const DEFAULT_EVENT_TOGGLES: TicketEventToggles = { created: true, statusChanged: true, queueTransferred: true, sevEscalated: true, assigned: true }

export async function getEventToggles(): Promise<TicketEventToggles> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'notify_event_toggles' } })
    if (row?.value) {
      const p = JSON.parse(row.value) as Partial<TicketEventToggles>
      return {
        created: p.created !== false,
        statusChanged: p.statusChanged !== false,
        queueTransferred: p.queueTransferred !== false,
        sevEscalated: p.sevEscalated !== false,
        assigned: p.assigned !== false,
      }
    }
  } catch (err) {
    console.error('[notify] notify_event_toggles 파싱 실패:', err)
  }
  return DEFAULT_EVENT_TOGGLES
}

/** 큐 멤버 멘션 사용 여부 (notify_queue_mentions, 기본 on) */
async function queueMentionsOn(): Promise<boolean> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'notify_queue_mentions' } })
    return (row?.value ?? 'on') !== 'off'
  } catch {
    return true
  }
}

/** Sev1 @channel 전체 멘션 사용 여부 (notify_sev1_channel, 기본 on — 이모지 강조는 항상 유지) */
async function sev1ChannelOn(): Promise<boolean> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'notify_sev1_channel' } })
    return (row?.value ?? 'on') !== 'off'
  } catch {
    return true
  }
}

// ─────────────────────────────────────────────────────────────
// 도메인 필드 enrich (메시지 본문의 선택 필드 — FIELD_CATALOG 재사용)
// ─────────────────────────────────────────────────────────────

interface EnrichedTask {
  hospitalName: string | null
  title: string | null
  url: string
  fieldValues: Record<string, string> // 카탈로그 key → 표시 문자열 (값 있는 것만)
}

/** 담당자 enrich용 전체 필드 select (멘션 렌더링에 필요) */
const ASSIGNEE_FULL = { select: { user: { select: { id: true, name: true, email: true, slackUserId: true, slackNotifyEnabled: true } } } } as const

/**
 * 담당자 표시 — 계정 발송 플래그 on + Slack 매핑 성공이면 `<@ID>` 멘션(태그), 아니면 이름 텍스트 폴백.
 * 멘션은 개인 알림이 울리므로 slack_notify_enabled=false 계정은 태그하지 않는다.
 */
async function assigneeDisplay(arr: { user: AssigneeUser }[]): Promise<string | null> {
  if (!arr.length) return null
  const parts: string[] = []
  for (const { user: u } of arr) {
    if (u.slackNotifyEnabled) {
      const sid = await resolveSlackUserId(u)
      if (sid) {
        parts.push(`<@${sid}>`)
        continue
      }
    }
    parts.push(u.name)
  }
  return parts.join(', ')
}

const ymd = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null)

/** 방문일정/업무기간 요약: "07-03, 07-07~07-09 외 1건" */
function formatVisits(visits: { startDate: Date; endDate: Date }[]): string | null {
  if (!visits.length) return null
  const parts = visits.slice(0, 3).map((v) => {
    const s = v.startDate.toISOString().slice(5, 10)
    const e = v.endDate.toISOString().slice(5, 10)
    return s === e ? s : `${s}~${e}`
  })
  return parts.join(', ') + (visits.length > 3 ? ` 외 ${visits.length - 3}건` : '')
}

/**
 * (taskType, refCode)로 메시지 본문 필드를 조회. 대상 없으면 null.
 * fieldValues에는 카탈로그의 모든 후보 필드 중 값이 있는 것만 채운다(표시 여부는 설정이 결정).
 * 도메인 연결 티켓은 도메인 refCode, 순수 티켓은 ticketCode로 호출한다.
 */
async function enrichTask(taskType: TaskType, refCode: string): Promise<EnrichedTask | null> {
  const base = process.env.NEXT_PUBLIC_APP_URL || ''
  const fv: Record<string, string> = {}

  switch (taskType) {
    case 'PROJECT': {
      const p = await prisma.project.findUnique({
        where: { projectCode: refCode },
        select: {
          projectName: true, contractDate: true, startDate: true, endDateExpected: true,
          wardCount: true, bedCount: true, gatewayCount: true,
          hospital: { select: { hospitalName: true } },
          assignees: ASSIGNEE_FULL,
          introType: { select: { name: true } },
          buildStatus: { select: { label: true } },
          contractor: { select: { name: true } },
        },
      })
      if (!p) return null
      const asn = await assigneeDisplay(p.assignees)
      if (asn) fv.assignees = asn
      if (p.buildStatus?.label) fv.buildStatus = p.buildStatus.label
      if (p.contractDate) fv.contractDate = ymd(p.contractDate)!
      if (p.introType?.name) fv.introType = p.introType.name
      if (p.startDate) fv.startDate = ymd(p.startDate)!
      if (p.endDateExpected) fv.endDateExpected = ymd(p.endDateExpected)!
      if (p.contractor?.name) fv['constructor'] = p.contractor.name
      const scale = [
        p.wardCount != null ? `${p.wardCount}병동` : null,
        p.bedCount != null ? `${p.bedCount}병상` : null,
        p.gatewayCount != null ? `${p.gatewayCount}G-W` : null,
      ].filter(Boolean)
      if (scale.length) fv.scale = scale.join('/')
      return { hospitalName: p.hospital?.hospitalName ?? null, title: p.projectName ?? null, url: `${base}/projects/${refCode}`, fieldValues: fv }
    }
    case 'SITE_VISIT': {
      const s = await prisma.siteVisit.findUnique({
        where: { siteVisitCode: refCode },
        select: {
          id: true, requestDate: true, visitDate: true, replyDate: true,
          hospital: { select: { hospitalName: true } },
          assignees: ASSIGNEE_FULL,
          status: { select: { name: true } },
          daewoongUser: { select: { name: true } },
        },
      })
      if (!s) return null
      const asn = await assigneeDisplay(s.assignees)
      if (asn) fv.assignees = asn
      if (s.requestDate) fv.requestDate = ymd(s.requestDate)!
      if (s.visitDate) fv.visitDate = ymd(s.visitDate)!
      if (s.replyDate) fv.replyDate = ymd(s.replyDate)!
      if (s.status?.name) fv.status = s.status.name
      if (s.daewoongUser?.name) fv.daewoong = s.daewoongUser.name
      return { hospitalName: s.hospital?.hospitalName ?? null, title: null, url: `${base}/site-visits/${s.id}`, fieldValues: fv }
    }
    case 'INSTALL_PLAN': {
      const ip = await prisma.installPlan.findUnique({
        where: { planCode: refCode },
        select: {
          id: true, requestDate: true, replyDate: true,
          status: { select: { name: true } },
          hospital: { select: { hospitalName: true } },
          assignees: ASSIGNEE_FULL,
        },
      })
      if (!ip) return null
      const asn = await assigneeDisplay(ip.assignees)
      if (asn) fv.assignees = asn
      if (ip.requestDate) fv.requestDate = ymd(ip.requestDate)!
      if (ip.replyDate) fv.replyDate = ymd(ip.replyDate)!
      if (ip.status?.name) fv.status = ip.status.name
      return { hospitalName: ip.hospital?.hospitalName ?? null, title: null, url: `${base}/install-plans/${ip.id}`, fieldValues: fv }
    }
    case 'MAINTENANCE': {
      const m = await prisma.maintenance.findUnique({
        where: { maintenanceCode: refCode },
        select: {
          id: true, title: true, priority: true, reporterName: true, reportedAt: true, resolvedAt: true, isRemote: true,
          hospital: { select: { hospitalName: true } },
          assignees: ASSIGNEE_FULL,
          type: { select: { name: true } },
          status: { select: { name: true } },
          visits: { select: { startDate: true, endDate: true }, orderBy: { sortOrder: 'asc' } },
        },
      })
      if (!m) return null
      const asn = await assigneeDisplay(m.assignees)
      if (asn) fv.assignees = asn
      if (m.priority) fv.priority = m.priority
      if (m.type?.name) fv.type = m.type.name
      if (m.status?.name) fv.status = m.status.name
      if (m.reporterName) fv.reporterName = m.reporterName
      if (m.reportedAt) fv.reportedAt = ymd(m.reportedAt)!
      if (m.resolvedAt) fv.resolvedAt = ymd(m.resolvedAt)!
      fv.isRemote = m.isRemote ? '예' : '아니오'
      const vis = formatVisits(m.visits)
      if (vis) fv.visits = vis
      return { hospitalName: m.hospital?.hospitalName ?? null, title: m.title ?? null, url: `${base}/maintenances/${m.id}`, fieldValues: fv }
    }
    case 'ETC': {
      const e = await prisma.etcTask.findUnique({
        where: { etcTaskCode: refCode },
        select: {
          id: true, title: true, priority: true, reportedAt: true, resolvedAt: true,
          assignees: ASSIGNEE_FULL,
          status: { select: { name: true } },
          hospitals: { select: { hospital: { select: { hospitalName: true } } } },
          visits: { select: { startDate: true, endDate: true }, orderBy: { sortOrder: 'asc' } },
        },
      })
      if (!e) return null
      const asn = await assigneeDisplay(e.assignees)
      if (asn) fv.assignees = asn
      if (e.priority) fv.priority = e.priority
      if (e.status?.name) fv.status = e.status.name
      if (e.reportedAt) fv.reportedAt = ymd(e.reportedAt)!
      if (e.resolvedAt) fv.resolvedAt = ymd(e.resolvedAt)!
      const hs = e.hospitals.map((h) => h.hospital?.hospitalName).filter((n): n is string => !!n)
      const hospitalName = hs.length === 0 ? null : hs.length === 1 ? hs[0] : `${hs[0]} 외 ${hs.length - 1}곳`
      if (hs.length) fv.hospitals = hospitalName!
      const vis = formatVisits(e.visits)
      if (vis) fv.visits = vis
      return { hospitalName, title: e.title ?? null, url: `${base}/etc-tasks/${e.id}`, fieldValues: fv }
    }
    case 'VOC': {
      const v = await prisma.vocReceipt.findUnique({
        where: { vocCode: refCode },
        select: {
          id: true, title: true, customerName: true, receivedAt: true, resolvedAt: true, hospitalNameRaw: true,
          hospital: { select: { hospitalName: true } },
          createdBy: { select: { name: true } },
          channel: { select: { name: true } },
          vocType: { select: { name: true } },
          status: { select: { name: true } },
        },
      })
      if (!v) return null
      if (v.createdBy?.name) fv.createdBy = v.createdBy.name
      if (v.vocType?.name) fv.vocType = v.vocType.name
      if (v.channel?.name) fv.channel = v.channel.name
      if (v.status?.name) fv.status = v.status.name
      if (v.customerName) fv.customerName = v.customerName
      if (v.receivedAt) fv.receivedAt = ymd(v.receivedAt)!
      if (v.resolvedAt) fv.resolvedAt = ymd(v.resolvedAt)!
      return { hospitalName: v.hospital?.hospitalName ?? v.hospitalNameRaw ?? null, title: v.title ?? null, url: `${base}/voc/${v.id}`, fieldValues: fv }
    }
    case 'STOCK_OUT': {
      const r = await prisma.stockOutRequest.findUnique({
        where: { sorCode: refCode },
        select: {
          id: true, requestDate: true, resolvedAt: true,
          project: { select: { projectName: true, hospital: { select: { hospitalName: true } } } },
          createdBy: { select: { name: true } },
          status: { select: { name: true } },
          items: { select: { quantity: true, item: { select: { name: true } } } },
        },
      })
      if (!r) return null
      if (r.status?.name) fv.status = r.status.name
      if (r.requestDate) fv.requestDate = ymd(r.requestDate)!
      if (r.items.length) fv.items = summarizeStockOutItems(r.items)
      if (r.createdBy?.name) fv.createdBy = r.createdBy.name
      if (r.resolvedAt) fv.resolvedAt = ymd(r.resolvedAt)!
      return { hospitalName: r.project?.hospital?.hospitalName ?? null, title: r.project?.projectName ?? null, url: `${base}/stock-out-requests/${r.id}`, fieldValues: fv }
    }
    case 'TICKET': {
      const t = await prisma.ticket.findUnique({
        where: { ticketCode: refCode },
        select: {
          title: true, status: true, severity: true, dueAt: true,
          queue: { select: { name: true } },
          cti: { select: { name: true } },
          owner: { select: { name: true } },
          hospital: { select: { hospitalName: true } },
        },
      })
      if (!t) return null
      if (t.owner?.name) fv.owner = t.owner.name
      fv.severity = TICKET_SEVERITY_LABELS[t.severity]
      fv.status = TICKET_STATUS_LABELS[t.status]
      if (t.queue?.name) fv.queue = t.queue.name
      if (t.cti?.name) fv.cti = t.cti.name
      if (t.dueAt) fv.dueAt = ymd(t.dueAt)!
      return { hospitalName: t.hospital?.hospitalName ?? null, title: t.title, url: `${base}/tickets/${refCode}`, fieldValues: fv }
    }
    default:
      return null
  }
}

/** notify_event_fields 설정(JSON) 조회. 미지정 타입은 추천 기본값 */
async function getEventFields(taskType: TaskType): Promise<string[]> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'notify_event_fields' } })
    if (row?.value) {
      const parsed = JSON.parse(row.value) as Partial<Record<TaskType, string[]>>
      const sel = parsed[taskType]
      if (Array.isArray(sel)) return sel
    }
  } catch (err) {
    console.error('[notify] notify_event_fields 파싱 실패:', err)
  }
  return DEFAULT_FIELDS[taskType]
}

// ─────────────────────────────────────────────────────────────
// 티켓 이벤트 (P11 — 단일 파이프라인)
// ─────────────────────────────────────────────────────────────

const TICKET_CORE_SELECT = {
  id: true, ticketCode: true, title: true, status: true, severity: true, refType: true,
  queueId: true, ctiId: true, ownerId: true, dueAt: true, statusChangedAt: true, // ctiId: 라우팅 매칭 / statusChangedAt: 내부 알림 dedup
  notifySig: true, // 변경 감지 시그니처 (v2 P1 — notification_logs 의존 제거, 로그 purge에 안전)
  queue: { select: { name: true } },
  owner: { select: { id: true, name: true, email: true, slackUserId: true, slackNotifyEnabled: true } },
  hospital: { select: { hospitalName: true } },
  pendingReason: { select: { name: true } },
  maintenance: { select: { maintenanceCode: true } },
  etcTask: { select: { etcTaskCode: true } },
  siteVisit: { select: { siteVisitCode: true } },
  installPlan: { select: { planCode: true } },
  project: { select: { projectCode: true } },
  voc: { select: { vocCode: true } },
} as const

type TicketCore = NonNullable<Awaited<ReturnType<typeof loadTicketCore>>>

async function loadTicketCore(ticketId: number) {
  return prisma.ticket.findUnique({ where: { id: ticketId }, select: TICKET_CORE_SELECT })
}

/** 도메인 연결 refCode (메시지의 도메인 링크·필드 enrich용) */
function domainRefCode(core: TicketCore): string | null {
  switch (core.refType) {
    case 'MAINTENANCE': return core.maintenance?.maintenanceCode ?? null
    case 'ETC': return core.etcTask?.etcTaskCode ?? null
    case 'SITE_VISIT': return core.siteVisit?.siteVisitCode ?? null
    case 'INSTALL_PLAN': return core.installPlan?.planCode ?? null
    case 'PROJECT': return core.project?.projectCode ?? null
    case 'VOC': return core.voc?.vocCode ?? null
    default: return null
  }
}

/** 'Sev1 · Critical' → 'Sev1' */
const sevShort = (sev: TicketSeverity): string => TICKET_SEVERITY_LABELS[sev].split(' ')[0]

/** 상태 시그니처 v2 — 상태/배정/Sev/큐 4축 변경 감지 */
function ticketSig(core: TicketCore): string {
  return `v2|${core.status}|${core.ownerId ?? ''}|${core.severity}|${core.queueId}`
}

/**
 * 시그니처 저장 (v2 P1 — tickets.notify_sig 단일 소스).
 * raw SQL — Prisma update는 @updatedAt을 갱신해 알림 부작용이 도메인 수정 시각을 오염시킨다.
 */
async function saveTicketSig(ticketId: number, sig: string): Promise<void> {
  try {
    await prisma.$executeRaw`UPDATE tickets SET notify_sig = ${sig} WHERE id = ${ticketId}`
  } catch (err) {
    console.error('[notify] notify_sig 저장 실패:', err)
  }
}

interface ParsedSig {
  status?: string
  owner?: string | null
  sev?: string
  queue?: number
}

function parseSig(sig: string | null): ParsedSig {
  if (!sig) return {}
  if (sig.startsWith('v2|')) {
    const [, status, owner, sev, queue] = sig.split('|')
    return { status, owner: owner || null, sev, queue: queue ? parseInt(queue) : undefined }
  }
  // 레거시(P4~P10): TICKET은 status 단독, 도메인은 도메인 상태명 — status 축만 비교 가능
  return { status: sig }
}

/** 큐 멤버 멘션 문자열 (slackNotifyEnabled + 매핑 성공자만). 없으면 null */
async function queueMemberMentions(queueId: number): Promise<string | null> {
  try {
    const members = await prisma.ticketQueueMember.findMany({
      where: { queueId },
      select: { user: { select: { id: true, name: true, email: true, slackUserId: true, slackNotifyEnabled: true } } },
    })
    const parts: string[] = []
    for (const { user: u } of members) {
      if (!u.slackNotifyEnabled) continue
      const sid = await resolveSlackUserId(u)
      if (sid) parts.push(`<@${sid}>`)
    }
    return parts.length ? parts.join(' ') : null
  } catch (err) {
    console.error('[notify] queueMemberMentions 실패:', err)
    return null
  }
}

interface TicketChanges {
  status?: { from: string | null; to: TicketStatus }
  queue?: { fromName: string | null; toName: string }
  sev?: { from: string | null; to: TicketSeverity }
  assignee?: { toLabel: string } // v2 P2 — 담당자 배정 (멘션 또는 이름)
}

/**
 * 티켓 채널 메시지 빌더 (통일 형식 — P11 확정 B안).
 * 헤더: 이모지 [유형] 티켓코드 · Sev · 큐 / 링크: 티켓 상세(+도메인 상세) / 변경 축 / 선택 필드.
 * Sev1 이벤트(생성·에스컬레이션)는 <!channel>, Sev2는 큐 멤버 멘션(mentions로 전달).
 */
function buildTicketMessage(
  kind: 'created' | 'changed',
  core: TicketCore,
  taskType: TaskType,
  enriched: EnrichedTask | null,
  selectedKeys: string[],
  opts: {
    actorName?: string | null
    autoRegistered?: boolean
    changes?: TicketChanges
    emphasize?: boolean // Sev1·2 생성/에스컬레이션 강조 (이모지)
    channelMention?: boolean // Sev1 <!channel> 전체 멘션 (notify_sev1_channel 게이트 통과 시)
    mentions?: string | null // 큐 멤버 멘션 라인
  }
): { text: string; blocks: unknown[] } {
  const base = process.env.NEXT_PUBLIC_APP_URL || ''
  const label = TASK_TYPE_LABELS[taskType]
  const verb = kind === 'created' ? '등록' : '변경'
  const emphasize = opts.emphasize ?? false
  const emoji = emphasize
    ? core.severity === 'SEV1' ? ':rotating_light:' : ':fire:'
    : kind === 'created' ? ':new:' : ':arrows_counterclockwise:'
  const autoTag = opts.autoRegistered ? ' (자동등록)' : ''
  const linkLabel = [core.hospital?.hospitalName, core.title].filter(Boolean).join(' — ') || core.ticketCode
  const ticketUrl = `${base}/tickets/${core.ticketCode}`

  let head = `${emoji} *[${label}]* ${verb}${autoTag} — *${core.ticketCode}* · ${sevShort(core.severity)} · ${core.queue.name}`
  if (opts.channelMention) head = `<!channel> ${head}`

  const domainCode = domainRefCode(core)
  const domainLink = domainCode && enriched && taskType !== 'TICKET' ? ` · <${enriched.url}|${domainCode}>` : ''
  const lines: string[] = [head, `<${ticketUrl}|${linkLabel}>${domainLink}`]

  const ch = opts.changes
  if (ch?.status) {
    const fromLbl = ch.status.from && ch.status.from in TICKET_STATUS_LABELS
      ? TICKET_STATUS_LABELS[ch.status.from as TicketStatus] : ch.status.from
    let line = `:label: Status: ${fromLbl ? `${fromLbl} → ` : ''}*${TICKET_STATUS_LABELS[ch.status.to]}*`
    if (ch.status.to === 'PENDING' && core.pendingReason?.name) line += ` (사유: ${core.pendingReason.name})`
    lines.push(line)
  }
  if (ch?.queue) lines.push(`:inbox_tray: Assignment Group: ${ch.queue.fromName ? `${ch.queue.fromName} → ` : ''}*${ch.queue.toName}*`)
  if (ch?.sev) {
    const fromLbl = ch.sev.from && ch.sev.from in TICKET_SEVERITY_LABELS ? sevShort(ch.sev.from as TicketSeverity) : ch.sev.from
    lines.push(`:vertical_traffic_light: Severity: ${fromLbl ? `${fromLbl} → ` : ''}*${sevShort(ch.sev.to)}*`)
  }
  if (ch?.assignee) lines.push(`:bust_in_silhouette: Assignee: ${ch.assignee.toLabel}`)

  // 설정에서 선택된 필드를 카탈로그 순서대로, 값이 있는 것만 렌더
  if (enriched) {
    const fieldLines = FIELD_CATALOG[taskType]
      .filter((f) => selectedKeys.includes(f.key) && enriched.fieldValues[f.key])
      .map((f) => `• *${f.label}*: ${enriched.fieldValues[f.key]}`)
    lines.push(...fieldLines)
  }

  if (opts.actorName) lines.push(`_${verb}: ${opts.actorName}_`)
  if (opts.mentions) lines.push(`:bell: ${core.queue.name}: ${opts.mentions}`)

  const text = `${emoji} [${label}] ${core.ticketCode} ${linkLabel} ${verb}`
  return { text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } }] }
}

/**
 * 담당자 표시 라벨 — Slack 멘션(<@Uxxx>) 우선, 매핑 실패 시 이름 텍스트 폴백 (v2 P2, 요구 3).
 * 채널 멘션은 DM이 아니므로 slackNotifyEnabled(DM 수신 거부)와 무관하게 태그한다 (확정 7).
 */
async function ownerMentionLabel(owner: NonNullable<TicketCore['owner']>): Promise<string> {
  const sid = await resolveSlackUserId(owner)
  return sid ? `<@${sid}>` : `*${owner.name}*`
}

/** 티켓 생성 시 내부 알림 — 배정됐으면 owner, 미배정이면 Assignment Group 멤버가 수신 (P5) */
async function emitTicketCreatedNotification(
  core: TicketCore,
  taskType: TaskType,
  input: { actorId?: string | null; actorName?: string | null }
): Promise<void> {
  const label = TASK_TYPE_LABELS[taskType]
  const linkLabel = [core.hospital?.hospitalName, core.title].filter(Boolean).join(' — ') || core.ticketCode
  if (core.ownerId) {
    await emitNotification({
      kind: 'TICKET_ASSIGNED',
      userIds: [core.ownerId],
      title: `[${label}] ${core.ticketCode} 배정`,
      body: linkLabel,
      link: `/tickets/${core.ticketCode}`,
      ticketId: core.id, refType: core.refType, refCode: core.ticketCode, severity: core.severity,
      actorId: input.actorId ?? null, actorName: input.actorName ?? null,
      dedupKey: `assigned:${core.id}:${core.ownerId}`,
    })
  } else {
    await emitNotification({
      kind: 'TICKET_UNASSIGNED_IN_MY_QUEUE',
      userIds: await queueMemberIds(core.queueId),
      title: `[${label}] ${core.ticketCode} 미배정 유입 — ${core.queue.name}`,
      body: linkLabel,
      link: `/tickets/${core.ticketCode}`,
      ticketId: core.id, refType: core.refType, refCode: core.ticketCode, severity: core.severity,
      actorId: input.actorId ?? null, actorName: input.actorName ?? null,
      dedupKey: `unassigned:${core.id}`,
    })
  }
}

/**
 * 티켓 생성 알림 (순수 생성·도메인 동시 생성·메일큐 승격 공통).
 * 채널 발송 + 큐 멤버 멘션, owner 선지정 시 배정 DM. best-effort — 절대 throw하지 않음.
 */
export async function notifyTicketCreated(input: {
  ticketId: number
  actorName?: string | null
  /** 본인 행동 제외용 — 내부 알림에서 actor 자신은 수신자에서 빠진다 (P5) */
  actorId?: string | null
  autoRegistered?: boolean
}): Promise<void> {
  try {
    if (!(await eventsEnabled())) return
    const core = await loadTicketCore(input.ticketId)
    if (!core) return
    const taskType = refTypeToTaskType(core.refType)
    if (!(await typeEnabled(taskType))) return

    // 내부 알림 (P5) — Slack 게이트·멱등성 체크보다 **앞에서** 적재한다.
    // (아래 채널 멱등성은 ticketCode 기준이라 삭제 후 코드가 재사용되면 과거 로그에 걸린다.
    //  내부 알림은 ticketId 기반 dedupKey를 쓰므로 그 영향을 받으면 안 된다)
    await emitTicketCreatedNotification(core, taskType, input)

    // 멱등성: 같은 티켓의 등록 알림이 이미 발송(sent)됐으면 스킵(재시도·중복 POST 차단).
    // 최근 1시간 이내만 본다 — 재시도는 초 단위이고, 티켓 코드는 삭제 후 재사용될 수 있다
    const already = await prisma.notificationLog.findFirst({
      where: {
        eventType: 'task_created', refCode: core.ticketCode, status: 'sent',
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
      select: { id: true },
    })
    if (already) return

    // 이벤트별 토글: created off → 채널 미발송, sig 기준선만 확보.
    // '개인 업무' 그룹은 채널 알림 제외 (v2 P2 — 확정 6, 내부 알림은 위에서 이미 적재됨)
    const toggles = await getEventToggles()
    const isPersonal = core.queue.name === PERSONAL_QUEUE_NAME
    if (!toggles.created || isPersonal) {
      await recordLog({
        eventType: 'task_created',
        taskType,
        refCode: core.ticketCode,
        targetType: 'channel',
        targetId: '(baseline)',
        status: 'skipped',
        error: isPersonal ? 'personal_queue' : 'event_off',
        payload: { sig: ticketSig(core) },
      })
    } else {
      const enriched = await enrichTask(taskType, domainRefCode(core) ?? core.ticketCode)
      const selectedKeys = await getEventFields(taskType)
      const emphasize = core.severity === 'SEV1' || core.severity === 'SEV2'
      // 배정된 담당자는 채널 메시지에 @멘션 (v2 P2 — 구 배정 DM 대체)
      const assignee = core.owner ? { toLabel: await ownerMentionLabel(core.owner) } : undefined
      // 채널: 라우팅 규칙 + 그룹 알림 채널 병합 (dispatchToRoutes 내부)
      await dispatchToRoutes({
        eventTypes: ['TICKET_CREATED'],
        match: { refType: core.refType, queueId: core.queueId, ctiId: core.ctiId, severity: core.severity },
        eventType: 'task_created',
        taskType,
        refCode: core.ticketCode,
        sig: ticketSig(core),
        queueId: core.queueId,
        queueName: core.queue.name,
        render: (mentionLine) =>
          buildTicketMessage('created', core, taskType, enriched, selectedKeys, {
            actorName: input.actorName,
            autoRegistered: input.autoRegistered,
            emphasize,
            changes: assignee ? { assignee } : undefined,
            channelMention: mentionLine === '<!channel>' || mentionLine === '<!here>',
            mentions: mentionLine && !mentionLine.startsWith('<!') ? mentionLine : null,
          }),
      })
    }

    // 생성 시그니처 기준선 확정 (v2 P1 — 이후 변경 감지의 비교 기준)
    await saveTicketSig(core.id, ticketSig(core))

  } catch (err) {
    console.error('[notify] notifyTicketCreated 예외:', err)
  }
}

/**
 * 티켓 변경 알림 — 모든 티켓 mutation 뒤에 조건 없이 호출하는 단일 진입점.
 * 직전 발송 로그의 sig(v2: 상태/배정/Sev/큐)와 비교해:
 * - 상태·큐 변경, Sev1·2 에스컬레이션 → 채널 발송 (복합 변경은 1메시지)
 * - owner 변경(신규 배정) → 배정 DM
 * - 그 외 축 변경 → 조용히 sig 갱신(sig_update)
 * 기준선 없음(전환 직후·레거시)이면 이번엔 발송하지 않고 현재 sig만 기록.
 * best-effort — 절대 throw하지 않음.
 */
export async function notifyTicketChanged(input: {
  ticketId: number
  actorName?: string | null
  /** 본인 행동 제외용 (P5) */
  actorId?: string | null
}): Promise<void> {
  try {
    if (!(await eventsEnabled())) return
    const core = await loadTicketCore(input.ticketId)
    if (!core) return
    const taskType = refTypeToTaskType(core.refType)
    if (!(await typeEnabled(taskType))) return

    const currentSig = ticketSig(core)

    // 직전 시그니처: tickets.notify_sig 단일 소스 (v2 P1 — 로그 조회 제거, purge에 안전)
    const lastSig = core.notifySig

    // 기준선 없음(마이그레이션 백필 전 생성분 등) → 발송하지 않고 현재 sig를 기준선으로만 저장
    if (!lastSig) {
      await saveTicketSig(core.id, currentSig)
      return
    }

    if (lastSig === currentSig) return // 변화 없음

    const prev = parseSig(lastSig)
    const statusChanged = prev.status !== undefined && prev.status !== core.status
    const ownerChanged = prev.owner !== undefined && prev.owner !== (core.ownerId ?? null)
    const sevChanged = prev.sev !== undefined && prev.sev !== core.severity
    const queueChanged = prev.queue !== undefined && prev.queue !== core.queueId
    const escalated =
      sevChanged && (core.severity === 'SEV1' || core.severity === 'SEV2') &&
      prev.sev !== 'SEV1' && prev.sev !== 'SEV2'

    // 내부 알림 (P5) — Slack 채널 발송 여부와 무관하게 적재
    const label2 = TASK_TYPE_LABELS[taskType]
    const linkLabel2 = [core.hospital?.hospitalName, core.title].filter(Boolean).join(' — ') || core.ticketCode
    if (ownerChanged && core.ownerId) {
      await emitNotification({
        kind: 'TICKET_ASSIGNED',
        userIds: [core.ownerId],
        title: `[${label2}] ${core.ticketCode} 배정`,
        body: linkLabel2,
        link: `/tickets/${core.ticketCode}`,
        ticketId: core.id, refType: core.refType, refCode: core.ticketCode, severity: core.severity,
        actorId: input.actorId ?? null, actorName: input.actorName ?? null,
        dedupKey: `assigned:${core.id}:${core.ownerId}`,
      })
    }
    if (statusChanged) {
      const fromLbl = prev.status && prev.status in TICKET_STATUS_LABELS
        ? TICKET_STATUS_LABELS[prev.status as TicketStatus] : prev.status
      await emitNotification({
        kind: 'TICKET_STATUS_CHANGED',
        userIds: await ticketRecipients(core.id),
        title: `[${label2}] ${core.ticketCode} ${fromLbl ? `${fromLbl} → ` : ''}${TICKET_STATUS_LABELS[core.status]}`,
        body: linkLabel2,
        link: `/tickets/${core.ticketCode}`,
        ticketId: core.id, refType: core.refType, refCode: core.ticketCode, severity: core.severity,
        actorId: input.actorId ?? null, actorName: input.actorName ?? null,
        dedupKey: `status:${core.id}:${core.status}:${core.statusChangedAt?.getTime() ?? ''}`,
      })
    }

    // 이벤트별 토글(설정 세분 제어) — 꺼진 이벤트는 채널 발송에서 제외.
    // v2 P2: 신규 배정(assigned)도 채널 알림 대상 (구 배정 DM 대체 — 그룹 채널에 @멘션)
    const toggles = await getEventToggles()
    const assignedWorthy = ownerChanged && !!core.ownerId && toggles.assigned
    const channelWorthy =
      (statusChanged && toggles.statusChanged) ||
      (queueChanged && toggles.queueTransferred) ||
      (escalated && toggles.sevEscalated) ||
      assignedWorthy
    const isPersonal = core.queue.name === PERSONAL_QUEUE_NAME // 개인 업무 그룹은 채널 알림 제외 (확정 6)
    if (!channelWorthy || isPersonal) {
      // 채널 발송 없는 축 변경(Sev 비상향 등) — sig만 조용히 갱신
      await saveTicketSig(core.id, currentSig)
      return
    }

    const changes: TicketChanges = {}
    if (statusChanged) changes.status = { from: prev.status ?? null, to: core.status }
    if (assignedWorthy && core.owner) changes.assignee = { toLabel: await ownerMentionLabel(core.owner) }
    if (queueChanged) {
      let fromName: string | null = null
      if (prev.queue) {
        const q = await prisma.ticketQueue.findUnique({ where: { id: prev.queue }, select: { name: true } })
        fromName = q?.name ?? null
      }
      changes.queue = { fromName, toName: core.queue.name }
    }
    if (sevChanged) changes.sev = { from: prev.sev ?? null, to: core.severity }

    const enriched = await enrichTask(taskType, domainRefCode(core) ?? core.ticketCode)
    const selectedKeys = await getEventFields(taskType)

    // 변경 축 → 라우팅 이벤트. 복합 변경(상태+큐 동시)이면 두 이벤트의 매칭 채널을 합쳐 1메시지로 보낸다
    const routeEvents: NotifyRouteEvent[] = []
    if (statusChanged && toggles.statusChanged) routeEvents.push('TICKET_STATUS_CHANGED')
    if (queueChanged && toggles.queueTransferred) routeEvents.push('TICKET_QUEUE_TRANSFERRED')
    if (escalated && toggles.sevEscalated) routeEvents.push('SEV_ESCALATED')

    await dispatchToRoutes({
      eventTypes: routeEvents,
      match: {
        refType: core.refType, queueId: core.queueId, ctiId: core.ctiId, severity: core.severity,
        statusTo: core.status,
      },
      eventType: 'task_status_changed',
      taskType,
      refCode: core.ticketCode,
      sig: currentSig,
      queueId: core.queueId,
      queueName: core.queue.name,
      render: (mentionLine) =>
        buildTicketMessage('changed', core, taskType, enriched, selectedKeys, {
          actorName: input.actorName,
          changes,
          emphasize: escalated,
          channelMention: mentionLine === '<!channel>' || mentionLine === '<!here>',
          mentions: mentionLine && !mentionLine.startsWith('<!') ? mentionLine : null,
        }),
    })

    await saveTicketSig(core.id, currentSig)
  } catch (err) {
    console.error('[notify] notifyTicketChanged 예외:', err)
  }
}

/*
 * 1.0의 지연 채널 요약과 1.1 P4의 SLA 초과 owner DM(getDmPolicy·dmEnabled·sendDelayDMs·runSlaOwnerDms)은
 * 알림 v2 P1에서 폐기됐다 (2026-08-03 확정 — DM 미사용, 채널 멘션으로 대체).
 * 지연 판정은 lib/sla.ts SLA 시계가 단일 소스, 발송은 lib/sla-alerts.ts.
 */

interface AssigneeUser {
  id: string
  name: string
  email: string
  slackUserId: string | null
  slackNotifyEnabled: boolean
}

/** 시스템 계정 → Slack user ID (캐시 우선, 없으면 이메일 조회 후 캐시 저장). 실패 시 null */
async function resolveSlackUserId(u: AssigneeUser): Promise<string | null> {
  if (u.slackUserId) return u.slackUserId
  if (!u.email) return null
  const sid = await slackLookupUserByEmail(u.email)
  if (sid) {
    try {
      await prisma.user.update({ where: { id: u.id }, data: { slackUserId: sid } })
    } catch (err) {
      console.error('[notify] slack_user_id 캐시 저장 실패:', err)
    }
  }
  return sid
}

