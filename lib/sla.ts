/**
 * SLA 시계 엔진 (1.1 P1 — projects/notification_v1.1_design.md §4)
 *
 * 설계 원칙
 * - 시계 계산과 알림 발송을 분리한다. 이 파일은 계산·저장만 하고 절대 알림을 보내지 않는다.
 *   (초과분을 집어 알리는 것은 P4 스케줄러의 몫 — `notified_breach_at`이 NULL인 BREACHED 행이 그 대상)
 * - 티켓 1건이 metric별 여러 시계를 갖는다. 정책은 우선순위 1개만 승리(병합 없음).
 * - 진행 중 시계의 기준은 불변. 정책을 바꿔도 소급 재계산하지 않는다(명시적 재계산 액션에서만).
 * - best-effort: 시계 갱신 실패가 티켓 mutation을 깨뜨리지 않는다(호출부에서 catch).
 *
 * 용어
 * - anchor  : 시계 시작 기준 시각
 * - due_at  : 기한 = anchor + threshold(분) + 누적 정지시간
 * - MET     : 목표 달성(기한 내 완료) / BREACHED : 기한 초과 / CANCELED : 대상 아님으로 바뀜
 */

import { Prisma, TicketStatus, TicketSeverity } from '@prisma/client'
import { prisma } from '@/lib/prisma'

// ─────────────────────────────────────────────────────────────
// 상수·타입
// ─────────────────────────────────────────────────────────────

export const SLA_METRICS = ['ASSIGN', 'FIRST_RESPONSE', 'RESOLVE', 'UPDATE_STALE', 'DWELL', 'DOMAIN_DUE'] as const
export type SlaMetric = (typeof SLA_METRICS)[number]

export const SLA_METRIC_LABELS: Record<SlaMetric, string> = {
  ASSIGN: '배정까지',
  FIRST_RESPONSE: '첫 응답',
  RESOLVE: '해결까지',
  UPDATE_STALE: '무응답',
  DWELL: '상태 체류',
  DOMAIN_DUE: '도메인 기한',
}

export type ClockState = 'RUNNING' | 'PAUSED' | 'MET' | 'BREACHED' | 'CANCELED'

/** 시계가 정지하는 티켓 상태 — AWS 관례(대기 중에는 SLA 시계를 세지 않는다) */
const PAUSED_STATUSES: TicketStatus[] = ['PENDING']

/** 종료 상태 — 이 상태에 들어가면 진행 중 시계는 달성/취소로 확정된다 */
const CLOSED_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED']

/** DOMAIN_DUE 앵커 필드 — refType별 코드 고정 매핑(자유 입력 아님, §4.2) */
const DOMAIN_DUE_SUPPORTED: readonly string[] = ['PROJECT', 'SITE_VISIT', 'INSTALL_PLAN']

const MIN = 60_000

// ─────────────────────────────────────────────────────────────
// 티켓 컨텍스트 로드
// ─────────────────────────────────────────────────────────────

const TICKET_CTX_SELECT = {
  id: true,
  ticketCode: true,
  status: true,
  severity: true,
  queueId: true,
  ctiId: true,
  ownerId: true,
  refType: true,
  createdAt: true,
  statusChangedAt: true,
  resolvedAt: true,
  closedAt: true,
  dueAt: true,
  project: { select: { endDateExpected: true } },
  siteVisit: { select: { visitDate: true } },
  installPlan: { select: { replyDate: true } },
} as const

export type TicketSlaContext = Prisma.TicketGetPayload<{ select: typeof TICKET_CTX_SELECT }>

/** 도메인 기한 필드값 (refType별 고정 매핑) */
function domainDueAnchor(t: TicketSlaContext): Date | null {
  switch (t.refType) {
    case 'PROJECT': return t.project?.endDateExpected ?? null
    case 'SITE_VISIT': return t.siteVisit?.visitDate ?? null
    case 'INSTALL_PLAN': return t.installPlan?.replyDate ?? null
    default: return null
  }
}

// ─────────────────────────────────────────────────────────────
// 정책 매칭
// ─────────────────────────────────────────────────────────────

interface PolicyWithTargets {
  id: number
  priority: number
  refTypes: string[]
  queueIds: number[]
  ctiIds: number[]
  severities: string[]
  clockType: string
  targets: {
    id: number
    metric: string
    statusScope: string | null
    severity: string | null
    thresholdMin: number
    warnRatio: number
  }[]
}

/** CTI 조상 체인 캐시 — 정책의 ctiIds는 서브트리 상속이므로 티켓 CTI의 조상까지 비교해야 한다 */
let ctiParentCache: { at: number; map: Map<number, number | null> } | null = null
const CTI_CACHE_TTL = 60_000

/** CTI 조상 체인 (자신 포함) — 정책·라우팅의 ctiIds는 서브트리 상속이라 조상까지 비교해야 한다 */
export async function ctiAncestors(ctiId: number | null): Promise<number[]> {
  if (ctiId == null) return []
  if (!ctiParentCache || Date.now() - ctiParentCache.at > CTI_CACHE_TTL) {
    const nodes = await prisma.ticketCti.findMany({ select: { id: true, parentId: true } })
    ctiParentCache = { at: Date.now(), map: new Map(nodes.map((n) => [n.id, n.parentId])) }
  }
  const out: number[] = []
  let cur: number | null | undefined = ctiId
  // 깊이 3 고정이지만 순환 방어로 상한을 둔다
  for (let i = 0; cur != null && i < 10; i++) {
    out.push(cur)
    cur = ctiParentCache.map.get(cur) ?? null
  }
  return out
}

/**
 * 티켓에 적용될 정책 1개 선택 — 매칭 축은 AND, 배열 내부는 OR, 빈 배열은 제한 없음.
 * 여러 정책이 매칭되면 priority 오름차순 첫 번째만 승리(병합 없음 — §4.3).
 */
export async function matchPolicy(t: TicketSlaContext): Promise<PolicyWithTargets | null> {
  const policies = await prisma.slaPolicy.findMany({
    where: { isActive: true },
    orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    select: {
      id: true, priority: true, refTypes: true, queueIds: true, ctiIds: true,
      severities: true, clockType: true,
      targets: {
        where: { isActive: true },
        select: { id: true, metric: true, statusScope: true, severity: true, thresholdMin: true, warnRatio: true },
      },
    },
  })
  if (policies.length === 0) return null

  const ancestors = await ctiAncestors(t.ctiId)
  const refKey = t.refType ?? 'NONE' // 순수 티켓은 'NONE'으로 표기

  for (const p of policies) {
    if (p.refTypes.length > 0 && !p.refTypes.includes(refKey)) continue
    if (p.queueIds.length > 0 && !p.queueIds.includes(t.queueId)) continue
    if (p.ctiIds.length > 0 && !p.ctiIds.some((id) => ancestors.includes(id))) continue
    if (p.severities.length > 0 && !p.severities.includes(t.severity)) continue
    return p
  }
  return null
}

/** 정책 타깃 중 이 티켓에 적용될 것만 — Sev 지정 타깃이 있으면 그것이 공통(NULL) 타깃을 덮는다 */
function resolveTargets(policy: PolicyWithTargets, severity: TicketSeverity) {
  const byKey = new Map<string, PolicyWithTargets['targets'][number]>()
  for (const tg of policy.targets) {
    if (tg.severity && tg.severity !== severity) continue
    const key = `${tg.metric}|${tg.statusScope ?? ''}`
    const prev = byKey.get(key)
    // Sev 지정(구체적)이 공통(NULL)을 이긴다
    if (!prev || (!prev.severity && tg.severity)) byKey.set(key, tg)
  }
  return Array.from(byKey.values())
}

// ─────────────────────────────────────────────────────────────
// 시계 산출 (metric별 anchor·달성 판정)
// ─────────────────────────────────────────────────────────────

interface DesiredClock {
  metric: SlaMetric
  statusScope: string | null
  targetId: number
  thresholdMin: number
  anchor: Date
  /** 달성 시각 — 값이 있으면 이 시계는 이미 달성(MET) */
  satisfiedAt: Date | null
  /** 대상 자체가 아님(예: DWELL 상태 불일치) — 기존 행은 CANCELED */
  irrelevant?: boolean
}

/**
 * metric별로 "지금 이 티켓에 있어야 할 시계"를 계산한다.
 * lastActivityAt은 UPDATE_STALE 앵커(코멘트·상태변경 등 마지막 활동) — 미전달 시 조회한다.
 */
async function desiredClocks(
  t: TicketSlaContext,
  targets: ReturnType<typeof resolveTargets>,
  lastActivityAt?: Date
): Promise<DesiredClock[]> {
  const out: DesiredClock[] = []
  const isClosed = CLOSED_STATUSES.includes(t.status)

  for (const tg of targets) {
    const metric = tg.metric as SlaMetric
    if (!SLA_METRICS.includes(metric)) continue

    switch (metric) {
      case 'ASSIGN': {
        // 달성 = owner 최초 배정. 이미 배정돼 있으면 달성 시각을 알 수 없어 statusChangedAt으로 근사
        const satisfied = t.ownerId ? t.statusChangedAt ?? t.createdAt : isClosed ? (t.resolvedAt ?? t.closedAt ?? new Date()) : null
        out.push({ metric, statusScope: null, targetId: tg.id, thresholdMin: tg.thresholdMin, anchor: t.createdAt, satisfiedAt: satisfied })
        break
      }
      case 'FIRST_RESPONSE': {
        const firstComment = await prisma.ticketLog.findFirst({
          where: { ticketId: t.id, logType: 'comment' },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        })
        const inProgress = t.status === 'IN_PROGRESS' || isClosed ? t.statusChangedAt : null
        const candidates = [firstComment?.createdAt, inProgress].filter((d): d is Date => !!d)
        const satisfied = candidates.length ? new Date(Math.min(...candidates.map((d) => d.getTime()))) : null
        out.push({ metric, statusScope: null, targetId: tg.id, thresholdMin: tg.thresholdMin, anchor: t.createdAt, satisfiedAt: satisfied })
        break
      }
      case 'RESOLVE': {
        const satisfied = isClosed ? t.resolvedAt ?? t.closedAt ?? t.statusChangedAt : null
        out.push({ metric, statusScope: null, targetId: tg.id, thresholdMin: tg.thresholdMin, anchor: t.createdAt, satisfiedAt: satisfied })
        break
      }
      case 'DOMAIN_DUE': {
        // 도메인이 기한을 소유. 앵커 없거나 미지원 refType이면 시계를 만들지 않는다
        if (!t.refType || !DOMAIN_DUE_SUPPORTED.includes(t.refType)) break
        const anchor = domainDueAnchor(t)
        if (!anchor) break
        const satisfied = isClosed ? t.resolvedAt ?? t.closedAt ?? t.statusChangedAt : null
        out.push({ metric, statusScope: null, targetId: tg.id, thresholdMin: tg.thresholdMin, anchor, satisfiedAt: satisfied })
        break
      }
      case 'UPDATE_STALE': {
        // 마지막 활동부터 다시 센다(달성이 아니라 리셋). 종결 티켓은 대상 아님
        if (isClosed) { out.push({ metric, statusScope: null, targetId: tg.id, thresholdMin: tg.thresholdMin, anchor: t.createdAt, satisfiedAt: t.resolvedAt ?? t.closedAt ?? t.statusChangedAt }); break }
        const anchor = lastActivityAt ?? (await lastActivity(t))
        out.push({ metric, statusScope: null, targetId: tg.id, thresholdMin: tg.thresholdMin, anchor, satisfiedAt: null })
        break
      }
      case 'DWELL': {
        const scope = tg.statusScope
        if (!scope) break
        if (scope !== t.status) {
          // 그 상태를 이미 벗어남 → 기존 시계는 달성 처리(체류 종료)
          out.push({ metric, statusScope: scope, targetId: tg.id, thresholdMin: tg.thresholdMin, anchor: t.statusChangedAt ?? t.createdAt, satisfiedAt: t.statusChangedAt ?? new Date(), irrelevant: true })
          break
        }
        out.push({ metric, statusScope: scope, targetId: tg.id, thresholdMin: tg.thresholdMin, anchor: t.statusChangedAt ?? t.createdAt, satisfiedAt: null })
        break
      }
    }
  }
  return out
}

/** 마지막 활동 시각 — 로그(코멘트·시스템 이벤트) 최신, 없으면 상태변경/생성 */
async function lastActivity(t: TicketSlaContext): Promise<Date> {
  const log = await prisma.ticketLog.findFirst({
    where: { ticketId: t.id },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  const candidates = [log?.createdAt, t.statusChangedAt, t.createdAt].filter((d): d is Date => !!d)
  return new Date(Math.max(...candidates.map((d) => d.getTime())))
}

/** 기한 = anchor + 목표(분) + 누적 정지시간. DOMAIN_DUE는 앵커 자체가 기한이고 threshold는 오프셋 */
function computeDueAt(anchor: Date, thresholdMin: number, pausedMs: bigint | number): Date {
  return new Date(anchor.getTime() + thresholdMin * MIN + Number(pausedMs))
}

// ─────────────────────────────────────────────────────────────
// 동기화 — 티켓 mutation 후 호출하는 단일 진입점
// ─────────────────────────────────────────────────────────────

export interface SyncOptions {
  /** 초과 상태가 되는 시계에 즉시 알림 억제 마킹(백필·정책 일괄 적용 시) */
  quiet?: boolean
  /** 이미 로드한 티켓 컨텍스트 재사용 */
  ctx?: TicketSlaContext
}

export interface SyncResult {
  ticketId: number
  created: number
  updated: number
  breached: number
  met: number
  canceled: number
}

/**
 * 티켓의 SLA 시계를 현재 상태에 맞게 동기화한다.
 * 티켓 생성·상태 전이·배정·Sev/큐 변경·코멘트 작성 후 호출(best-effort — 실패는 삼킨다).
 */
export async function syncTicketClocks(ticketId: number, opts: SyncOptions = {}): Promise<SyncResult> {
  const result: SyncResult = { ticketId, created: 0, updated: 0, breached: 0, met: 0, canceled: 0 }

  const t = opts.ctx ?? (await prisma.ticket.findUnique({ where: { id: ticketId }, select: TICKET_CTX_SELECT }))
  if (!t) return result

  const policy = await matchPolicy(t)
  const existing = await prisma.ticketSlaClock.findMany({ where: { ticketId } })
  const now = new Date()
  const isPaused = PAUSED_STATUSES.includes(t.status)

  const desired = policy ? await desiredClocks(t, resolveTargets(policy, t.severity)) : []
  const keyOf = (m: string, s: string | null) => `${m}|${s ?? ''}`
  const desiredMap = new Map(desired.map((d) => [keyOf(d.metric, d.statusScope), d]))

  // ① 기존 시계 갱신
  for (const c of existing) {
    const want = desiredMap.get(keyOf(c.metric, c.statusScope))

    // 정책에서 사라진 타깃 → 취소.
    // BREACHED도 취소 대상이다 — 기준이 없어졌는데 "SLA 초과"로 계속 표시되면 유령 위험이 된다
    // (breachedAt은 지우지 않으므로 지표에서는 여전히 위반 이력으로 집계 가능).
    // MET는 그대로 둔다: 달성 이력이고 위험 목록에 나타나지 않는다.
    if (!want) {
      if (c.state === 'RUNNING' || c.state === 'PAUSED' || c.state === 'BREACHED') {
        await prisma.ticketSlaClock.update({ where: { id: c.id }, data: { state: 'CANCELED' } })
        result.canceled++
      }
      continue
    }
    desiredMap.delete(keyOf(c.metric, c.statusScope))

    // 이미 확정된 시계는 건드리지 않는다 — 단 UPDATE_STALE은 리셋 대상
    const settled = c.state === 'MET' || c.state === 'CANCELED'
    if (settled && !(c.metric === 'UPDATE_STALE' && !want.satisfiedAt)) continue

    const data: Prisma.TicketSlaClockUpdateInput = {}

    // 달성
    if (want.satisfiedAt) {
      if (c.state !== 'MET') {
        const overdue = want.satisfiedAt.getTime() > c.dueAt.getTime()
        data.state = want.irrelevant && !overdue ? 'MET' : overdue ? 'BREACHED' : 'MET'
        data.satisfiedAt = want.satisfiedAt
        if (overdue && !c.breachedAt) data.breachedAt = c.dueAt
        // 기한 내 달성이면 초과 알림 대상에서 제외되도록 마킹 정리
        if (!overdue) data.notifiedBreachAt = c.notifiedBreachAt ?? null
        if (data.state === 'MET') result.met++
        result.updated++
        await prisma.ticketSlaClock.update({ where: { id: c.id }, data })
      }
      continue
    }

    // UPDATE_STALE 리셋 — 앵커가 앞으로 갔으면 기한 재산정 + 초과 마킹 해제
    if (c.metric === 'UPDATE_STALE' && want.anchor.getTime() > c.startedAt.getTime()) {
      data.startedAt = want.anchor
      data.dueAt = computeDueAt(want.anchor, want.thresholdMin, 0)
      data.pausedMs = BigInt(0)
      data.state = isPaused ? 'PAUSED' : 'RUNNING'
      data.pausedAt = isPaused ? now : null
      data.breachedAt = null
      data.notifiedBreachAt = null
      data.notifiedWarnAt = null
      data.thresholdMin = want.thresholdMin
      data.target = { connect: { id: want.targetId } }
      data.policy = policy ? { connect: { id: policy.id } } : { disconnect: true }
      await prisma.ticketSlaClock.update({ where: { id: c.id }, data })
      result.updated++
      continue
    }

    // 정지/재개
    if (isPaused && c.state === 'RUNNING') {
      data.state = 'PAUSED'
      data.pausedAt = now
    } else if (!isPaused && c.state === 'PAUSED') {
      const add = c.pausedAt ? now.getTime() - c.pausedAt.getTime() : 0
      const pausedMs = c.pausedMs + BigInt(Math.max(0, add))
      data.state = 'RUNNING'
      data.pausedAt = null
      data.pausedMs = pausedMs
      data.dueAt = computeDueAt(c.startedAt, c.thresholdMin, pausedMs)
    }

    // 목표값이 바뀐 경우(설정 변경 후 재적용·정책 교체) — 기한 재산정
    if (want.thresholdMin !== c.thresholdMin) {
      const newDue = computeDueAt(c.startedAt, want.thresholdMin, c.pausedMs)
      data.thresholdMin = want.thresholdMin
      data.target = { connect: { id: want.targetId } }
      data.policy = policy ? { connect: { id: policy.id } } : { disconnect: true }
      data.dueAt = newDue
      // 목표가 늘어나 기한이 미래가 됐다면 더 이상 초과가 아니다 —
      // 새 기준에서 성립하지 않는 초과를 남겨두면 위험 목록에 유령 항목이 된다
      if (c.state === 'BREACHED' && newDue.getTime() > now.getTime()) {
        data.state = isPaused ? 'PAUSED' : 'RUNNING'
        data.breachedAt = null
        data.notifiedBreachAt = null
      }
    }

    // 초과 판정 (정지 중에는 판정하지 않음)
    const effDue = (data.dueAt as Date | undefined) ?? c.dueAt
    const effState = (data.state as ClockState | undefined) ?? (c.state as ClockState)
    if (effState === 'RUNNING' && effDue.getTime() <= now.getTime()) {
      data.state = 'BREACHED'
      data.breachedAt = c.breachedAt ?? now
      if (opts.quiet) data.notifiedBreachAt = c.notifiedBreachAt ?? now
      result.breached++
    }

    if (Object.keys(data).length > 0) {
      await prisma.ticketSlaClock.update({ where: { id: c.id }, data })
      result.updated++
    }
  }

  // ② 새 시계 생성
  for (const want of Array.from(desiredMap.values())) {
    if (want.irrelevant) continue // 대상 아닌 DWELL은 애초에 만들지 않는다
    const dueAt = computeDueAt(want.anchor, want.thresholdMin, 0)
    const overdue = !want.satisfiedAt && dueAt.getTime() <= now.getTime()
    const state: ClockState = want.satisfiedAt
      ? want.satisfiedAt.getTime() > dueAt.getTime() ? 'BREACHED' : 'MET'
      : isPaused ? 'PAUSED' : overdue ? 'BREACHED' : 'RUNNING'

    await prisma.ticketSlaClock.create({
      data: {
        ticketId,
        metric: want.metric,
        statusScope: want.statusScope,
        policyId: policy?.id ?? null,
        targetId: want.targetId,
        thresholdMin: want.thresholdMin,
        startedAt: want.anchor,
        dueAt,
        pausedAt: state === 'PAUSED' ? now : null,
        state,
        satisfiedAt: want.satisfiedAt,
        breachedAt: state === 'BREACHED' ? (want.satisfiedAt ?? dueAt) : null,
        // 백필·과거 데이터로 이미 초과인 건은 즉시 알림 대상에서 제외(quiet)
        notifiedBreachAt: state === 'BREACHED' && (opts.quiet || !!want.satisfiedAt) ? now : null,
      },
    })
    result.created++
    if (state === 'BREACHED') result.breached++
    if (state === 'MET') result.met++
  }

  // ③ tickets.due_at 캐시 동기화 — 목록·상세·기존 지표가 계속 이 값을 쓴다(§4.6)
  await syncTicketDueAtCache(ticketId)

  return result
}

/**
 * `tickets.due_at`을 대표 시계(DOMAIN_DUE 우선, 없으면 RESOLVE)의 기한으로 맞춘다.
 *
 * raw SQL을 쓰는 이유: Prisma `update`는 `@updatedAt`을 함께 올려 "티켓이 실제로 변경된 시각"을
 * 오염시킨다(시계 동기화는 티켓 변경이 아니다).
 * 단 **JS Date를 파라미터로 넘기면 안 된다** — 드라이버가 서버 로컬시각(KST)으로 직렬화해
 * timestamp 컬럼에 9시간 앞선 값이 들어간다(위키 청크 `chunks_synced_at`에서 같은 함정을 겪음).
 * ISO 문자열 + `timestamptz AT TIME ZONE 'UTC'` 캐스팅으로 UTC 벽시계를 명시한다.
 */
async function syncTicketDueAtCache(ticketId: number): Promise<void> {
  const clocks = await prisma.ticketSlaClock.findMany({
    where: { ticketId, metric: { in: ['DOMAIN_DUE', 'RESOLVE'] }, state: { notIn: ['CANCELED'] } },
    select: { metric: true, dueAt: true },
  })
  const pick = clocks.find((c) => c.metric === 'DOMAIN_DUE') ?? clocks.find((c) => c.metric === 'RESOLVE')
  if (!pick) return
  const iso = pick.dueAt.toISOString()
  await prisma.$executeRaw`
    UPDATE tickets
    SET due_at = (${iso}::timestamptz AT TIME ZONE 'UTC')
    WHERE id = ${ticketId}
      AND due_at IS DISTINCT FROM (${iso}::timestamptz AT TIME ZONE 'UTC')`
}

/** 티켓 mutation 훅용 — 실패를 삼키는 fire-and-forget 래퍼 */
export function syncTicketClocksSafe(ticketId: number, opts: SyncOptions = {}): void {
  syncTicketClocks(ticketId, opts).catch((err) => {
    console.error(`[sla] 시계 동기화 실패 (ticket ${ticketId}):`, err)
  })
}

// ─────────────────────────────────────────────────────────────
// 조회 — 알림·화면용
// ─────────────────────────────────────────────────────────────

export interface SlaRiskItem {
  ticketId: number
  ticketCode: string
  title: string
  severity: TicketSeverity
  status: TicketStatus
  refType: string | null
  queueName: string
  hospitalName: string | null
  ownerId: string | null
  metric: SlaMetric
  statusScope: string | null
  kind: 'overdue' | 'warning'
  /** overdue: 초과 분 / warning: 남은 분 */
  minutes: number
  dueAt: Date
  label: string
}

/** "3시간 초과" / "D-2" 같은 사람이 읽는 표기 */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes))
  if (m < 60) return `${m}분`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간`
  const d = Math.floor(h / 24)
  return `${d}일`
}

/**
 * 현재 SLA 초과·임박 목록 (다이제스트·개인 화면 공용).
 * 정지(PAUSED)·달성(MET)·취소(CANCELED)는 제외. 종결 티켓도 제외.
 */
export async function findSlaRisk(opts: { ownerId?: string; includeWarning?: boolean } = {}): Promise<SlaRiskItem[]> {
  const now = Date.now()
  const clocks = await prisma.ticketSlaClock.findMany({
    where: {
      state: { in: ['RUNNING', 'BREACHED'] },
      ticket: {
        status: { notIn: CLOSED_STATUSES },
        ...(opts.ownerId ? { ownerId: opts.ownerId } : {}),
      },
    },
    select: {
      metric: true, statusScope: true, dueAt: true, thresholdMin: true, state: true,
      target: { select: { warnRatio: true } },
      ticket: {
        select: {
          id: true, ticketCode: true, title: true, severity: true, status: true, refType: true, ownerId: true,
          queue: { select: { name: true } },
          hospital: { select: { hospitalName: true } },
        },
      },
    },
  })

  const items: SlaRiskItem[] = []
  for (const c of clocks) {
    const t = c.ticket
    const diffMin = (c.dueAt.getTime() - now) / MIN
    const metric = c.metric as SlaMetric
    const base = {
      ticketId: t.id, ticketCode: t.ticketCode, title: t.title, severity: t.severity, status: t.status,
      refType: t.refType, queueName: t.queue.name, hospitalName: t.hospital?.hospitalName ?? null,
      ownerId: t.ownerId, metric, statusScope: c.statusScope, dueAt: c.dueAt,
    }
    if (diffMin <= 0) {
      const over = -diffMin
      items.push({ ...base, kind: 'overdue', minutes: over, label: `${SLA_METRIC_LABELS[metric]} ${formatDuration(over)} 초과` })
    } else if (opts.includeWarning !== false) {
      const ratio = c.target?.warnRatio ?? 80
      if (ratio > 0 && c.thresholdMin > 0) {
        const elapsedRatio = ((c.thresholdMin - diffMin) / c.thresholdMin) * 100
        if (elapsedRatio >= ratio) {
          items.push({ ...base, kind: 'warning', minutes: diffMin, label: `${SLA_METRIC_LABELS[metric]} ${formatDuration(diffMin)} 남음` })
        }
      }
    }
  }

  const sevOrder: Record<TicketSeverity, number> = { SEV1: 1, SEV2: 2, SEV3: 3, SEV4: 4, SEV5: 5 }
  items.sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'overdue' ? -1 : 1) ||
      sevOrder[a.severity] - sevOrder[b.severity] ||
      b.minutes - a.minutes
  )
  return items
}
