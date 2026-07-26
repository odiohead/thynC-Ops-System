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
import { dispatchToChannel, getTypesEnabled, runSlaOwnerDms, type TaskType } from '@/lib/notify'
import { resolveChannels, listDigestRoutes, type DigestOpts } from '@/lib/notify-routes'
import { findSlaRisk, formatDuration, SLA_METRIC_LABELS, type SlaMetric, type SlaRiskItem } from '@/lib/sla'
import { refTypeToTaskType } from '@/lib/delay-rules'
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
      const channels = await resolveChannels(['SLA_BREACH'], {
        refType: t.refType, queueId: t.queueId, ctiId: t.ctiId, severity: t.severity,
        metric: c.metric,
      })
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

/**
 * 지정 시각이 지난 다이제스트 규칙을 찾아 그날 첫 1회만 발송한다.
 * "오늘 이미 보냈는가"는 notification_logs(payload.routeId + KST 당일)로 판정 →
 * 서버 재시작·배포와 무관하게 하루 1회가 보장된다.
 */
export async function runDailyDigests(opts: { force?: boolean; dryRun?: boolean } = {}): Promise<
  { routeName: string; hour: number; status: 'sent' | 'skipped_not_due' | 'skipped_already' | 'dry'; count: number }[]
> {
  const results: { routeName: string; hour: number; status: 'sent' | 'skipped_not_due' | 'skipped_already' | 'dry'; count: number }[] = []
  const routes = await listDigestRoutes()
  if (routes.length === 0) return results

  const now = new Date()
  const hour = kstHour(now)
  const midnight = kstMidnight(now)
  const types = await getTypesEnabled()
  const allRisk = await findSlaRisk({ includeWarning: true })

  for (const r of routes) {
    if (!opts.force && hour < r.digestHour) {
      results.push({ routeName: r.routeName, hour: r.digestHour, status: 'skipped_not_due', count: 0 })
      continue
    }

    // 오늘 이 규칙으로 이미 발송했는지 (KST 당일 기준)
    if (!opts.force) {
      const already = await prisma.notificationLog.findFirst({
        where: {
          eventType: 'delayed', targetType: 'channel', status: 'sent',
          createdAt: { gte: midnight },
          payload: { path: ['digestRouteId'], equals: r.routeId },
        },
        select: { id: true },
      })
      if (already) {
        results.push({ routeName: r.routeName, hour: r.digestHour, status: 'skipped_already', count: 0 })
        continue
      }
    }

    // 규칙 스코프로 필터 (빈 배열 = 전체) + 업무 타입 킬스위치
    const items = allRisk.filter((i) => {
      if (!r.opts.kinds.includes(i.kind)) return false
      if (!types[refTypeToTaskType(i.refType)]) return false
      const refKey = i.refType ?? 'NONE'
      if (r.refTypes.length > 0 && !r.refTypes.includes(refKey)) return false
      if (r.severities.length > 0 && !r.severities.includes(i.severity)) return false
      return true
    })

    const { text, blocks } = buildDigestMessage(items, r.opts, r.routeName)

    if (opts.dryRun) {
      results.push({ routeName: r.routeName, hour: r.digestHour, status: 'dry', count: items.length })
      console.log(`[sla-digest][dry] ${r.routeName} → ${r.channelName}\n${text}`)
      continue
    }

    await dispatchToChannel({
      intendedChannel: r.slackChannelId,
      channelName: r.channelName,
      routeIds: [r.routeId],
      eventType: 'delayed',
      taskType: null,
      refCode: null,
      text,
      blocks,
      sig: `digest|${kstYmd(now)}|${r.routeId}`,
      digestRouteId: r.routeId,
    })
    results.push({ routeName: r.routeName, hour: r.digestHour, status: 'sent', count: items.length })
  }
  return results
}

/** 스케줄러 진입점 — 전역 off거나 Slack off면 아무것도 하지 않는다 */
export async function runSlaAlertTick(): Promise<void> {
  if (!(await globalEnabled())) return
  if (getSlackMode() === 'off') return

  try {
    const breach = await runSlaBreachAlerts()
    if (breach.marked > 0 || breach.sent > 0) {
      console.log(`[sla-alerts] 초과 확정 ${breach.marked} · 발송 ${breach.sent} · 대기 ${breach.pending}`)
    }
  } catch (err) {
    console.error('[sla-alerts] 초과 알림 실패:', err)
  }

  try {
    await runSlaOwnerDms() // SLA 초과 owner 개인 DM (notify_dm_enabled 게이트)
  } catch (err) {
    console.error('[sla-alerts] owner DM 실패:', err)
  }

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
