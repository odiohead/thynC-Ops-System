/**
 * Slack 채널 라우팅 (1.1 P3 — projects/notification_v1.1_design.md §5.1)
 *
 * 이벤트 + 티켓 속성 → 발송할 채널 N개.
 * SLA 정책(`lib/sla.ts`)과 **같은 매칭 의미론**을 쓴다: 축 간 AND, 배열 내부 OR, 빈 배열 = 제한 없음.
 * 단 정책과 다른 점 — **매칭된 규칙을 전부 실행**한다(다중 채널 발송이 요구사항 R7).
 * 같은 채널이 여러 규칙에 걸리면 1건으로 합치고, 멘션은 더 강한 쪽을 채택한다.
 */

import { prisma } from '@/lib/prisma'
import type { TicketSeverity, TicketStatus } from '@prisma/client'
import { ctiAncestors } from '@/lib/sla'

export const NOTIFY_ROUTE_EVENTS = [
  'TICKET_CREATED',
  'TICKET_STATUS_CHANGED',
  'TICKET_QUEUE_TRANSFERRED',
  'SEV_ESCALATED',
  'SLA_BREACH',
  'SLA_WARNING',
  'DAILY_DIGEST',
] as const
export type NotifyRouteEvent = (typeof NOTIFY_ROUTE_EVENTS)[number]

export const MENTION_MODES = ['none', 'queue_members', 'channel', 'here'] as const
export type MentionMode = (typeof MENTION_MODES)[number]

/** 멘션 강도 — 같은 채널에 여러 규칙이 걸리면 강한 쪽을 쓴다 */
const MENTION_RANK: Record<MentionMode, number> = { none: 0, queue_members: 1, here: 2, channel: 3 }

export interface DigestOpts {
  kinds: ('overdue' | 'warning')[]
  groupBy: 'queue' | 'refType' | 'none'
  maxPerSection: number
}
export const DEFAULT_DIGEST_OPTS: DigestOpts = { kinds: ['overdue', 'warning'], groupBy: 'queue', maxPerSection: 20 }

export function parseDigestOpts(raw: unknown): DigestOpts {
  const o = (raw ?? {}) as Partial<DigestOpts>
  const kinds = Array.isArray(o.kinds) ? o.kinds.filter((k) => k === 'overdue' || k === 'warning') : DEFAULT_DIGEST_OPTS.kinds
  return {
    kinds: kinds.length ? kinds : DEFAULT_DIGEST_OPTS.kinds,
    groupBy: o.groupBy === 'refType' || o.groupBy === 'none' ? o.groupBy : 'queue',
    maxPerSection: Number.isFinite(o.maxPerSection) && (o.maxPerSection as number) > 0 ? Math.floor(o.maxPerSection as number) : DEFAULT_DIGEST_OPTS.maxPerSection,
  }
}

/** 라우팅 매칭 입력 — 티켓 이벤트 */
export interface RouteMatchInput {
  refType: string | null
  queueId: number
  ctiId: number | null
  severity: TicketSeverity
  /** 상태 변경 이벤트에서 "바뀐 뒤 상태" */
  statusTo?: TicketStatus | null
  /** SLA 이벤트에서 대상 metric */
  metric?: string | null
}

export interface ResolvedChannel {
  channelId: number
  channelName: string
  slackChannelId: string
  mentionMode: MentionMode
  /** 이 채널로 발송하게 만든 규칙들 (로그·디버깅용) */
  routeIds: number[]
}

const ROUTE_SELECT = {
  id: true, name: true, eventType: true, refTypes: true, queueIds: true, ctiIds: true,
  severities: true, statusTo: true, metrics: true, mentionMode: true, digestHour: true, digestOpts: true,
  channel: { select: { id: true, name: true, slackChannelId: true, isActive: true } },
} as const

type RouteRow = {
  id: number
  name: string
  eventType: string
  refTypes: string[]
  queueIds: number[]
  ctiIds: number[]
  severities: string[]
  statusTo: string[]
  metrics: string[]
  mentionMode: string
  digestHour: number | null
  digestOpts: unknown
  channel: { id: number; name: string; slackChannelId: string; isActive: boolean }
}

/** 규칙 1건이 이 이벤트에 매칭되는지 */
function matches(r: RouteRow, input: RouteMatchInput, ancestors: number[]): boolean {
  const refKey = input.refType ?? 'NONE' // 순수 티켓
  if (r.refTypes.length > 0 && !r.refTypes.includes(refKey)) return false
  if (r.queueIds.length > 0 && !r.queueIds.includes(input.queueId)) return false
  if (r.ctiIds.length > 0 && !r.ctiIds.some((id) => ancestors.includes(id))) return false
  if (r.severities.length > 0 && !r.severities.includes(input.severity)) return false
  if (r.statusTo.length > 0 && (!input.statusTo || !r.statusTo.includes(input.statusTo))) return false
  if (r.metrics.length > 0 && (!input.metric || !r.metrics.includes(input.metric))) return false
  return true
}

/**
 * 이벤트 → 발송 채널 목록.
 * 여러 이벤트 타입을 한 번에 넘길 수 있다(복합 변경 = 상태+큐 동시 변경 시 1메시지로 합쳐 보내기 위함).
 */
export async function resolveChannels(
  eventTypes: NotifyRouteEvent[],
  input: RouteMatchInput
): Promise<ResolvedChannel[]> {
  if (eventTypes.length === 0) return []
  const routes = (await prisma.notifyRoute.findMany({
    where: { isActive: true, eventType: { in: eventTypes }, channel: { isActive: true } },
    select: ROUTE_SELECT,
    orderBy: { sortOrder: 'asc' },
  })) as RouteRow[]
  if (routes.length === 0) return []

  const ancestors = await ctiAncestors(input.ctiId)
  const byChannel = new Map<string, ResolvedChannel>()

  for (const r of routes) {
    if (!matches(r, input, ancestors)) continue
    const key = r.channel.slackChannelId
    const mode = (MENTION_MODES as readonly string[]).includes(r.mentionMode) ? (r.mentionMode as MentionMode) : 'none'
    const prev = byChannel.get(key)
    if (prev) {
      // 같은 채널 중복 매칭 → 1건으로 합치고 멘션은 강한 쪽
      prev.routeIds.push(r.id)
      if (MENTION_RANK[mode] > MENTION_RANK[prev.mentionMode]) prev.mentionMode = mode
    } else {
      byChannel.set(key, {
        channelId: r.channel.id,
        channelName: r.channel.name,
        slackChannelId: r.channel.slackChannelId,
        mentionMode: mode,
        routeIds: [r.id],
      })
    }
  }
  return Array.from(byChannel.values())
}

export interface DigestRoute {
  routeId: number
  routeName: string
  channelId: number
  channelName: string
  slackChannelId: string
  digestHour: number
  opts: DigestOpts
  /** 요약 대상 스코프 — 비어 있으면 전체 */
  refTypes: string[]
  queueIds: number[]
  severities: string[]
}

/** 활성 DAILY_DIGEST 규칙 목록 (스케줄러가 시각 도달을 판정) */
export async function listDigestRoutes(): Promise<DigestRoute[]> {
  const routes = (await prisma.notifyRoute.findMany({
    where: { isActive: true, eventType: 'DAILY_DIGEST', channel: { isActive: true } },
    select: ROUTE_SELECT,
    orderBy: { sortOrder: 'asc' },
  })) as RouteRow[]

  return routes
    .filter((r) => r.digestHour != null)
    .map((r) => ({
      routeId: r.id,
      routeName: r.name,
      channelId: r.channel.id,
      channelName: r.channel.name,
      slackChannelId: r.channel.slackChannelId,
      digestHour: r.digestHour as number,
      opts: parseDigestOpts(r.digestOpts),
      refTypes: r.refTypes,
      queueIds: r.queueIds,
      severities: r.severities,
    }))
}
