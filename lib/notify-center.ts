/**
 * 알림 센터 — 시스템 내부 알림 생성의 단일 진입점 (1.1 P5 — §6)
 *
 * 설계 원칙
 * - **Slack과 독립**: Slack이 꺼져 있어도 내부 알림은 적재된다. 알림의 원본은 이 테이블이고 Slack은 어댑터다
 * - **본인 행동 제외**: 자기가 바꾼 걸 자기에게 알리지 않는다(actor == 수신자면 스킵)
 * - **dedup**: 같은 사건이 두 번 적재되지 않게 dedupKey(부분 UNIQUE)로 막는다
 * - **best-effort**: 알림 생성 실패가 업무 API를 깨지 않는다
 *
 * 향후 페이저 앱은 이 테이블을 소스로 푸시하면 되므로, 여기서 쌓는 데이터가 곧 앱의 입력이다.
 */

import { prisma } from '@/lib/prisma'
import type { TicketSeverity } from '@prisma/client'

export const NOTIFY_KINDS = [
  'TICKET_ASSIGNED',
  'TICKET_UNASSIGNED_IN_MY_QUEUE',
  'TICKET_STATUS_CHANGED',
  'TICKET_COMMENT',
  'SLA_WARNING',
  'SLA_BREACH',
] as const
export type NotifyKind = (typeof NOTIFY_KINDS)[number]

export const NOTIFY_KIND_LABELS: Record<NotifyKind, string> = {
  TICKET_ASSIGNED: '티켓 배정',
  TICKET_UNASSIGNED_IN_MY_QUEUE: '내 그룹 미배정 티켓',
  TICKET_STATUS_CHANGED: '상태 변경',
  TICKET_COMMENT: '코멘트',
  SLA_WARNING: 'SLA 임박',
  SLA_BREACH: 'SLA 초과',
}

/** 종류별 기본 수신값 — prefs 행이 없으면 이 값이 적용된다(계정마다 행을 미리 만들지 않는다) */
export const NOTIFY_KIND_DEFAULTS: Record<NotifyKind, { inApp: boolean; slackDm: boolean }> = {
  TICKET_ASSIGNED: { inApp: true, slackDm: true },
  TICKET_UNASSIGNED_IN_MY_QUEUE: { inApp: true, slackDm: false },
  TICKET_STATUS_CHANGED: { inApp: true, slackDm: false },
  TICKET_COMMENT: { inApp: true, slackDm: false },
  SLA_WARNING: { inApp: true, slackDm: false },
  SLA_BREACH: { inApp: true, slackDm: true },
}

export interface EmitInput {
  kind: NotifyKind
  /** 수신자 후보 — 중복·본인 제외는 내부에서 처리 */
  userIds: (string | null | undefined)[]
  title: string
  body?: string | null
  link: string
  ticketId?: number | null
  refType?: string | null
  refCode?: string | null
  severity?: TicketSeverity | string | null
  actorId?: string | null
  actorName?: string | null
  /** 같은 사건 중복 적재 방지 키 — 수신자별로 `:${userId}`가 자동 붙는다 */
  dedupKey?: string | null
}

/** kind별 in-app 수신 여부 (prefs 우선, 없으면 기본값) */
async function inAppAllowed(kind: NotifyKind, userIds: string[]): Promise<Set<string>> {
  const allowed = new Set(userIds)
  if (userIds.length === 0) return allowed
  const prefs = await prisma.notificationPref.findMany({
    where: { kind, userId: { in: userIds } },
    select: { userId: true, inApp: true },
  })
  for (const p of prefs) if (!p.inApp) allowed.delete(p.userId)
  return allowed
}

/**
 * 알림 적재. 반환값은 실제로 만들어진 건수.
 * 절대 throw하지 않는다 — 호출부(티켓 mutation)를 깨뜨리지 않기 위해.
 */
export async function emitNotification(input: EmitInput): Promise<number> {
  try {
    // 수신자 정리: 중복 제거 + 본인(actor) 제외 + 비활성 계정 제외
    const candidates = Array.from(new Set(input.userIds.filter((u): u is string => !!u))).filter(
      (u) => u !== input.actorId
    )
    if (candidates.length === 0) return 0

    const active = await prisma.user.findMany({
      where: { id: { in: candidates }, isActive: true },
      select: { id: true },
    })
    const activeIds = active.map((u) => u.id)
    if (activeIds.length === 0) return 0

    const allowed = await inAppAllowed(input.kind, activeIds)
    if (allowed.size === 0) return 0

    const rows = Array.from(allowed).map((userId) => ({
      userId,
      kind: input.kind,
      title: input.title.slice(0, 200),
      body: input.body ?? null,
      link: input.link.slice(0, 300),
      ticketId: input.ticketId ?? null,
      refType: input.refType ?? null,
      refCode: input.refCode ?? null,
      severity: input.severity ? String(input.severity) : null,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      // 수신자별 키 — 같은 사건이 같은 사람에게 두 번 적재되지 않는다
      dedupKey: input.dedupKey ? `${input.dedupKey}:${userId}`.slice(0, 200) : null,
    }))

    // dedupKey 충돌은 무시(이미 적재된 사건) — skipDuplicates로 부분 UNIQUE를 활용
    const res = await prisma.notification.createMany({ data: rows, skipDuplicates: true })
    return res.count
  } catch (err) {
    console.error('[notify-center] 알림 적재 실패:', err)
    return 0
  }
}

/** 티켓 알림용 수신자 묶음 — owner + 참여자 (+owner 없으면 그룹 멤버) */
export async function ticketRecipients(
  ticketId: number,
  opts: { includeParticipants?: boolean; fallbackToQueueMembers?: boolean } = {}
): Promise<string[]> {
  const t = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      ownerId: true,
      queueId: true,
      participants: { select: { userId: true } },
    },
  })
  if (!t) return []

  const out: string[] = []
  if (t.ownerId) out.push(t.ownerId)
  if (opts.includeParticipants !== false) out.push(...t.participants.map((p) => p.userId))

  // owner가 없으면 그룹(Assignment Group) 멤버가 수신자 — "큐 대기" 티켓의 알림이 사라지지 않게
  if (!t.ownerId && opts.fallbackToQueueMembers !== false) {
    const members = await prisma.ticketQueueMember.findMany({
      where: { queueId: t.queueId },
      select: { userId: true },
    })
    out.push(...members.map((m) => m.userId))
  }
  return Array.from(new Set(out))
}

/** Assignment Group 멤버 (미배정 유입 알림용) */
export async function queueMemberIds(queueId: number): Promise<string[]> {
  const members = await prisma.ticketQueueMember.findMany({ where: { queueId }, select: { userId: true } })
  return members.map((m) => m.userId)
}
