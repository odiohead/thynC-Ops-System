/**
 * 도메인 어댑터 공용 헬퍼 — 구 lib/ticketDomain.ts 상단 공용 블록의 동작 불변 이관 (P0)
 *
 * 상태 매핑 해석 (ticket_status_map_design.md §5 — 컬럼 우선·하드코딩 폴백):
 * 도메인 상태코드 행의 ticket_status/ticket_pending_reason_id가 단일 소스.
 * 컬럼 NULL(시드 유실·신규 환경)이면 각 어댑터의 하드코딩 switch로 폴백 — 동기화는 절대 실패하지 않는다.
 */
import { Prisma, TicketStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveDomainTicketRule, resolveDomainQueueId } from '@/lib/ticketCtiRules'
import { TICKET_DOMAIN_META, type DomainRefType } from './meta'

export type DbClient = Prisma.TransactionClient | typeof prisma

/** OPEN 계열 owner 자동 판정 (티켓 자체의 OPEN↔ASSIGNED 자동 연동과 동일 규칙) */
export function applyOwnerRule(status: TicketStatus, hasOwner: boolean): TicketStatus {
  if (status === 'OPEN' && hasOwner) return 'ASSIGNED'
  if (status === 'ASSIGNED' && !hasOwner) return 'OPEN'
  return status
}

export interface StatusMappingRow {
  name: string
  ticketStatus: TicketStatus | null
  ticketPendingReasonId: number | null
}

export const STATUS_MAPPING_SELECT = { name: true, ticketStatus: true, ticketPendingReasonId: true } as const

/** status_codes id → 매핑 행 조회 (create 경로용 — sync 경로는 relation select로 함께 로드) */
export async function getStatusMapping(tx: DbClient, statusCodeId: number | null | undefined): Promise<StatusMappingRow | null> {
  if (!statusCodeId) return null
  return tx.statusCode.findUnique({ where: { id: statusCodeId }, select: STATUS_MAPPING_SELECT })
}

/** 순방향: 매핑 행 우선, 미매핑이면 fallback(어댑터의 하드코딩 switch) */
export function mappedTicketStatus(row: StatusMappingRow | null | undefined, hasOwner: boolean, fallback: () => TicketStatus): TicketStatus {
  if (row?.ticketStatus) return applyOwnerRule(row.ticketStatus, hasOwner)
  return fallback()
}

/** RESOLVED·CLOSED는 역방향에서 같은 버킷 (결정①A — 도메인 완료는 단일 상태) */
export function bucketOf(status: TicketStatus): TicketStatus[] {
  if (status === 'OPEN' || status === 'ASSIGNED') return ['OPEN']
  if (status === 'RESOLVED' || status === 'CLOSED') return ['RESOLVED', 'CLOSED']
  return [status]
}

/**
 * 역방향: 티켓 상태 → 도메인 상태코드 선택 (반환 null = 변경 불필요 또는 대상 없음 no-op)
 * 1) keep-if-consistent — 현재 도메인 상태가 같은 버킷에 매핑돼 있으면 변경 없음
 * 2) PENDING은 티켓 pendingReason 일치 행 우선
 * 3) 그 외 order 최소 행
 * 4) 매핑 행이 전무하면 fallbackName(기존 이름 매칭)으로 조회
 */
export async function pickDomainStatus(
  tx: DbClient,
  category: string,
  currentStatusId: number | null,
  ticket: { status: TicketStatus; pendingReasonId?: number | null },
  fallbackName: string
): Promise<number | null> {
  const bucket = bucketOf(ticket.status)
  const candidates = await tx.statusCode.findMany({
    where: { category, ticketStatus: { in: bucket } },
    select: { id: true, ticketPendingReasonId: true },
    orderBy: { order: 'asc' },
  })
  if (!candidates.length) {
    // 버킷만 비었으면(카테고리에 다른 매핑은 있음) 도메인 상태 유지 — 설정 UI 경고로 노출 (§5 no-op)
    const mappedAny = await tx.statusCode.count({ where: { category, ticketStatus: { not: null } } })
    if (mappedAny > 0) return null
    // 카테고리 전체 미시드 환경 — 기존 이름 매칭 폴백
    const byName = await tx.statusCode.findFirst({ where: { category, name: fallbackName }, select: { id: true } })
    return byName && byName.id !== currentStatusId ? byName.id : null
  }
  if (currentStatusId && candidates.some((c) => c.id === currentStatusId)) return null // 일치 유지
  if (ticket.status === 'PENDING' && ticket.pendingReasonId) {
    const byReason = candidates.find((c) => c.ticketPendingReasonId === ticket.pendingReasonId)
    if (byReason) return byReason.id
  }
  return candidates[0].id
}

/** 역방향(프로젝트): 티켓 상태 → BuildStatus 선택. 규칙은 pickDomainStatus와 동일, 폴백은 기존 라벨 앵커 */
export async function pickBuildStatus(tx: DbClient, currentId: number | null, ticketStatus: TicketStatus): Promise<number | null> {
  const bucket = bucketOf(ticketStatus)
  const candidates = await tx.buildStatus.findMany({
    where: { ticketStatus: { in: bucket } },
    select: { id: true },
    orderBy: { sortOrder: 'asc' },
  })
  if (!candidates.length) {
    const anchor =
      ticketStatus === 'RESOLVED' || ticketStatus === 'CLOSED' ? '완료'
      : ticketStatus === 'PENDING' ? '보류'
      : ticketStatus === 'IN_PROGRESS' ? '진행'
      : '준비'
    const byLabel = await tx.buildStatus.findFirst({ where: { label: { contains: anchor } }, select: { id: true } })
    return byLabel && byLabel.id !== currentId ? byLabel.id : null
  }
  if (currentId && candidates.some((c) => c.id === currentId)) return null // 일치 유지
  return candidates[0].id
}

/** PENDING 사유 id 확정: 매핑 행 지정 사유 → 이름 폴백 */
export async function resolvePendingReasonId(tx: DbClient, mapped: number | null | undefined, fallbackName: string): Promise<number | null> {
  if (mapped) return mapped
  const reason = await tx.ticketPendingReason.findUnique({ where: { name: fallbackName }, select: { id: true } })
  return reason?.id ?? null
}

/**
 * 자동생성 규칙 해석 (ticket_cti_rule_design.md §4) — 규칙 테이블 → 없으면 어댑터의 하드코딩 폴백.
 * 규칙이 유실되거나 시드 전이어도 티켓 생성이 실패하지 않게 코드 폴백을 남긴다.
 */
export async function resolveRuleWithFallback(
  tx: Prisma.TransactionClient,
  refType: DomainRefType,
  fallbackCti: () => Promise<number | null>,
  opts: { statusCodeId?: number | null } = {}
): Promise<{ ctiId: number | null; queueId: number | null; fillDescription: boolean }> {
  const rule = await resolveDomainTicketRule(tx, refType, opts)
  const queueId = await resolveDomainQueueId(tx, rule, TICKET_DOMAIN_META[refType].fallbackQueueName)
  return {
    ctiId: rule?.ctiId ?? (await fallbackCti()),
    queueId,
    fillDescription: rule ? rule.fillDescription : true,
  }
}

/** 연결 업무 배너용 날짜(YYYY-MM-DD) — 구 클라이언트 dateOnly와 동일 결과(UTC ISO 앞 10자) */
export function bannerDate(val: Date | string | null | undefined): string {
  if (!val) return '-'
  return (typeof val === 'string' ? val : val.toISOString()).slice(0, 10)
}
