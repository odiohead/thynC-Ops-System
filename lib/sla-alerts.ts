/**
 * SLA 알림 발송 (1.1 P4 — projects/notification_v1.1_design.md §5.2·§5.3)
 *
 * 두 가지를 담당한다.
 *  ① **초과 즉시 알림** — 기한이 지난 그 시점(tick 주기 내)에 1건씩. `notified_breach_at`으로 1회성 보장
 *  ② **일 1회 다이제스트** — 규칙별 지정 시각(KST) 이후 첫 tick에서 그날 아직 안 보냈으면 발송
 *
 * 설계상 중요한 두 가지:
 * - 시계 계산(`lib/sla.ts`)과 발송(이 파일)이 분리돼 있다. 여기서는 시계를 만들지 않고 초과분만 집어간다
 * - 발송 여부의 근거는 DB(`ticket_sla_clocks.notified_breach_at`, `notification_logs`)에 있다.
 *   메모리 타이머에 의존하지 않으므로 **서버를 재시작해도 중복 발송되지 않는다**(1.0 setInterval 방식의 약점 해소)
 */

import { prisma } from '@/lib/prisma'
import { getSlackMode } from '@/lib/slack'
import { dispatchToChannel, getTypesEnabled, type TaskType } from '@/lib/notify'
import { resolveChannels, type DigestOpts } from '@/lib/notify-routes'
import { findSlaRisk, formatDuration, SLA_METRIC_LABELS, type SlaMetric, type SlaRiskItem } from '@/lib/sla'
import { refTypeToTaskType } from '@/lib/notifyFields'
import { emitNotification, ticketRecipients } from '@/lib/notify-center'
import { TASK_TYPE_LABELS } from '@/lib/notifyFields'
import { TICKET_SEVERITY_LABELS } from '@/lib/ticket-shared'
import type { TicketSeverity } from '@prisma/client'

const KST_OFFSET = 9 * 3600 * 1000
const sevShort = (sev: TicketSeverity): string => TICKET_SEVERITY_LABELS[sev].split(' ')[0]

/** 전역 킬스위치 — notify_enabled */
async function globalEnabled(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: 'notify_enabled' } })
  return (row?.value ?? 'off') === 'on'
}

/** tick당 즉시 알림 상한 (기본 20) — 초과분이 몰려도 채널이 도배되지 않게 */
async function breachTickCap(): Promise<number> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'notify_breach_tick_cap' } })
    const n = parseInt(row?.value ?? '')
    return Number.isFinite(n) && n > 0 ? n : 20
  } catch {
    return 20
  }
}

/** KST 기준 오늘 자정(UTC 인스턴트) */
function kstMidnight(now = new Date()): Date {
  const k = new Date(now.getTime() + KST_OFFSET)
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST_OFFSET)
}
/** KST 기준 현재 시각(0~23) */
function kstHour(now = new Date()): number {
  return new Date(now.getTime() + KST_OFFSET).getUTCHours()
}
function kstYmd(now = new Date()): string {
  const k = new Date(now.getTime() + KST_OFFSET)
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`
}

// ─────────────────────────────────────────────────────────────
// ① 초과 즉시 알림
// ─────────────────────────────────────────────────────────────

const CLOCK_TICKET_SELECT = {
  metric: true, statusScope: true, dueAt: true, thresholdMin: true,
  // 정책별 초과 알림 채널 (v2 P3) — 지정 시 라우팅보다 우선
  policy: { select: { notifyChannel: { select: { id: true, name: true, slackChannelId: true, isActive: true } } } },
  ticket: {
    select: {
      id: true, ticketCode: true, title: true, status: true, severity: true, refType: true,
      queueId: true, ctiId: true, ownerId: true,
      queue: { select: { name: true } },
      hospital: { select: { hospitalName: true } },
      owner: { select: { name: true } },
    },
  },
} as const

/** 시계의 발송 채널 결정 (v2 P3) — 정책 채널 우선, 없으면 이벤트 라우팅 폴백 */
async function clockChannels(
  c: { policy: { notifyChannel: { id: number; name: string; slackChannelId: string; isActive: boolean } | null } | null; metric: string },
  t: { refType: string | null; queueId: number; ctiId: number | null; severity: TicketSeverity },
  event: 'SLA_BREACH' | 'SLA_WARNING'
) {
  const pc = c.policy?.notifyChannel
  if (pc && pc.isActive) {
    return [{ channelId: pc.id, channelName: pc.name, slackChannelId: pc.slackChannelId, mentionMode: 'none' as const, routeIds: [] }]
  }
  return resolveChannels([event], {
    refType: t.refType, queueId: t.queueId, ctiId: t.ctiId, severity: t.severity, metric: c.metric,
  })
}

function breachMessage(args: {
  ticketCode: string
  taskType: TaskType
  metric: SlaMetric
  statusScope: string | null
  overdueMin: number
  severity: TicketSeverity
  queueName: string
  hospitalName: string | null
  title: string
  ownerName: string | null
  mentionLine: string | null
}): { text: string; blocks: unknown[] } {
  const base = process.env.NEXT_PUBLIC_APP_URL || ''
  const label = TASK_TYPE_LABELS[args.taskType]
  const name = [args.hospitalName, args.title].filter(Boolean).join(' — ') || args.ticketCode
  const metricLabel = SLA_METRIC_LABELS[args.metric] + (args.statusScope ? `(${args.statusScope})` : '')

  const lines = [
    `:alarm_clock: *SLA 초과* — *[${label}] ${args.ticketCode}* · ${sevShort(args.severity)} · ${args.queueName}`,
    `<${base}/tickets/${args.ticketCode}|${name}>`,
    `:hourglass: ${metricLabel} 목표 *${formatDuration(args.overdueMin)} 초과*`,
    `:bust_in_silhouette: 담당 ${args.ownerName ?? '미배정'}`,
  ]
  if (args.mentionLine) lines.push(`:bell: ${args.mentionLine}`)

  return {
    text: `⏰ SLA 초과 [${label}] ${args.ticketCode} ${name} — ${metricLabel} ${formatDuration(args.overdueMin)} 초과`,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } }],
  }
}

/**
 * 기한이 지난 시계를 찾아 BREACHED로 확정하고, 아직 알리지 않은 건을 채널로 발송한다.
 * 반환: { marked, sent } — marked는 이번 tick에 초과로 확정된 수, sent는 실제 발송 건수
 */
export async function runSlaBreachAlerts(): Promise<{ marked: number; sent: number; pending: number }> {
  const now = new Date()
  const cap = await breachTickCap()

  // (1) RUNNING인데 기한이 지난 시계 → BREACHED 확정 (부분 인덱스 사용)
  //     정지(PAUSED)·종결 티켓은 대상 아님. 알림 마킹은 하지 않는다(아래 (2)에서 발송 후 마킹)
  const overdue = await prisma.ticketSlaClock.findMany({
    where: {
      state: 'RUNNING',
      dueAt: { lte: now },
      ticket: { status: { notIn: ['RESOLVED', 'CLOSED'] } },
    },
    select: { id: true },
    take: cap * 5, // 확정은 넉넉히, 발송은 cap으로 제한
  })
  if (overdue.length > 0) {
    await prisma.ticketSlaClock.updateMany({
      where: { id: { in: overdue.map((c) => c.id) }, state: 'RUNNING' },
      data: { state: 'BREACHED', breachedAt: now },
    })
  }

  // (2) 아직 알리지 않은 초과 시계 → 발송
  const pendingAll = await prisma.ticketSlaClock.count({
    where: { state: 'BREACHED', notifiedBreachAt: null, ticket: { status: { notIn: ['RESOLVED', 'CLOSED'] } } },
  })
  const pending = await prisma.ticketSlaClock.findMany({
    where: { state: 'BREACHED', notifiedBreachAt: null, ticket: { status: { notIn: ['RESOLVED', 'CLOSED'] } } },
    select: { id: true, ...CLOCK_TICKET_SELECT },
    orderBy: { dueAt: 'asc' },
    take: cap,
  })
  if (pending.length === 0) return { marked: overdue.length, sent: 0, pending: pendingAll }

  const types = await getTypesEnabled()
  let sent = 0

  for (const c of pending) {
    const t = c.ticket
    const taskType = refTypeToTaskType(t.refType)
    // 업무 타입 킬스위치가 꺼져 있으면 발송하지 않지만, 재시도 루프를 막기 위해 마킹은 한다
    const allowed = types[taskType]
    if (allowed) {
      const overdueMin = Math.max(0, (now.getTime() - c.dueAt.getTime()) / 60_000)
      const channels = await clockChannels(c, t, 'SLA_BREACH')
      if (channels.length === 0) {
        await prisma.ticketSlaClock.update({ where: { id: c.id }, data: { notifiedBreachAt: now } })
        continue
      }
      for (const ch of channels) {
        const { text, blocks } = breachMessage({
          ticketCode: t.ticketCode, taskType, metric: c.metric as SlaMetric, statusScope: c.statusScope,
          overdueMin, severity: t.severity, queueName: t.queue.name,
          hospitalName: t.hospital?.hospitalName ?? null, title: t.title,
          ownerName: t.owner?.name ?? null,
          mentionLine: ch.mentionMode === 'channel' ? '<!channel>' : ch.mentionMode === 'here' ? '<!here>' : null,
        })
        await dispatchToChannel({
          intendedChannel: ch.slackChannelId,
          channelName: ch.channelName,
          routeIds: ch.routeIds,
          eventType: 'delayed',
          taskType,
          refCode: t.ticketCode,
          text,
          blocks,
          sig: `breach|${c.metric}|${c.statusScope ?? ''}`,
        })
      }
      sent++
    }
    // 내부 알림 (P5) — Slack 채널 규칙·타입 킬스위치와 **무관하게** 적재한다.
    // 시스템 안에서 SLA 초과를 인지할 수 있어야 한다는 것이 요구사항(R9)이므로 Slack이 꺼져도 남는다
    const metricLabel = SLA_METRIC_LABELS[c.metric as SlaMetric] + (c.statusScope ? `(${c.statusScope})` : '')
    const overMin = Math.max(0, (now.getTime() - c.dueAt.getTime()) / 60_000)
    await emitNotification({
      kind: 'SLA_BREACH',
      userIds: await ticketRecipients(t.id),
      title: `SLA 초과 — ${t.ticketCode} ${metricLabel} ${formatDuration(overMin)} 초과`,
      body: [t.hospital?.hospitalName, t.title].filter(Boolean).join(' — ') || t.ticketCode,
      link: `/tickets/${t.ticketCode}`,
      ticketId: t.id, refType: t.refType, refCode: t.ticketCode, severity: t.severity,
      dedupKey: `breach:${c.id}`,
    })

    // 발송(또는 스킵) 후 1회성 마킹 — 같은 초과로 다시 알리지 않는다
    await prisma.ticketSlaClock.update({ where: { id: c.id }, data: { notifiedBreachAt: now } })
  }

  return { marked: overdue.length, sent, pending: pendingAll }
}

// ─────────────────────────────────────────────────────────────
// ①-b 임박(WARNING) 알림 (v2 P3 — F2 배선. 1.1에서 상수·컬럼만 있고 발송 코드가 없던 것)
// ─────────────────────────────────────────────────────────────

/**
 * warnRatio(기본 80%) 경과 시점에 1회 알림. `notified_warn_at`으로 1회성 보장.
 * 채널은 초과 알림과 동일 규칙(정책 채널 우선 → SLA_WARNING 라우팅 폴백) —
 * 라우팅 규칙도 정책 채널도 없으면 발송하지 않는다(마킹만).
 */
export async function runSlaWarnAlerts(): Promise<{ sent: number }> {
  const now = new Date()
  const cap = await breachTickCap()

  const candidates = await prisma.ticketSlaClock.findMany({
    where: {
      state: 'RUNNING',
      notifiedWarnAt: null,
      dueAt: { gt: now },
      ticket: { status: { notIn: ['RESOLVED', 'CLOSED'] } },
    },
    select: { id: true, target: { select: { warnRatio: true } }, ...CLOCK_TICKET_SELECT },
    orderBy: { dueAt: 'asc' },
    take: cap * 5,
  })

  const types = await getTypesEnabled()
  let sent = 0

  for (const c of candidates) {
    if (sent >= cap) break
    const warnRatio = c.target?.warnRatio ?? 80
    // 임박 시점 = 기한 - 목표시간의 (100-warnRatio)% (정지 누적은 dueAt에 이미 반영돼 있음)
    const warnAt = new Date(c.dueAt.getTime() - c.thresholdMin * 60_000 * (1 - warnRatio / 100))
    if (now < warnAt) continue

    const t = c.ticket
    const taskType = refTypeToTaskType(t.refType)
    if (types[taskType]) {
      const remainMin = Math.max(0, (c.dueAt.getTime() - now.getTime()) / 60_000)
      const channels = await clockChannels(c, t, 'SLA_WARNING')
      if (channels.length > 0) {
        const metricLabel = SLA_METRIC_LABELS[c.metric as SlaMetric] + (c.statusScope ? `(${c.statusScope})` : '')
        const base = process.env.NEXT_PUBLIC_APP_URL || ''
        const name = [t.hospital?.hospitalName, t.title].filter(Boolean).join(' — ') || t.ticketCode
        for (const ch of channels) {
          await dispatchToChannel({
            intendedChannel: ch.slackChannelId,
            channelName: ch.channelName,
            routeIds: ch.routeIds,
            eventType: 'delayed',
            taskType,
            refCode: t.ticketCode,
            text: `⏳ SLA 임박 [${TASK_TYPE_LABELS[taskType]}] ${t.ticketCode} ${name} — ${metricLabel} 남은 시간 ${formatDuration(remainMin)}`,
            blocks: [{
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: [
                  `:hourglass_flowing_sand: *SLA 임박* — *[${TASK_TYPE_LABELS[taskType]}] ${t.ticketCode}* · ${sevShort(t.severity)} · ${t.queue.name}`,
                  `<${base}/tickets/${t.ticketCode}|${name}>`,
                  `:dart: ${metricLabel} 기한까지 *${formatDuration(remainMin)}* 남음 (${warnRatio}% 경과)`,
                  `:bust_in_silhouette: 담당 ${t.owner?.name ?? '미배정'}`,
                ].join('\n'),
              },
            }],
            sig: `warn|${c.metric}|${c.statusScope ?? ''}`,
          })
        }
        sent++
      }
      // 내부 알림 — Slack 여부와 무관하게 적재
      await emitNotification({
        kind: 'SLA_WARNING',
        userIds: await ticketRecipients(t.id),
        title: `SLA 임박 — ${t.ticketCode} ${SLA_METRIC_LABELS[c.metric as SlaMetric]} 기한 임박`,
        body: [t.hospital?.hospitalName, t.title].filter(Boolean).join(' — ') || t.ticketCode,
        link: `/tickets/${t.ticketCode}`,
        ticketId: t.id, refType: t.refType, refCode: t.ticketCode, severity: t.severity,
        dedupKey: `warn:${c.id}`,
      })
    }
    await prisma.ticketSlaClock.update({ where: { id: c.id }, data: { notifiedWarnAt: now } })
  }
  return { sent }
}

// ─────────────────────────────────────────────────────────────
// ② 일 1회 다이제스트
// ─────────────────────────────────────────────────────────────

function riskLine(i: SlaRiskItem): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || ''
  const label = TASK_TYPE_LABELS[refTypeToTaskType(i.refType)]
  const name = [i.hospitalName, i.title].filter(Boolean).join(' — ') || i.ticketCode
  return `• [${label}] <${base}/tickets/${i.ticketCode}|${i.ticketCode} ${name}> — ${sevShort(i.severity)} · *${i.label}*`
}

/** 다이제스트 본문 — 종류(초과/임박) × 그룹(Assignment Group·유형) 섹션 */
export function buildDigestMessage(items: SlaRiskItem[], opts: DigestOpts, routeName: string): { text: string; blocks: unknown[] } {
  const sections: string[] = []
  const counts = { overdue: 0, warning: 0 }

  for (const kind of opts.kinds) {
    const group = items.filter((i) => i.kind === kind)
    counts[kind] = group.length
    if (group.length === 0) continue

    const head = kind === 'overdue' ? ':alarm_clock: *SLA 초과' : ':hourglass_flowing_sand: *SLA 임박'
    if (opts.groupBy === 'none') {
      const lines = group.slice(0, opts.maxPerSection).map(riskLine)
      if (group.length > opts.maxPerSection) lines.push(`… 외 ${group.length - opts.maxPerSection}건`)
      sections.push(`${head} ${group.length}건*\n${lines.join('\n')}`)
    } else {
      const keyOf = (i: SlaRiskItem) =>
        opts.groupBy === 'queue' ? i.queueName : TASK_TYPE_LABELS[refTypeToTaskType(i.refType)]
      const buckets = new Map<string, SlaRiskItem[]>()
      for (const i of group) buckets.set(keyOf(i), [...(buckets.get(keyOf(i)) ?? []), i])
      const parts = Array.from(buckets.entries())
        .sort((a, b) => b[1].length - a[1].length)
        .map(([k, list]) => {
          const lines = list.slice(0, opts.maxPerSection).map(riskLine)
          if (list.length > opts.maxPerSection) lines.push(`… 외 ${list.length - opts.maxPerSection}건`)
          return `_${k}_ ${list.length}건\n${lines.join('\n')}`
        })
      sections.push(`${head} ${group.length}건*\n${parts.join('\n')}`)
    }
  }

  if (sections.length === 0) sections.push(':white_check_mark: SLA 초과·임박 티켓이 없습니다.')

  const text = `⏰ ${routeName} — 초과 ${counts.overdue} · 임박 ${counts.warning}건 (${kstYmd()})`
  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*${routeName}* · ${kstYmd()} 기준` } },
      { type: 'section', text: { type: 'mrkdwn', text: sections.join('\n\n') } },
    ],
  }
}

const GLOBAL_DIGEST_OPTS: DigestOpts = { kinds: ['overdue', 'warning'], groupBy: 'queue', maxPerSection: 20 }
const GLOBAL_DIGEST_MARK = 0 // notification_logs payload.digestRouteId — 전역 요약 표식 (v2 P4)

/**
 * 전역 SLA 초과 요약 (v2 P4 — 확정 10: 전역 채널 1개 + 관리자 지정 시각).
 * 구 규칙별(DAILY_DIGEST 라우트) 방식을 대체 — 설정은 AppSetting
 * `notify_digest_hour`(KST 0~23, -1=off) + `notify_digest_channel_id`(notify_channels FK).
 * "오늘 이미 보냈는가"는 notification_logs(payload.digestRouteId=0 + KST 당일)로 판정 →
 * 서버 재시작·배포와 무관하게 하루 1회가 보장된다.
 */
export async function runDailyDigests(opts: { force?: boolean; dryRun?: boolean } = {}): Promise<
  { routeName: string; hour: number; status: 'sent' | 'skipped_not_due' | 'skipped_already' | 'dry'; count: number }[]
> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: ['notify_digest_hour', 'notify_digest_channel_id'] } },
  })
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const digestHour = parseInt(map['notify_digest_hour'] ?? '-1')
  const channelId = parseInt(map['notify_digest_channel_id'] ?? '')
  if (!Number.isFinite(digestHour) || digestHour < 0 || digestHour > 23) return []
  if (!Number.isFinite(channelId)) return []

  const channel = await prisma.notifyChannel.findUnique({ where: { id: channelId } })
  if (!channel || !channel.isActive) return []

  const now = new Date()
  const hour = kstHour(now)
  const routeName = 'SLA 일일 요약'

  if (!opts.force && hour < digestHour) {
    return [{ routeName, hour: digestHour, status: 'skipped_not_due', count: 0 }]
  }

  // 오늘 이미 발송했는지 (KST 당일 기준)
  if (!opts.force) {
    const already = await prisma.notificationLog.findFirst({
      where: {
        eventType: 'delayed', targetType: 'channel', status: 'sent',
        createdAt: { gte: kstMidnight(now) },
        payload: { path: ['digestRouteId'], equals: GLOBAL_DIGEST_MARK },
      },
      select: { id: true },
    })
    if (already) return [{ routeName, hour: digestHour, status: 'skipped_already', count: 0 }]
  }

  const types = await getTypesEnabled()
  const items = (await findSlaRisk({ includeWarning: true })).filter((i) => types[refTypeToTaskType(i.refType)])
  const { text, blocks } = buildDigestMessage(items, GLOBAL_DIGEST_OPTS, routeName)

  if (opts.dryRun) {
    console.log(`[sla-digest][dry] ${routeName} → ${channel.name}\n${text}`)
    return [{ routeName, hour: digestHour, status: 'dry', count: items.length }]
  }

  await dispatchToChannel({
    intendedChannel: channel.slackChannelId,
    channelName: channel.name,
    eventType: 'delayed',
    taskType: null,
    refCode: null,
    text,
    blocks,
    sig: `digest|${kstYmd(now)}|global`,
    digestRouteId: GLOBAL_DIGEST_MARK,
  })
  return [{ routeName, hour: digestHour, status: 'sent', count: items.length }]
}

/**
 * 스케줄러 진입점 — 전역(notify_enabled) off면 아무것도 하지 않는다.
 * Slack off는 여기서 막지 않는다 (v2 P1 F4) — 초과 확정·내부 알림은 Slack과 독립이어야 하고,
 * 채널 발송은 dispatchToChannel이 mode_off로 스킵한다. Slack 전용인 다이제스트만 아래에서 게이트.
 */
export async function runSlaAlertTick(): Promise<void> {
  if (!(await globalEnabled())) return

  try {
    const breach = await runSlaBreachAlerts()
    if (breach.marked > 0 || breach.sent > 0) {
      console.log(`[sla-alerts] 초과 확정 ${breach.marked} · 발송 ${breach.sent} · 대기 ${breach.pending}`)
    }
  } catch (err) {
    console.error('[sla-alerts] 초과 알림 실패:', err)
  }

  try {
    const warn = await runSlaWarnAlerts() // 임박 알림 (v2 P3 — F2 배선)
    if (warn.sent > 0) console.log(`[sla-alerts] 임박 발송 ${warn.sent}`)
  } catch (err) {
    console.error('[sla-alerts] 임박 알림 실패:', err)
  }

  if (getSlackMode() === 'off') return // 다이제스트는 Slack 전용

  try {
    const digests = await runDailyDigests()
    const sentOnes = digests.filter((d) => d.status === 'sent')
    if (sentOnes.length > 0) {
      console.log(`[sla-alerts] 일일 요약 발송: ${sentOnes.map((d) => `${d.routeName}(${d.count}건)`).join(', ')}`)
    }
  } catch (err) {
    console.error('[sla-alerts] 일일 요약 실패:', err)
  }
}
