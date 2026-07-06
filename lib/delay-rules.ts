/**
 * 지연 업무 판정 (function_notification.md Phase 3)
 *
 * 각 업무 타입의 "지연" 기준(기준일 + 임계일수)을 정의하고, 현재 지연 중인 업무 목록을 산출한다.
 * 기준값은 AppSetting `notify_delay_rules`(JSON)로 덮어쓸 수 있고, 미지정 시 DEFAULT_DELAY_RULES.
 * 완료/회신완료 또는 보류 상태는 지연 대상에서 제외. 날짜는 KST(Asia/Seoul) 자정 기준.
 */

import { prisma } from '@/lib/prisma'
import type { TaskType } from '@/lib/notify'

export interface DelayRules {
  siteVisitDays: number
  installPlanDays: number
  etcDays: number
  projectGraceDays: number // 완료예정일 경과 후 몇 일 더 지나야 지연(0=다음날부터)
  maintenanceDays: Record<string, number> // 우선순위 → 임계 일수
}

export const DEFAULT_DELAY_RULES: DelayRules = {
  siteVisitDays: 7,
  installPlanDays: 7,
  etcDays: 14,
  projectGraceDays: 0,
  maintenanceDays: { 긴급: 1, 높음: 3, 보통: 7, 낮음: 14 },
}

export interface AssigneeUser {
  id: string
  name: string
  email: string
  slackUserId: string | null
  slackNotifyEnabled: boolean
}

export interface DelayedItem {
  taskType: TaskType
  refCode: string
  hospitalName: string | null
  title: string | null
  url: string
  overdueDays: number
  baseLabel: string // 기준 설명 (예: "요청 2026-06-20")
  assignees: AssigneeUser[] // 담당자 DM 대상
}

const ASSIGNEE_SELECT = { select: { user: { select: { id: true, name: true, email: true, slackUserId: true, slackNotifyEnabled: true } } } } as const
const mapAssignees = (arr: { user: AssigneeUser }[]): AssigneeUser[] => arr.map((a) => a.user)

const DAY = 86400000

/** 인스턴트를 KST 캘린더 날짜의 UTC 자정 숫자로 변환 */
function toKstDateNum(d: Date): number {
  const k = new Date(d.getTime() + 9 * 3600 * 1000)
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate())
}
function todayKstNum(): number {
  return toKstDateNum(new Date())
}
function overdueDays(refDate: Date): number {
  return Math.floor((todayKstNum() - toKstDateNum(refDate)) / DAY)
}
function ymd(d: Date): string {
  const k = new Date(d.getTime() + 9 * 3600 * 1000)
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`
}

export async function getDelayRules(): Promise<DelayRules> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'notify_delay_rules' } })
    if (row?.value) {
      const parsed = JSON.parse(row.value) as Partial<DelayRules>
      return {
        ...DEFAULT_DELAY_RULES,
        ...parsed,
        maintenanceDays: { ...DEFAULT_DELAY_RULES.maintenanceDays, ...(parsed.maintenanceDays ?? {}) },
      }
    }
  } catch (err) {
    console.error('[delay-rules] notify_delay_rules 파싱 실패:', err)
  }
  return DEFAULT_DELAY_RULES
}

/** 단계(상태) 체류 규칙 — 타입별 { 상태명: 임계일수 }. 미설정 상태는 체류 감지 안 함 */
export type StatusDwellRules = Partial<Record<'PROJECT' | 'SITE_VISIT' | 'MAINTENANCE' | 'ETC', Record<string, number>>>

export async function getStatusDwellRules(): Promise<StatusDwellRules> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'notify_status_dwell' } })
    if (row?.value) return JSON.parse(row.value) as StatusDwellRules
  } catch (err) {
    console.error('[delay-rules] notify_status_dwell 파싱 실패:', err)
  }
  return {}
}

/**
 * 단계 체류 판정. 현재 상태에 임계일수가 설정돼 있고 진입 후 그 이상 머물렀으면 DelayedItem 필드 반환.
 * 진입 시각: statusChangedAt(상태 실변경 시 기록) → 없으면(레거시) fallback(앵커일/생성일)
 */
function dwellCheck(
  dwell: StatusDwellRules,
  type: 'PROJECT' | 'SITE_VISIT' | 'MAINTENANCE' | 'ETC',
  statusName: string | null | undefined,
  statusChangedAt: Date | null,
  fallback: Date
): { overdueDays: number; baseLabel: string } | null {
  if (!statusName) return null
  const th = dwell[type]?.[statusName]
  if (!th || th <= 0) return null
  const entered = statusChangedAt ?? fallback
  const dd = overdueDays(entered)
  if (dd < th) return null
  return { overdueDays: dd, baseLabel: `'${statusName}' 상태 ${dd}일째` }
}

/** 현재 지연 중인 업무 목록 (overdueDays 내림차순). 앵커(기준일) 규칙 우선, 아니면 단계 체류 규칙 */
export async function findDelayedTasks(): Promise<DelayedItem[]> {
  const rules = await getDelayRules()
  const dwell = await getStatusDwellRules()
  const base = process.env.NEXT_PUBLIC_APP_URL || ''
  const items: DelayedItem[] = []

  // PROJECT — ①완료예정일 경과 or ②공사상태 체류. 라벨 '완료'/'보류' 제외
  const projects = await prisma.project.findMany({
    select: { projectCode: true, projectName: true, endDateExpected: true, statusChangedAt: true, createdAt: true, buildStatus: { select: { label: true } }, hospital: { select: { hospitalName: true } }, assignees: ASSIGNEE_SELECT },
  })
  for (const p of projects) {
    const label = p.buildStatus?.label ?? ''
    if (label.includes('완료') || label.includes('보류')) continue
    const common = { taskType: 'PROJECT' as const, refCode: p.projectCode, hospitalName: p.hospital?.hospitalName ?? null, title: p.projectName ?? null, url: `${base}/projects/${p.projectCode}`, assignees: mapAssignees(p.assignees) }
    if (p.endDateExpected && overdueDays(p.endDateExpected) >= rules.projectGraceDays + 1) {
      items.push({ ...common, overdueDays: overdueDays(p.endDateExpected), baseLabel: `완료예정 ${ymd(p.endDateExpected)}` })
      continue
    }
    const dw = dwellCheck(dwell, 'PROJECT', p.buildStatus?.label, p.statusChangedAt, p.createdAt)
    if (dw) items.push({ ...common, ...dw })
  }

  // SITE_VISIT — ①요청일+N일 or ②상태 체류. 회신완료 제외
  const svs = await prisma.siteVisit.findMany({
    where: { siteVisitCode: { not: null } },
    select: { id: true, siteVisitCode: true, requestDate: true, statusChangedAt: true, createdAt: true, status: { select: { name: true } }, hospital: { select: { hospitalName: true } }, assignees: ASSIGNEE_SELECT },
  })
  for (const s of svs) {
    if (s.status?.name === '회신완료') continue
    const common = { taskType: 'SITE_VISIT' as const, refCode: s.siteVisitCode!, hospitalName: s.hospital?.hospitalName ?? null, title: null, url: `${base}/site-visits/${s.id}`, assignees: mapAssignees(s.assignees) }
    if (s.requestDate && overdueDays(s.requestDate) >= rules.siteVisitDays) {
      items.push({ ...common, overdueDays: overdueDays(s.requestDate), baseLabel: `요청 ${ymd(s.requestDate)}` })
      continue
    }
    const dw = dwellCheck(dwell, 'SITE_VISIT', s.status?.name, s.statusChangedAt, s.requestDate ?? s.createdAt)
    if (dw) items.push({ ...common, ...dw })
  }

  // INSTALL_PLAN — 요청일 + N일 & 작성/회신 미완료
  const ips = await prisma.installPlan.findMany({
    where: { requestDate: { not: null }, planCode: { not: null } },
    select: { id: true, planCode: true, requestDate: true, writeStatus: true, replyStatus: true, hospital: { select: { hospitalName: true } }, assignees: ASSIGNEE_SELECT },
  })
  for (const ip of ips) {
    if (ip.writeStatus === '완료' && ip.replyStatus === '완료') continue
    const od = overdueDays(ip.requestDate!)
    if (od >= rules.installPlanDays) {
      items.push({ taskType: 'INSTALL_PLAN', refCode: ip.planCode!, hospitalName: ip.hospital?.hospitalName ?? null, title: null, url: `${base}/install-plans/${ip.id}`, overdueDays: od, baseLabel: `요청 ${ymd(ip.requestDate!)}`, assignees: mapAssignees(ip.assignees) })
    }
  }

  // MAINTENANCE — ①접수일+우선순위별 N일 or ②상태 체류. 완료/보류 제외
  const mnts = await prisma.maintenance.findMany({
    where: { resolvedAt: null, maintenanceCode: { not: null } },
    select: { id: true, maintenanceCode: true, reportedAt: true, priority: true, title: true, statusChangedAt: true, createdAt: true, status: { select: { name: true } }, hospital: { select: { hospitalName: true } }, assignees: ASSIGNEE_SELECT },
  })
  for (const m of mnts) {
    if (m.status?.name === '완료' || m.status?.name === '보류') continue
    const th = rules.maintenanceDays[m.priority] ?? rules.maintenanceDays['보통'] ?? 7
    const common = { taskType: 'MAINTENANCE' as const, refCode: m.maintenanceCode!, hospitalName: m.hospital?.hospitalName ?? null, title: m.title ?? null, url: `${base}/maintenances/${m.id}`, assignees: mapAssignees(m.assignees) }
    if (m.reportedAt && overdueDays(m.reportedAt) >= th) {
      items.push({ ...common, overdueDays: overdueDays(m.reportedAt), baseLabel: `접수 ${ymd(m.reportedAt)}·${m.priority}` })
      continue
    }
    const dw = dwellCheck(dwell, 'MAINTENANCE', m.status?.name, m.statusChangedAt, m.reportedAt ?? m.createdAt)
    if (dw) items.push({ ...common, ...dw })
  }

  // ETC — ①접수일+N일 or ②상태 체류. 완료/보류 제외
  const etcs = await prisma.etcTask.findMany({
    where: { resolvedAt: null, etcTaskCode: { not: null } },
    select: { id: true, etcTaskCode: true, reportedAt: true, title: true, statusChangedAt: true, createdAt: true, status: { select: { name: true } }, hospitals: { select: { hospital: { select: { hospitalName: true } } } }, assignees: ASSIGNEE_SELECT },
  })
  for (const e of etcs) {
    if (e.status?.name === '완료' || e.status?.name === '보류') continue
    const hs = e.hospitals.map((h) => h.hospital?.hospitalName).filter((n): n is string => !!n)
    const hospitalName = hs.length === 0 ? null : hs.length === 1 ? hs[0] : `${hs[0]} 외 ${hs.length - 1}곳`
    const common = { taskType: 'ETC' as const, refCode: e.etcTaskCode!, hospitalName, title: e.title ?? null, url: `${base}/etc-tasks/${e.id}`, assignees: mapAssignees(e.assignees) }
    if (e.reportedAt && overdueDays(e.reportedAt) >= rules.etcDays) {
      items.push({ ...common, overdueDays: overdueDays(e.reportedAt), baseLabel: `접수 ${ymd(e.reportedAt)}` })
      continue
    }
    const dw = dwellCheck(dwell, 'ETC', e.status?.name, e.statusChangedAt, e.reportedAt ?? e.createdAt)
    if (dw) items.push({ ...common, ...dw })
  }

  items.sort((a, b) => b.overdueDays - a.overdueDays)
  return items
}
