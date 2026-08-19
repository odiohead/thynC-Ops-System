import type { WeeklyItemDto, WeeklyItemKind, WeeklyUpdateDto } from '@/lib/weekly'

/**
 * 주간업무 API 공용 — prisma row → DTO 조립 (projects/weekly_ops_design.md)
 * DTO 계약은 lib/weekly.ts 단일 소스. 키 이름 변경 금지 (페이지가 같은 계약으로 병렬 개발 중).
 */

/** 항목 조회 공통 include (updates는 라우트별로 조건이 달라 각자 지정) */
export const ITEM_INCLUDE = {
  hospital: { select: { hospitalName: true } },
  ownerTeam: { select: { name: true } },
  owner: { select: { name: true } },
} as const

/** DATE 컬럼 직렬화 — YYYY-MM-DD */
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export type UpdateRow = {
  weekStart: Date
  content: string
  updatedAt: Date
  updatedBy: { name: string } | null
}

export type ItemRow = {
  id: number
  kind: string
  title: string
  detail: string | null
  status: string
  bizType: string
  hospitalCode: string | null
  ownerTeamId: number | null
  ownerId: string | null
  targetDate: Date | null
  completedWeek: Date | null
  completedAt: Date | null
  sortOrder: number
  createdAt: Date
  hospital?: { hospitalName: string } | null
  ownerTeam?: { name: string } | null
  owner?: { name: string } | null
}

export function toUpdateDto(u: UpdateRow): WeeklyUpdateDto {
  return {
    weekStart: ymd(u.weekStart),
    content: u.content,
    updatedByName: u.updatedBy?.name ?? null,
    updatedAt: u.updatedAt.toISOString(),
  }
}

export function toItemDto(
  item: ItemRow,
  updates?: { thisWeek?: UpdateRow | null; lastWeek?: UpdateRow | null; latestUpdate?: UpdateRow | null }
): WeeklyItemDto {
  return {
    id: item.id,
    kind: item.kind as WeeklyItemKind,
    title: item.title,
    detail: item.detail,
    status: item.status,
    bizType: item.bizType,
    hospitalCode: item.hospitalCode,
    hospitalName: item.hospital?.hospitalName ?? null,
    ownerTeamId: item.ownerTeamId,
    ownerTeamName: item.ownerTeam?.name ?? null,
    ownerId: item.ownerId,
    ownerName: item.owner?.name ?? null,
    targetDate: item.targetDate ? ymd(item.targetDate) : null,
    completedWeek: item.completedWeek ? ymd(item.completedWeek) : null,
    completedAt: item.completedAt ? item.completedAt.toISOString() : null,
    sortOrder: item.sortOrder,
    createdAt: item.createdAt.toISOString(),
    thisWeek: updates?.thisWeek ? toUpdateDto(updates.thisWeek) : null,
    lastWeek: updates?.lastWeek ? toUpdateDto(updates.lastWeek) : null,
    latestUpdate: updates?.latestUpdate ? toUpdateDto(updates.latestUpdate) : null,
  }
}
