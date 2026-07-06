/**
 * 알림 정책·로그 레이어 (function_notification.md Phase 1 골격)
 *
 * 도메인 이벤트 → 설정 확인 → 메시지 발송(lib/slack) → notification_logs 기록.
 * 이 파일의 모든 export는 절대 throw하지 않는다 (호출부 API mutation을 깨면 안 됨).
 *
 * Phase 1: 채널 전송 코어(dispatchToChannel) + 연결 테스트(sendConnectionTest) + 로그.
 * Phase 2: notifyTaskCreated/notifyTaskCompleted (이벤트 훅) 추가 예정.
 * Phase 3~4: notifyDelayed (지연 요약·담당자 DM) 추가 예정.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSlackMode, resolveTargetChannel, slackPostMessage, slackLookupUserByEmail } from '@/lib/slack'
import { FIELD_CATALOG, DEFAULT_FIELDS, TASK_TYPE_LABELS } from '@/lib/notifyFields'
import { findDelayedTasks, type DelayedItem, type AssigneeUser } from '@/lib/delay-rules'

export type NotifyEventType = 'task_created' | 'task_status_changed' | 'delayed'
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
  sig?: string | null // 상태 시그니처(상태변경 전이 감지·비교용, payload에 기록)
}

/**
 * 채널 발송 코어. 모드(off/test/live) 라우팅 → 발송 → 로그.
 * - off: 미발송, skipped 로그
 * - test: 테스트 채널로 라우팅 + `[DEV]` prefix
 * - live: 의도한 채널로
 * AppSetting(notify_enabled 등) 기능 토글은 상위 이벤트 함수(Phase 2)에서 확인한다.
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
 * Phase 1 연결 확인용 — notify.ts → slack.ts → notification_logs 전 경로 점검.
 * SLACK_CHANNEL_MAIN을 의도 채널로 발송(test 모드면 테스트 채널로 라우팅됨).
 */
export async function sendConnectionTest(): Promise<void> {
  await dispatchToChannel({
    intendedChannel: process.env.SLACK_CHANNEL_MAIN || '',
    eventType: 'task_created',
    text: ':white_check_mark: thynC Ops 알림 연결 테스트 — Phase 1 (notify → slack → notification_logs)',
  })
}

// ─────────────────────────────────────────────────────────────
// Phase 2 — 이벤트 알림 (등록/완료 → 단일 채널 SLACK_CHANNEL_MAIN)
// ─────────────────────────────────────────────────────────────

export type TaskType = 'PROJECT' | 'SITE_VISIT' | 'INSTALL_PLAN' | 'MAINTENANCE' | 'ETC'

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

interface EnrichedTask {
  hospitalName: string | null
  title: string | null
  url: string
  fieldValues: Record<string, string> // 카탈로그 key → 표시 문자열 (값 있는 것만)
  statusSignature: string | null // 상태 변경 감지용 상태 시그니처 (타입별 상태값)
}

/** 담당자 표시: "홍길동 외 2명" / "미지정" */
function assigneeText(names: string[]): string {
  if (names.length === 0) return '미지정'
  return names.length === 1 ? names[0] : `${names[0]} 외 ${names.length - 1}명`
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
 * (taskType, refCode)로 메시지에 쓸 상세를 조회. 대상 없으면 null(스킵).
 * fieldValues에는 카탈로그의 모든 후보 필드 중 값이 있는 것만 채운다(표시 여부는 설정이 결정).
 */
async function enrichTask(taskType: TaskType, refCode: string): Promise<EnrichedTask | null> {
  const base = process.env.NEXT_PUBLIC_APP_URL || ''
  const asnNames = (arr: { user: { name: string } }[]) => arr.map((a) => a.user.name)
  const fv: Record<string, string> = {}

  switch (taskType) {
    case 'PROJECT': {
      const p = await prisma.project.findUnique({
        where: { projectCode: refCode },
        select: {
          projectName: true, contractDate: true, startDate: true, endDateExpected: true,
          wardCount: true, bedCount: true, gatewayCount: true,
          hospital: { select: { hospitalName: true } },
          assignees: { select: { user: { select: { name: true } } } },
          introType: { select: { name: true } },
          buildStatus: { select: { label: true } },
          contractor: { select: { name: true } },
        },
      })
      if (!p) return null
      const asn = asnNames(p.assignees)
      if (asn.length) fv.assignees = assigneeText(asn)
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
      return { hospitalName: p.hospital?.hospitalName ?? null, title: p.projectName ?? null, url: `${base}/projects/${refCode}`, fieldValues: fv, statusSignature: p.buildStatus?.label ?? null }
    }
    case 'SITE_VISIT': {
      const s = await prisma.siteVisit.findUnique({
        where: { siteVisitCode: refCode },
        select: {
          id: true, requestDate: true, visitDate: true, replyDate: true,
          hospital: { select: { hospitalName: true } },
          assignees: { select: { user: { select: { name: true } } } },
          status: { select: { name: true } },
          daewoongUser: { select: { name: true } },
        },
      })
      if (!s) return null
      const asn = asnNames(s.assignees)
      if (asn.length) fv.assignees = assigneeText(asn)
      if (s.requestDate) fv.requestDate = ymd(s.requestDate)!
      if (s.visitDate) fv.visitDate = ymd(s.visitDate)!
      if (s.replyDate) fv.replyDate = ymd(s.replyDate)!
      if (s.status?.name) fv.status = s.status.name
      if (s.daewoongUser?.name) fv.daewoong = s.daewoongUser.name
      return { hospitalName: s.hospital?.hospitalName ?? null, title: null, url: `${base}/site-visits/${s.id}`, fieldValues: fv, statusSignature: s.status?.name ?? null }
    }
    case 'INSTALL_PLAN': {
      const ip = await prisma.installPlan.findUnique({
        where: { planCode: refCode },
        select: {
          id: true, requestDate: true, replyDate: true, writeStatus: true, replyStatus: true,
          hospital: { select: { hospitalName: true } },
          assignees: { select: { user: { select: { name: true } } } },
        },
      })
      if (!ip) return null
      const asn = asnNames(ip.assignees)
      if (asn.length) fv.assignees = assigneeText(asn)
      if (ip.requestDate) fv.requestDate = ymd(ip.requestDate)!
      if (ip.replyDate) fv.replyDate = ymd(ip.replyDate)!
      if (ip.writeStatus && ip.writeStatus !== '-') fv.writeStatus = ip.writeStatus
      if (ip.replyStatus && ip.replyStatus !== '-') fv.replyStatus = ip.replyStatus
      return { hospitalName: ip.hospital?.hospitalName ?? null, title: null, url: `${base}/install-plans/${ip.id}`, fieldValues: fv, statusSignature: `작성:${ip.writeStatus || '-'}/회신:${ip.replyStatus || '-'}` }
    }
    case 'MAINTENANCE': {
      const m = await prisma.maintenance.findUnique({
        where: { maintenanceCode: refCode },
        select: {
          id: true, title: true, priority: true, reporterName: true, reportedAt: true, resolvedAt: true, isRemote: true,
          hospital: { select: { hospitalName: true } },
          assignees: { select: { user: { select: { name: true } } } },
          type: { select: { name: true } },
          status: { select: { name: true } },
          visits: { select: { startDate: true, endDate: true }, orderBy: { sortOrder: 'asc' } },
        },
      })
      if (!m) return null
      const asn = asnNames(m.assignees)
      if (asn.length) fv.assignees = assigneeText(asn)
      if (m.priority) fv.priority = m.priority
      if (m.type?.name) fv.type = m.type.name
      if (m.status?.name) fv.status = m.status.name
      if (m.reporterName) fv.reporterName = m.reporterName
      if (m.reportedAt) fv.reportedAt = ymd(m.reportedAt)!
      if (m.resolvedAt) fv.resolvedAt = ymd(m.resolvedAt)!
      fv.isRemote = m.isRemote ? '예' : '아니오'
      const vis = formatVisits(m.visits)
      if (vis) fv.visits = vis
      return { hospitalName: m.hospital?.hospitalName ?? null, title: m.title ?? null, url: `${base}/maintenances/${m.id}`, fieldValues: fv, statusSignature: m.status?.name ?? null }
    }
    case 'ETC': {
      const e = await prisma.etcTask.findUnique({
        where: { etcTaskCode: refCode },
        select: {
          id: true, title: true, priority: true, reportedAt: true, resolvedAt: true,
          assignees: { select: { user: { select: { name: true } } } },
          status: { select: { name: true } },
          hospitals: { select: { hospital: { select: { hospitalName: true } } } },
          visits: { select: { startDate: true, endDate: true }, orderBy: { sortOrder: 'asc' } },
        },
      })
      if (!e) return null
      const asn = asnNames(e.assignees)
      if (asn.length) fv.assignees = assigneeText(asn)
      if (e.priority) fv.priority = e.priority
      if (e.status?.name) fv.status = e.status.name
      if (e.reportedAt) fv.reportedAt = ymd(e.reportedAt)!
      if (e.resolvedAt) fv.resolvedAt = ymd(e.resolvedAt)!
      const hs = e.hospitals.map((h) => h.hospital?.hospitalName).filter((n): n is string => !!n)
      const hospitalName = hs.length === 0 ? null : hs.length === 1 ? hs[0] : `${hs[0]} 외 ${hs.length - 1}곳`
      if (hs.length) fv.hospitals = hospitalName!
      const vis = formatVisits(e.visits)
      if (vis) fv.visits = vis
      return { hospitalName, title: e.title ?? null, url: `${base}/etc-tasks/${e.id}`, fieldValues: fv, statusSignature: e.status?.name ?? null }
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

function buildEventMessage(
  eventType: 'task_created' | 'task_status_changed',
  taskType: TaskType,
  t: EnrichedTask,
  refCode: string,
  selectedKeys: string[],
  actorName?: string | null,
  autoRegistered?: boolean,
  statusChange?: { from: string | null; to: string | null }
): { text: string; blocks: unknown[] } {
  const isCreate = eventType === 'task_created'
  const emoji = isCreate ? ':new:' : ':arrows_counterclockwise:'
  const verb = isCreate ? '등록' : '상태 변경'
  const label = TASK_TYPE_LABELS[taskType]
  const linkLabel = [t.hospitalName, t.title].filter(Boolean).join(' — ') || refCode
  const autoTag = autoRegistered ? ' (자동등록)' : ''

  // 설정에서 선택된 필드를 카탈로그 순서대로, 값이 있는 것만 렌더
  const fieldLines = FIELD_CATALOG[taskType]
    .filter((f) => selectedKeys.includes(f.key) && t.fieldValues[f.key])
    .map((f) => `• *${f.label}*: ${t.fieldValues[f.key]}`)

  const text = `${emoji} [${label}] ${linkLabel} ${verb}`
  let body = `${emoji} *[${label}]* ${verb}${autoTag}\n<${t.url}|${linkLabel}>`
  if (statusChange) {
    const { from, to } = statusChange
    body += `\n:label: 상태: ${from ? `${from} → ` : ''}*${to ?? '(없음)'}*`
  }
  if (fieldLines.length) body += `\n${fieldLines.join('\n')}`
  if (actorName) body += `\n_${verb}: ${actorName}_`

  const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: body } }]
  return { text, blocks }
}

/**
 * 업무 등록 알림. 호출부(POST route)에서 엔티티 생성 뒤에 fire.
 * best-effort — 절대 throw하지 않음. 설정 off·대상 없음·발송 실패 모두 조용히 스킵/로그.
 * 발송 시 현재 상태 시그니처를 payload에 남겨 이후 상태변경 감지의 기준선(baseline)이 된다.
 */
export async function notifyTaskEvent(input: {
  eventType: 'task_created'
  taskType: TaskType
  refCode: string
  actorName?: string | null
  autoRegistered?: boolean
}): Promise<void> {
  try {
    if (!(await eventsEnabled())) return

    // 멱등성: 같은 업무의 등록 알림이 이미 발송(sent)됐으면 스킵(재시도·중복 POST 차단).
    // Task 미러가 불완전(프로젝트·답사 POST는 Task 미생성)해도 refCode 기준이라 안전.
    const already = await prisma.notificationLog.findFirst({
      where: { eventType: input.eventType, refCode: input.refCode, status: 'sent' },
      select: { id: true },
    })
    if (already) return

    const enriched = await enrichTask(input.taskType, input.refCode)
    if (!enriched) return
    const selectedKeys = await getEventFields(input.taskType)
    const { text, blocks } = buildEventMessage(input.eventType, input.taskType, enriched, input.refCode, selectedKeys, input.actorName, input.autoRegistered)
    await dispatchToChannel({
      intendedChannel: process.env.SLACK_CHANNEL_MAIN || '',
      eventType: input.eventType,
      taskType: input.taskType,
      refCode: input.refCode,
      text,
      blocks,
      sig: enriched.statusSignature,
    })
  } catch (err) {
    console.error('[notify] notifyTaskEvent 예외:', err)
  }
}

/**
 * 업무 상태 변경 알림. 호출부(PUT route)에서 상태값이 바뀔 수 있는 갱신 뒤에 fire.
 * 직전 발송(sent) 시 남긴 상태 시그니처와 현재 값을 비교해 **실제로 바뀐 경우에만** 발송한다.
 * → 각 route는 조건 없이 호출만 하면 되고(비상태 필드만 바꾼 저장은 자동 스킵), 완료도 "→ 완료" 변경의 한 경우.
 * best-effort — 절대 throw하지 않음.
 */
export async function notifyTaskStatusChanged(input: {
  taskType: TaskType
  refCode: string
  actorName?: string | null
}): Promise<void> {
  try {
    if (!(await eventsEnabled())) return

    const enriched = await enrichTask(input.taskType, input.refCode)
    if (!enriched) return
    const currentSig = enriched.statusSignature

    // 직전 상태 시그니처: 발송(sent) 로그 또는 baseline 캡처 로그 (delayed 등 제외)
    const last = await prisma.notificationLog.findFirst({
      where: {
        refCode: input.refCode,
        eventType: { in: ['task_created', 'task_status_changed'] },
        OR: [{ status: 'sent' }, { status: 'skipped', error: 'baseline' }],
      },
      orderBy: { id: 'desc' },
      select: { payload: true },
    })

    // 기준선 없음(알림 도입 전 생성된 레거시 업무) → 이번 저장은 발송하지 않고 현재 상태를 기준선으로만 기록.
    // (없으면 비고만 수정해도 "상태 변경"으로 오발송됨. 다음 실제 변경부터 정상 감지)
    if (!last) {
      await recordLog({
        eventType: 'task_status_changed',
        taskType: input.taskType,
        refCode: input.refCode,
        targetType: 'channel',
        targetId: '(baseline)',
        status: 'skipped',
        error: 'baseline',
        payload: { sig: currentSig },
      })
      return
    }

    const lastSig = ((last.payload as { sig?: string | null } | null)?.sig) ?? null

    // 상태 변화 없음 → 스킵 (동일 저장 / 상태 아닌 필드만 변경)
    if (currentSig === lastSig) return

    const selectedKeys = await getEventFields(input.taskType)
    const { text, blocks } = buildEventMessage('task_status_changed', input.taskType, enriched, input.refCode, selectedKeys, input.actorName, false, { from: lastSig, to: currentSig })
    await dispatchToChannel({
      intendedChannel: process.env.SLACK_CHANNEL_MAIN || '',
      eventType: 'task_status_changed',
      taskType: input.taskType,
      refCode: input.refCode,
      text,
      blocks,
      sig: currentSig,
    })
  } catch (err) {
    console.error('[notify] notifyTaskStatusChanged 예외:', err)
  }
}

// ─────────────────────────────────────────────────────────────
// Phase 3 — 지연 감지 요약 알림 (스케줄러 → 지연 채널)
// ─────────────────────────────────────────────────────────────

function buildDelaySummary(items: DelayedItem[]): { text: string; blocks: unknown[] } {
  const MAX = 20
  const shown = items.slice(0, MAX)
  const lines = shown.map((i) => {
    const label = TASK_TYPE_LABELS[i.taskType]
    const name = [i.hospitalName, i.title].filter(Boolean).join(' — ') || i.refCode
    return `• [${label}] <${i.url}|${name}> — *${i.overdueDays}일 지연* (${i.baseLabel})`
  })
  if (items.length > MAX) lines.push(`… 외 ${items.length - MAX}건`)
  const body = `:alarm_clock: *지연 업무 ${items.length}건*\n${lines.join('\n')}`
  const text = `⏰ 지연 업무 ${items.length}건`
  return { text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: body } }] }
}

/** 지연 채널 요약 발송 (12시간 내 동일 멤버십 재발송 방지) */
async function sendDelayChannelSummary(items: DelayedItem[]): Promise<void> {
  const sig = items.map((i) => i.refCode).sort().join(',')
  const recent = await prisma.notificationLog.findFirst({
    where: { eventType: 'delayed', targetType: 'channel', status: 'sent', createdAt: { gte: new Date(Date.now() - 12 * 3600 * 1000) } },
    orderBy: { id: 'desc' },
    select: { payload: true },
  })
  if (((recent?.payload as { sig?: string } | null)?.sig) === sig) {
    console.log('[notify] 지연 요약 동일 멤버십 — 재발송 스킵')
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
// Phase 4 — 담당자 DM (지연 리마인드)
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

/** 지연 업무 담당자 DM. 조용시간·주말 제한 없음, dedupHours 내 재발송만 차단(상한 무제한) */
async function sendDelayDMs(items: DelayedItem[]): Promise<void> {
  const mode = getSlackMode()
  if (mode === 'off') return // off면 담당자 매핑 조회(Slack API)조차 하지 않음

  const policy = await getDmPolicy()
  const since = new Date(Date.now() - policy.dedupHours * 3600 * 1000)

  for (const item of items) {
    const label = TASK_TYPE_LABELS[item.taskType]
    const name = [item.hospitalName, item.title].filter(Boolean).join(' — ') || item.refCode

    for (const u of item.assignees) {
      // 계정별 Slack 발송 플래그 off → 스킵 (스킵 로그도 dedupHours당 1건만)
      if (!u.slackNotifyEnabled) {
        const dupSkip = await prisma.notificationLog.findFirst({
          where: { eventType: 'delayed', targetType: 'dm', refCode: item.refCode, targetId: `user:${u.id}`, status: 'skipped', createdAt: { gte: since } },
          select: { id: true },
        })
        if (!dupSkip) await recordLog({ eventType: 'delayed', taskType: item.taskType, refCode: item.refCode, targetType: 'dm', targetId: `user:${u.id}`, status: 'skipped', error: 'user_opt_out', payload: { dmTo: u.name } })
        continue
      }

      const sid = await resolveSlackUserId(u)
      const targetId = sid ?? `email:${u.email}`

      // 매핑 실패 → 스킵 로그 (에러 아님, dedupHours당 1건만)
      if (!sid) {
        const dupSkip = await prisma.notificationLog.findFirst({
          where: { eventType: 'delayed', targetType: 'dm', refCode: item.refCode, targetId, status: 'skipped', createdAt: { gte: since } },
          select: { id: true },
        })
        if (!dupSkip) await recordLog({ eventType: 'delayed', taskType: item.taskType, refCode: item.refCode, targetType: 'dm', targetId, status: 'skipped', error: 'no_slack_mapping', payload: { dmTo: u.name } })
        continue
      }

      // dedup: 같은 건·같은 사람에게 dedupHours 내 이미 발송했으면 스킵
      const dup = await prisma.notificationLog.findFirst({
        where: { eventType: 'delayed', targetType: 'dm', refCode: item.refCode, targetId: sid, status: 'sent', createdAt: { gte: since } },
        select: { id: true },
      })
      if (dup) continue

      const dmText = `:alarm_clock: 지연 알림 — [${label}] ${name} (*${item.overdueDays}일 지연*, ${item.baseLabel})\n완료됐다면 상태를 갱신해주세요.\n${item.url}`
      // test 모드: 실제 담당자가 아닌 테스트 채널로 라우팅
      const channel = mode === 'test' ? process.env.SLACK_CHANNEL_TEST || '' : sid
      const body = mode === 'test' ? `[DEV][DM→${u.name}] ${dmText}` : dmText

      const res = channel ? await slackPostMessage(channel, { text: body }) : { ok: false, skipped: true, error: 'no_channel' as const }
      await recordLog({
        eventType: 'delayed',
        taskType: item.taskType,
        refCode: item.refCode,
        targetType: 'dm',
        targetId: sid,
        status: res.ok ? 'sent' : res.skipped ? 'skipped' : 'failed',
        error: res.error,
        payload: { mode, dmTo: u.name, overdueDays: item.overdueDays, textPreview: body.slice(0, 300) },
      })
    }
  }
}

/**
 * 지연 알림 실행 (notify-scheduler가 주기적으로 호출).
 * 전역 off·지연 0건이면 미발송. 채널 요약 + (DM 사용 시) 담당자 DM.
 * best-effort — throw하지 않음.
 */
export async function runDelayNotifications(): Promise<void> {
  try {
    const g = await prisma.appSetting.findUnique({ where: { key: 'notify_enabled' } })
    if ((g?.value ?? 'off') !== 'on') return

    const items = await findDelayedTasks()
    if (items.length === 0) {
      console.log('[notify] 지연 업무 없음 — 미발송')
      return
    }

    await sendDelayChannelSummary(items)
    if (await dmEnabled()) await sendDelayDMs(items)
  } catch (err) {
    console.error('[notify] runDelayNotifications 예외:', err)
  }
}
