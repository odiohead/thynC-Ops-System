/**
 * SLA·지연 판정 — Sev 기반 (티켓 P11 재편, ticket_dev_schedule.md P11)
 *
 * P10까지 전 도메인이 티켓으로 편입 완료 → 지연 판정을 도메인 5종 개별 규칙에서
 * 티켓 단일 기준(dueAt = 생성일 + Sev별 SLA 목표일)으로 재편.
 * - dueAt 산정: SEV5(백로그)·PROJECT(endDateExpected 소유)는 자동 산정 제외
 * - 판정 대상: OPEN/ASSIGNED/IN_PROGRESS — PENDING은 SLA 시계 정지(AWS 관례, 체류 규칙으로 커버)
 * - 상태 체류: 티켓 상태별 임계일(notify_status_dwell, 기본 전부 미사용)
 * 기준값은 AppSetting `notify_sla_rules`(JSON) 런타임 설정, 미지정 시 DEFAULT_SLA_RULES.
 * 날짜는 KST(Asia/Seoul) 자정 기준.
 */

import { TicketSeverity, TicketStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { TaskType } from '@/lib/notify'

export interface SlaRules {
  days: Record<TicketSeverity, number> // Sev별 목표일. 0 = SLA 미적용(대상 제외)
  warnDays: number // 임박 예고 — 기한까지 남은 일수가 이 값 이하이면 임박(0=당일만)
}

export const DEFAULT_SLA_RULES: SlaRules = {
  days: { SEV1: 1, SEV2: 1, SEV3: 3, SEV4: 7, SEV5: 0 },
  warnDays: 1,
}

export interface AssigneeUser {
  id: string
  name: string
  email: string
  slackUserId: string | null
  slackNotifyEnabled: boolean
}

export type DelayedKind = 'overdue' | 'warning' | 'dwell'

export interface DelayedTicketItem {
  kind: DelayedKind
  taskType: TaskType // refType 유래 (순수 티켓 = TICKET) — 타입별 on/off 게이트·라벨용
  ticketCode: string
  hospitalName: string | null
  title: string
  url: string
  severity: TicketSeverity
  status: TicketStatus
  days: number // overdue: 초과 일수 / warning: 남은 일수 / dwell: 체류 일수
  baseLabel: string // 기준 설명 (예: "기한 2026-07-20")
  owner: AssigneeUser | null // SLA 초과 DM 대상
}

const DAY = 86400000

/** 인스턴트를 KST 캘린더 날짜의 UTC 자정 숫자로 변환 */
function toKstDateNum(d: Date): number {
  const k = new Date(d.getTime() + 9 * 3600 * 1000)
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate())
}
function todayKstNum(): number {
  return toKstDateNum(new Date())
}
/** refDate가 오늘보다 몇 일 과거인지 (미래면 음수) */
function overdueDays(refDate: Date): number {
  return Math.floor((todayKstNum() - toKstDateNum(refDate)) / DAY)
}
function ymd(d: Date): string {
  const k = new Date(d.getTime() + 9 * 3600 * 1000)
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`
}

const SEVERITIES: TicketSeverity[] = ['SEV1', 'SEV2', 'SEV3', 'SEV4', 'SEV5']

export async function getSlaRules(): Promise<SlaRules> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'notify_sla_rules' } })
    if (row?.value) {
      const parsed = JSON.parse(row.value) as Partial<SlaRules>
      const days = { ...DEFAULT_SLA_RULES.days }
      for (const s of SEVERITIES) {
        const v = parsed.days?.[s]
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) days[s] = Math.floor(v)
      }
      const warnDays =
        typeof parsed.warnDays === 'number' && Number.isFinite(parsed.warnDays) && parsed.warnDays >= 0
          ? Math.floor(parsed.warnDays)
          : DEFAULT_SLA_RULES.warnDays
      return { days, warnDays }
    }
  } catch (err) {
    console.error('[delay-rules] notify_sla_rules 파싱 실패:', err)
  }
  return DEFAULT_SLA_RULES
}

/**
 * dueAt 자동 산정: anchor(생성일) + Sev별 SLA 목표일. 목표 0일(SEV5 등)이면 null.
 * PROJECT 티켓은 호출부에서 제외(endDateExpected가 dueAt 소유 — 도메인 동기화).
 */
export function computeTicketDueAt(rules: SlaRules, severity: TicketSeverity, anchor: Date): Date | null {
  const days = rules.days[severity] ?? 0
  if (days <= 0) return null
  return new Date(anchor.getTime() + days * DAY)
}

/** 티켓 상태 체류 규칙 — { 상태: 임계일수 }. 미설정 상태는 체류 감지 안 함 */
export type TicketDwellRules = Partial<Record<TicketStatus, number>>

const TICKET_STATUSES = Object.values(TicketStatus) as string[]

export async function getTicketDwellRules(): Promise<TicketDwellRules> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'notify_status_dwell' } })
    if (row?.value) {
      const parsed = JSON.parse(row.value) as Record<string, unknown>
      const out: TicketDwellRules = {}
      for (const [k, v] of Object.entries(parsed)) {
        // P11 이전 형식(taskType 키)은 무시 — 티켓 상태 키만 유효
        if (!TICKET_STATUSES.includes(k)) continue
        const n = Math.floor(Number(v))
        if (Number.isFinite(n) && n > 0) out[k as TicketStatus] = n
      }
      return out
    }
  } catch (err) {
    console.error('[delay-rules] notify_status_dwell 파싱 실패:', err)
  }
  return {}
}

/** refType → 알림 taskType (순수 티켓 = TICKET) */
export function refTypeToTaskType(refType: string | null): TaskType {
  switch (refType) {
    case 'MAINTENANCE': return 'MAINTENANCE'
    case 'ETC': return 'ETC'
    case 'SITE_VISIT': return 'SITE_VISIT'
    case 'INSTALL_PLAN': return 'INSTALL_PLAN'
    case 'PROJECT': return 'PROJECT'
    default: return 'TICKET'
  }
}

const OWNER_SELECT = { select: { id: true, name: true, email: true, slackUserId: true, slackNotifyEnabled: true } } as const
const SEV_ORDER: Record<TicketSeverity, number> = { SEV1: 1, SEV2: 2, SEV3: 3, SEV4: 4, SEV5: 5 }

/**
 * 현재 SLA 초과·임박·체류 중인 티켓 목록.
 * 정렬: kind(초과→임박→체류) → Sev → 일수 내림차순.
 */
export async function findDelayedTickets(): Promise<DelayedTicketItem[]> {
  const rules = await getSlaRules()
  const dwell = await getTicketDwellRules()
  const base = process.env.NEXT_PUBLIC_APP_URL || ''
  const items: DelayedTicketItem[] = []

  const tickets = await prisma.ticket.findMany({
    where: { status: { notIn: ['RESOLVED', 'CLOSED'] }, severity: { not: 'SEV5' } },
    select: {
      id: true, ticketCode: true, title: true, status: true, severity: true, refType: true,
      dueAt: true, statusChangedAt: true, createdAt: true,
      hospital: { select: { hospitalName: true } },
      owner: OWNER_SELECT,
    },
  })

  const seen = new Set<string>() // 같은 티켓이 SLA·체류 양쪽에 걸리면 SLA 우선 1건만
  for (const t of tickets) {
    const common = {
      taskType: refTypeToTaskType(t.refType),
      ticketCode: t.ticketCode,
      hospitalName: t.hospital?.hospitalName ?? null,
      title: t.title,
      url: `${base}/tickets/${t.ticketCode}`,
      severity: t.severity,
      status: t.status,
      owner: t.owner ?? null,
    }

    // SLA — PENDING은 시계 정지(체류 규칙으로만 감지)
    if (t.dueAt && t.status !== 'PENDING') {
      const od = overdueDays(t.dueAt)
      if (od >= 1) {
        items.push({ ...common, kind: 'overdue', days: od, baseLabel: `기한 ${ymd(t.dueAt)}` })
        seen.add(t.ticketCode)
      } else if (-od <= rules.warnDays) {
        items.push({ ...common, kind: 'warning', days: -od, baseLabel: `기한 ${ymd(t.dueAt)}` })
        seen.add(t.ticketCode)
      }
    }

    // 상태 체류
    if (!seen.has(t.ticketCode)) {
      const th = dwell[t.status]
      if (th && th > 0) {
        const dd = overdueDays(t.statusChangedAt ?? t.createdAt)
        if (dd >= th) {
          items.push({ ...common, kind: 'dwell', days: dd, baseLabel: `'${t.status}' 상태 ${dd}일째` })
        }
      }
    }
  }

  const kindOrder: Record<DelayedKind, number> = { overdue: 0, warning: 1, dwell: 2 }
  items.sort(
    (a, b) =>
      kindOrder[a.kind] - kindOrder[b.kind] ||
      SEV_ORDER[a.severity] - SEV_ORDER[b.severity] ||
      b.days - a.days
  )
  return items
}
