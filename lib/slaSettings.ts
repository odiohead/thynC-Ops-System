/**
 * SLA 설정(정책·타깃) 입력 검증·정규화 (1.1 P2)
 *
 * Route 파일은 핸들러(GET/POST/PUT/DELETE)만 export할 수 있어 공용 로직을 여기에 둔다.
 * 잘못된 기준은 곧 오탐 알림이므로 저장 입구에서 막는다.
 */

import { TicketStatus, TicketSeverity } from '@prisma/client'
import { SLA_METRICS, type SlaMetric } from '@/lib/sla'

export const TICKET_STATUSES = Object.values(TicketStatus) as string[]
export const TICKET_SEVERITIES = Object.values(TicketSeverity) as string[]
export const CLOCK_TYPES = ['CALENDAR_24H', 'BUSINESS_HOURS'] as const
/** DOMAIN_DUE를 걸 수 있는 refType — 앵커 필드가 코드에 고정된 것만 (§4.2) */
export const DOMAIN_DUE_REF_TYPES = ['PROJECT', 'SITE_VISIT', 'INSTALL_PLAN'] as const

export interface TargetInput {
  metric: string
  statusScope?: string | null
  severity?: string | null
  thresholdMin: number
  warnRatio?: number
  isActive?: boolean
}

export interface PolicyScope {
  refTypes: string[]
  queueIds: number[]
  ctiIds: number[]
  severities: string[]
}

/** 타깃 배열 검증 — 문제가 있으면 사용자에게 보여줄 메시지, 없으면 null */
export function validateTargets(targets: TargetInput[], refTypes: string[]): string | null {
  const seen = new Set<string>()
  for (const t of targets) {
    if (!SLA_METRICS.includes(t.metric as SlaMetric)) return `알 수 없는 metric: ${t.metric}`
    if (t.metric === 'DWELL' && !t.statusScope) return 'DWELL 타깃은 대상 상태(statusScope)가 필요합니다.'
    if (t.statusScope && !TICKET_STATUSES.includes(t.statusScope)) return `알 수 없는 상태: ${t.statusScope}`
    if (t.metric !== 'DWELL' && t.statusScope) return `${t.metric}에는 상태를 지정할 수 없습니다.`
    if (t.severity && !TICKET_SEVERITIES.includes(t.severity)) return `알 수 없는 Severity: ${t.severity}`
    if (!Number.isFinite(t.thresholdMin) || t.thresholdMin < 0) return '목표 시간은 0 이상이어야 합니다.'
    if (t.metric !== 'DOMAIN_DUE' && t.thresholdMin === 0) return `${t.metric} 목표 시간은 0보다 커야 합니다.`
    if (t.warnRatio != null && (t.warnRatio < 0 || t.warnRatio > 100)) return '임박 예고 비율은 0~100 사이여야 합니다.'
    if (t.metric === 'DOMAIN_DUE') {
      // 앵커 필드가 없는 유형에 걸면 시계가 생기지 않아 "설정했는데 아무 일도 안 일어남"이 된다
      const unsupported = refTypes.filter((r) => !DOMAIN_DUE_REF_TYPES.includes(r as (typeof DOMAIN_DUE_REF_TYPES)[number]))
      if (refTypes.length === 0 || unsupported.length > 0) {
        return `DOMAIN_DUE는 ${DOMAIN_DUE_REF_TYPES.join('/')} 유형에만 지정할 수 있습니다.${
          unsupported.length ? ` (지원 안 함: ${unsupported.join(', ')})` : ' 유형을 지정하세요.'
        }`
      }
    }
    const key = `${t.metric}|${t.statusScope ?? ''}|${t.severity ?? ''}`
    if (seen.has(key)) return `중복 타깃: ${key}`
    seen.add(key)
  }
  return null
}

/** 정책 스코프 정규화 (fallback 지정 가능 — PUT의 부분 갱신용) */
export function normalizeScope(body: Record<string, unknown>, fallback?: PolicyScope): PolicyScope {
  const arr = (v: unknown, fb: string[]): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : fb)
  const nums = (v: unknown, fb: number[]): number[] =>
    Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : fb
  return {
    refTypes: arr(body.refTypes, fallback?.refTypes ?? []),
    queueIds: nums(body.queueIds, fallback?.queueIds ?? []),
    ctiIds: nums(body.ctiIds, fallback?.ctiIds ?? []),
    severities: arr(body.severities, fallback?.severities ?? []).filter((s) => TICKET_SEVERITIES.includes(s)),
  }
}

/** 타깃 입력 → Prisma create 데이터 */
export function targetCreateData(t: TargetInput) {
  return {
    metric: t.metric,
    statusScope: t.statusScope ?? null,
    severity: t.severity ?? null,
    thresholdMin: Math.floor(t.thresholdMin),
    warnRatio: t.warnRatio != null ? Math.floor(t.warnRatio) : 80,
    isActive: t.isActive !== false,
  }
}

/**
 * CTI 서브트리 확장 — 정책의 ctiIds는 자손까지 상속하므로 매칭 대상 조회 시 펼쳐야 한다.
 * nodes는 (id, parentId) 전체 목록.
 */
export function expandCtiSubtree(ctiIds: number[], nodes: { id: number; parentId: number | null }[]): number[] {
  if (ctiIds.length === 0) return []
  const childrenOf = new Map<number, number[]>()
  for (const n of nodes) {
    if (n.parentId == null) continue
    childrenOf.set(n.parentId, [...(childrenOf.get(n.parentId) ?? []), n.id])
  }
  const out = new Set<number>()
  const walk = (id: number) => {
    if (out.has(id)) return
    out.add(id)
    for (const c of childrenOf.get(id) ?? []) walk(c)
  }
  ctiIds.forEach(walk)
  return Array.from(out)
}

/** 스코프 → 열린 티켓 조회 where 절 (미리보기·재계산 공용) */
export function openTicketWhere(scope: PolicyScope, expandedCtiIds: number[]) {
  return {
    status: { notIn: ['RESOLVED', 'CLOSED'] as TicketStatus[] },
    ...(scope.refTypes.length > 0
      ? {
          OR: [
            ...(scope.refTypes.includes('NONE') ? [{ refType: null }] : []),
            { refType: { in: scope.refTypes.filter((r) => r !== 'NONE') } },
          ],
        }
      : {}),
    ...(scope.queueIds.length > 0 ? { queueId: { in: scope.queueIds } } : {}),
    ...(expandedCtiIds.length > 0 ? { ctiId: { in: expandedCtiIds } } : {}),
    ...(scope.severities.length > 0 ? { severity: { in: scope.severities as TicketSeverity[] } } : {}),
  }
}
