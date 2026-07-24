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
import { FIELD_CATALOG, DEFAULT_FIELDS, TASK_TYPE_LABELS, TASK_TYPES } from '@/lib/notifyFields'
import { TICKET_STATUS_LABELS, TICKET_SEVERITY_LABELS } from '@/lib/ticket-shared'
import {
  findDelayedTickets,
  refTypeToTaskType,
  type DelayedTicketItem,
  type AssigneeUser,
} from '@/lib/delay-rules'

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

    // test 모드 [DEV] 표식: 실제 렌더되는 blocks 본문에도 붙인다 (blocks가 있으면 Slack은 text 대신 blocks를 표시)
    const devText = mode === 'test' ? `[DEV] ${d.text}` : d.text
    let blocks = d.blocks
    if (mode === 'test' && Array.isArray(blocks) && blocks.length > 0) {
      blocks = blocks.map((b, i) => {
        if (i !== 0) return b
        const bb = b as { text?: { text?: string } }
        return bb?.text?.text ? { ...bb, text: { ...bb.text, text: `[DEV] ${bb.text.text}` } } : b
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
      payload: { mode, textPreview: bodyPreview.slice(0, 400), sig: d.sig ?? null },
    })
  } catch (err) {
    console.error('[notify] dispatchToChannel 예외:', err)
  }
}

/**
 * 연결 확인용 — notify.ts → slack.ts → notification_logs 전 경로 점검.
 * SLACK_CHANNEL_MAIN을 의도 채널로 발송(test 모드면 테스트 채널로 라우팅됨).
 */
export async function sendConnectionTest(): Promise<void> {
  await dispatchToChannel({
    intendedChannel: process.env.SLACK_CHANNEL_MAIN || '',
    eventType: 'task_created',
    text: ':white_check_mark: thynC Ops 알림 연결 테스트 — (notify → slack → notification_logs)',
  })
}

// ─────────────────────────────────────────────────────────────
// 설정 게이트
// ─────────────────────────────────────────────────────────────

export type TaskType = 'PROJECT' | 'SITE_VISIT' | 'INSTALL_PLAN' | 'MAINTENANCE' | 'ETC' | 'TICKET'

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

/** 배정 DM 사용 여부 (notify_assign_dm, 기본 on — P11 확정) */
async function assignDmEnabled(): Promise<boolean> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'notify_assign_dm' } })
    return (row?.value ?? 'on') !== 'off'
  } catch {
    return true
  }
}

/** 티켓 이벤트별 채널 알림 토글 (notify_event_toggles, 기본 전부 on) — 설정 화면에서 세분 제어 */
export interface TicketEventToggles {
  created: boolean
  statusChanged: boolean
  queueTransferred: boolean
  sevEscalated: boolean
}

const DEFAULT_EVENT_TOGGLES: TicketEventToggles = { created: true, statusChanged: true, queueTransferred: true, sevEscalated: true }

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
          id: true, requestDate: true, replyDate: true, writeStatus: true, replyStatus: true,
          hospital: { select: { hospitalName: true } },
          assignees: ASSIGNEE_FULL,
        },
      })
      if (!ip) return null
      const asn = await assigneeDisplay(ip.assignees)
      if (asn) fv.assignees = asn
      if (ip.requestDate) fv.requestDate = ymd(ip.requestDate)!
      if (ip.replyDate) fv.replyDate = ymd(ip.replyDate)!
      if (ip.writeStatus && ip.writeStatus !== '-') fv.writeStatus = ip.writeStatus
      if (ip.replyStatus && ip.replyStatus !== '-') fv.replyStatus = ip.replyStatus
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
  queueId: true, ownerId: true, dueAt: true,
  queue: { select: { name: true } },
  owner: { select: { id: true, name: true, email: true, slackUserId: true, slackNotifyEnabled: true } },
  hospital: { select: { hospitalName: true } },
  pendingReason: { select: { name: true } },
  maintenance: { select: { maintenanceCode: true } },
  etcTask: { select: { etcTaskCode: true } },
  siteVisit: { select: { siteVisitCode: true } },
  installPlan: { select: { planCode: true } },
  project: { select: { projectCode: true } },
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
    default: return null
  }
}

/** 'Sev1 · Critical' → 'Sev1' */
const sevShort = (sev: TicketSeverity): string => TICKET_SEVERITY_LABELS[sev].split(' ')[0]

/** 상태 시그니처 v2 — 상태/배정/Sev/큐 4축 변경 감지 */
function ticketSig(core: TicketCore): string {
  return `v2|${core.status}|${core.ownerId ?? ''}|${core.severity}|${core.queueId}`
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
  if (ch?.queue) lines.push(`:inbox_tray: Queue: ${ch.queue.fromName ? `${ch.queue.fromName} → ` : ''}*${ch.queue.toName}*`)
  if (ch?.sev) {
    const fromLbl = ch.sev.from && ch.sev.from in TICKET_SEVERITY_LABELS ? sevShort(ch.sev.from as TicketSeverity) : ch.sev.from
    lines.push(`:vertical_traffic_light: Severity: ${fromLbl ? `${fromLbl} → ` : ''}*${sevShort(ch.sev.to)}*`)
  }

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

/** 신규 owner 배정 DM (notify_assign_dm 게이트, 계정 플래그·매핑 실패 시 스킵) */
async function sendTicketAssignDm(core: TicketCore, taskType: TaskType, actorName?: string | null): Promise<void> {
  const owner = core.owner
  if (!owner) return
  if (!(await assignDmEnabled())) return
  const mode = getSlackMode()
  if (mode === 'off') return

  const label = TASK_TYPE_LABELS[taskType]
  const linkLabel = [core.hospital?.hospitalName, core.title].filter(Boolean).join(' — ') || core.ticketCode
  const base = process.env.NEXT_PUBLIC_APP_URL || ''

  if (!owner.slackNotifyEnabled) {
    await recordLog({ eventType: 'ticket_assigned', taskType, refCode: core.ticketCode, targetType: 'dm', targetId: `user:${owner.id}`, status: 'skipped', error: 'user_opt_out', payload: { dmTo: owner.name } })
    return
  }
  const sid = await resolveSlackUserId(owner)
  if (!sid) {
    await recordLog({ eventType: 'ticket_assigned', taskType, refCode: core.ticketCode, targetType: 'dm', targetId: `email:${owner.email}`, status: 'skipped', error: 'no_slack_mapping', payload: { dmTo: owner.name } })
    return
  }

  const dmText = `:ticket: 티켓 배정 — *[${label}] ${core.ticketCode}* · ${sevShort(core.severity)} · ${core.queue.name}\n${linkLabel}${actorName ? `\n_배정: ${actorName}_` : ''}\n${base}/tickets/${core.ticketCode}`
  const channel = mode === 'test' ? process.env.SLACK_CHANNEL_TEST || '' : sid
  const body = mode === 'test' ? `[DEV][DM→${owner.name}] ${dmText}` : dmText

  const res = channel ? await slackPostMessage(channel, { text: body }) : { ok: false, skipped: true, error: 'no_channel' as const }
  await recordLog({
    eventType: 'ticket_assigned',
    taskType,
    refCode: core.ticketCode,
    targetType: 'dm',
    targetId: sid,
    status: res.ok ? 'sent' : res.skipped ? 'skipped' : 'failed',
    error: res.error,
    payload: { mode, dmTo: owner.name, textPreview: body.slice(0, 300) },
  })
}

/**
 * 티켓 생성 알림 (순수 생성·도메인 동시 생성·메일큐 승격 공통).
 * 채널 발송 + 큐 멤버 멘션, owner 선지정 시 배정 DM. best-effort — 절대 throw하지 않음.
 */
export async function notifyTicketCreated(input: {
  ticketId: number
  actorName?: string | null
  autoRegistered?: boolean
}): Promise<void> {
  try {
    if (!(await eventsEnabled())) return
    const core = await loadTicketCore(input.ticketId)
    if (!core) return
    const taskType = refTypeToTaskType(core.refType)
    if (!(await typeEnabled(taskType))) return

    // 멱등성: 같은 티켓의 등록 알림이 이미 발송(sent)됐으면 스킵(재시도·중복 POST 차단)
    const already = await prisma.notificationLog.findFirst({
      where: { eventType: 'task_created', refCode: core.ticketCode, status: 'sent' },
      select: { id: true },
    })
    if (already) return

    // 이벤트별 토글: created off → 채널 미발송, sig 기준선만 기록 (배정 DM은 별도 게이트로 진행)
    const toggles = await getEventToggles()
    if (!toggles.created) {
      await recordLog({
        eventType: 'task_created',
        taskType,
        refCode: core.ticketCode,
        targetType: 'channel',
        targetId: '(baseline)',
        status: 'skipped',
        error: 'event_off',
        payload: { sig: ticketSig(core) },
      })
    } else {
      const enriched = await enrichTask(taskType, domainRefCode(core) ?? core.ticketCode)
      const selectedKeys = await getEventFields(taskType)
      const mentions = (await queueMentionsOn()) ? await queueMemberMentions(core.queueId) : null
      const emphasize = core.severity === 'SEV1' || core.severity === 'SEV2'
      const channelMention = core.severity === 'SEV1' && (await sev1ChannelOn())
      const { text, blocks } = buildTicketMessage('created', core, taskType, enriched, selectedKeys, {
        actorName: input.actorName,
        autoRegistered: input.autoRegistered,
        emphasize,
        channelMention,
        mentions,
      })
      await dispatchToChannel({
        intendedChannel: process.env.SLACK_CHANNEL_MAIN || '',
        eventType: 'task_created',
        taskType,
        refCode: core.ticketCode,
        text,
        blocks,
        sig: ticketSig(core),
      })
    }

    if (core.ownerId) await sendTicketAssignDm(core, taskType, input.actorName)
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
}): Promise<void> {
  try {
    if (!(await eventsEnabled())) return
    const core = await loadTicketCore(input.ticketId)
    if (!core) return
    const taskType = refTypeToTaskType(core.refType)
    if (!(await typeEnabled(taskType))) return

    const currentSig = ticketSig(core)

    // 직전 시그니처: 발송(sent) 또는 baseline/sig_update 캡처 로그
    const last = await prisma.notificationLog.findFirst({
      where: {
        refCode: core.ticketCode,
        eventType: { in: ['task_created', 'task_status_changed'] },
        OR: [{ status: 'sent' }, { status: 'skipped', error: { in: ['baseline', 'sig_update'] } }],
      },
      orderBy: { id: 'desc' },
      select: { payload: true },
    })

    // 기준선 없음(P11 전환 직후·레거시) → 발송하지 않고 현재 sig를 기준선으로만 기록
    if (!last) {
      await recordLog({
        eventType: 'task_status_changed',
        taskType,
        refCode: core.ticketCode,
        targetType: 'channel',
        targetId: '(baseline)',
        status: 'skipped',
        error: 'baseline',
        payload: { sig: currentSig },
      })
      return
    }

    const lastSig = ((last.payload as { sig?: string | null } | null)?.sig) ?? null
    if (lastSig === currentSig) return // 변화 없음

    const prev = parseSig(lastSig)
    const statusChanged = prev.status !== undefined && prev.status !== core.status
    const ownerChanged = prev.owner !== undefined && prev.owner !== (core.ownerId ?? null)
    const sevChanged = prev.sev !== undefined && prev.sev !== core.severity
    const queueChanged = prev.queue !== undefined && prev.queue !== core.queueId
    const escalated =
      sevChanged && (core.severity === 'SEV1' || core.severity === 'SEV2') &&
      prev.sev !== 'SEV1' && prev.sev !== 'SEV2'

    // 신규 배정 DM (해제는 DM 없음)
    if (ownerChanged && core.ownerId) await sendTicketAssignDm(core, taskType, input.actorName)

    // 이벤트별 토글(설정 세분 제어) — 꺼진 이벤트는 채널 발송에서 제외
    const toggles = await getEventToggles()
    const channelWorthy =
      (statusChanged && toggles.statusChanged) ||
      (queueChanged && toggles.queueTransferred) ||
      (escalated && toggles.sevEscalated)
    if (!channelWorthy) {
      // 채널 발송 없는 축 변경(owner 단독, Sev 비상향 등) — sig만 조용히 갱신
      await recordLog({
        eventType: 'task_status_changed',
        taskType,
        refCode: core.ticketCode,
        targetType: 'channel',
        targetId: '(baseline)',
        status: 'skipped',
        error: 'sig_update',
        payload: { sig: currentSig },
      })
      return
    }

    const changes: TicketChanges = {}
    if (statusChanged) changes.status = { from: prev.status ?? null, to: core.status }
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
    // 큐 멤버 멘션: 새 큐로의 이관 또는 Sev1·2 에스컬레이션 시 (notify_queue_mentions 게이트)
    const mentions =
      (queueChanged || escalated) && (await queueMentionsOn()) ? await queueMemberMentions(core.queueId) : null
    const channelMention = escalated && core.severity === 'SEV1' && (await sev1ChannelOn())
    const { text, blocks } = buildTicketMessage('changed', core, taskType, enriched, selectedKeys, {
      actorName: input.actorName,
      changes,
      emphasize: escalated,
      channelMention,
      mentions,
    })
    await dispatchToChannel({
      intendedChannel: process.env.SLACK_CHANNEL_MAIN || '',
      eventType: 'task_status_changed',
      taskType,
      refCode: core.ticketCode,
      text,
      blocks,
      sig: currentSig,
    })
  } catch (err) {
    console.error('[notify] notifyTicketChanged 예외:', err)
  }
}

// ─────────────────────────────────────────────────────────────
// SLA 요약 (스케줄러 → 지연 채널) — P11: Sev 기반 티켓 판정
// ─────────────────────────────────────────────────────────────

const KIND_HEAD: Record<DelayedTicketItem['kind'], string> = {
  overdue: ':alarm_clock: *SLA 초과',
  warning: ':hourglass_flowing_sand: *SLA 임박',
  dwell: ':pause_button: *상태 체류',
}

function delayLine(i: DelayedTicketItem): string {
  const label = TASK_TYPE_LABELS[i.taskType]
  const name = [i.hospitalName, i.title].filter(Boolean).join(' — ') || i.ticketCode
  const meta =
    i.kind === 'overdue' ? `*${i.days}일 초과* (${i.baseLabel})`
    : i.kind === 'warning' ? `*${i.days === 0 ? '오늘 마감' : `D-${i.days}`}* (${i.baseLabel})`
    : `*${i.baseLabel}*`
  return `• [${label}] <${i.url}|${i.ticketCode} ${name}> — ${sevShort(i.severity)} · ${meta}`
}

function buildDelaySummary(items: DelayedTicketItem[]): { text: string; blocks: unknown[] } {
  const MAX_PER_SECTION = 10
  const sections: string[] = []
  const counts: Record<string, number> = { overdue: 0, warning: 0, dwell: 0 }
  for (const kind of ['overdue', 'warning', 'dwell'] as const) {
    const group = items.filter((i) => i.kind === kind)
    counts[kind] = group.length
    if (!group.length) continue
    const lines = group.slice(0, MAX_PER_SECTION).map(delayLine)
    if (group.length > MAX_PER_SECTION) lines.push(`… 외 ${group.length - MAX_PER_SECTION}건`)
    sections.push(`${KIND_HEAD[kind]} ${group.length}건*\n${lines.join('\n')}`)
  }
  const text = `⏰ SLA 초과 ${counts.overdue} · 임박 ${counts.warning} · 체류 ${counts.dwell}건`
  return { text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: sections.join('\n\n') } }] }
}

/** 지연 채널 요약 발송 (12시간 내 동일 멤버십 재발송 방지) */
async function sendDelayChannelSummary(items: DelayedTicketItem[]): Promise<void> {
  const sig = items.map((i) => `${i.kind}:${i.ticketCode}`).sort().join(',')
  const recent = await prisma.notificationLog.findFirst({
    where: { eventType: 'delayed', targetType: 'channel', status: 'sent', createdAt: { gte: new Date(Date.now() - 12 * 3600 * 1000) } },
    orderBy: { id: 'desc' },
    select: { payload: true },
  })
  if (((recent?.payload as { sig?: string } | null)?.sig) === sig) {
    console.log('[notify] SLA 요약 동일 멤버십 — 재발송 스킵')
    return
  }
  const { text, blocks } = buildDelaySummary(items)
  await dispatchToChannel({
    intendedChannel: process.env.SLACK_CHANNEL_DELAY || process.env.SLACK_CHANNEL_MAIN || '',
    eventType: 'delayed',
    text,
    blocks,
    sig,
  })
}

// ─────────────────────────────────────────────────────────────
// SLA 초과 owner DM
// ─────────────────────────────────────────────────────────────

interface DmPolicy {
  dedupHours: number // 같은 건·같은 사람 재발송 최소 간격
}

async function getDmPolicy(): Promise<DmPolicy> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'notify_dm_policy' } })
    if (row?.value) {
      const p = JSON.parse(row.value) as Partial<DmPolicy>
      if (typeof p.dedupHours === 'number') return { dedupHours: p.dedupHours }
    }
  } catch (err) {
    console.error('[notify] notify_dm_policy 파싱 실패:', err)
  }
  return { dedupHours: 24 }
}

/** DM 사용 여부 (notify_dm_enabled, 기본 off) */
async function dmEnabled(): Promise<boolean> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'notify_dm_enabled' } })
    return (row?.value ?? 'off') === 'on'
  } catch {
    return false
  }
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

/** SLA 초과 티켓 owner DM. 조용시간·주말 제한 없음, dedupHours 내 재발송만 차단(해소 시까지 반복) */
async function sendDelayDMs(items: DelayedTicketItem[]): Promise<void> {
  const mode = getSlackMode()
  if (mode === 'off') return // off면 담당자 매핑 조회(Slack API)조차 하지 않음

  const policy = await getDmPolicy()
  const since = new Date(Date.now() - policy.dedupHours * 3600 * 1000)

  for (const item of items) {
    if (item.kind !== 'overdue' || !item.owner) continue
    const u = item.owner
    const label = TASK_TYPE_LABELS[item.taskType]
    const name = [item.hospitalName, item.title].filter(Boolean).join(' — ') || item.ticketCode

    // 계정별 Slack 발송 플래그 off → 스킵 (스킵 로그도 dedupHours당 1건만)
    if (!u.slackNotifyEnabled) {
      const dupSkip = await prisma.notificationLog.findFirst({
        where: { eventType: 'delayed', targetType: 'dm', refCode: item.ticketCode, targetId: `user:${u.id}`, status: 'skipped', createdAt: { gte: since } },
        select: { id: true },
      })
      if (!dupSkip) await recordLog({ eventType: 'delayed', taskType: item.taskType, refCode: item.ticketCode, targetType: 'dm', targetId: `user:${u.id}`, status: 'skipped', error: 'user_opt_out', payload: { dmTo: u.name } })
      continue
    }

    const sid = await resolveSlackUserId(u)
    const targetId = sid ?? `email:${u.email}`

    // 매핑 실패 → 스킵 로그 (에러 아님, dedupHours당 1건만)
    if (!sid) {
      const dupSkip = await prisma.notificationLog.findFirst({
        where: { eventType: 'delayed', targetType: 'dm', refCode: item.ticketCode, targetId, status: 'skipped', createdAt: { gte: since } },
        select: { id: true },
      })
      if (!dupSkip) await recordLog({ eventType: 'delayed', taskType: item.taskType, refCode: item.ticketCode, targetType: 'dm', targetId, status: 'skipped', error: 'no_slack_mapping', payload: { dmTo: u.name } })
      continue
    }

    // dedup: 같은 건·같은 사람에게 dedupHours 내 이미 발송했으면 스킵
    const dup = await prisma.notificationLog.findFirst({
      where: { eventType: 'delayed', targetType: 'dm', refCode: item.ticketCode, targetId: sid, status: 'sent', createdAt: { gte: since } },
      select: { id: true },
    })
    if (dup) continue

    const dmText = `:alarm_clock: SLA 초과 — [${label}] ${item.ticketCode} ${name} (${sevShort(item.severity)} · *${item.days}일 초과*, ${item.baseLabel})\n처리됐다면 상태를 갱신해주세요.\n${item.url}`
    // test 모드: 실제 담당자가 아닌 테스트 채널로 라우팅
    const channel = mode === 'test' ? process.env.SLACK_CHANNEL_TEST || '' : sid
    const body = mode === 'test' ? `[DEV][DM→${u.name}] ${dmText}` : dmText

    const res = channel ? await slackPostMessage(channel, { text: body }) : { ok: false, skipped: true, error: 'no_channel' as const }
    await recordLog({
      eventType: 'delayed',
      taskType: item.taskType,
      refCode: item.ticketCode,
      targetType: 'dm',
      targetId: sid,
      status: res.ok ? 'sent' : res.skipped ? 'skipped' : 'failed',
      error: res.error,
      payload: { mode, dmTo: u.name, overdueDays: item.days, textPreview: body.slice(0, 300) },
    })
  }
}

/**
 * SLA·체류 알림 실행 (notify-scheduler가 주기적으로 호출).
 * 전역 off·대상 0건이면 미발송. 채널 요약 + (DM 사용 시) SLA 초과 owner DM.
 * best-effort — throw하지 않음.
 */
export async function runDelayNotifications(): Promise<void> {
  try {
    const g = await prisma.appSetting.findUnique({ where: { key: 'notify_enabled' } })
    if ((g?.value ?? 'off') !== 'on') return

    const types = await getTypesEnabled()
    const items = (await findDelayedTickets()).filter((i) => types[i.taskType])
    if (items.length === 0) {
      console.log('[notify] SLA 초과·임박·체류 티켓 없음(또는 전 타입 비활성) — 미발송')
      return
    }

    await sendDelayChannelSummary(items)
    if (await dmEnabled()) await sendDelayDMs(items)
  } catch (err) {
    console.error('[notify] runDelayNotifications 예외:', err)
  }
}
