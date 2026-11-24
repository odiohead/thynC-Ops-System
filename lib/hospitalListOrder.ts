import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'

/**
 * 병원 목록 정렬 — 미계약이 아닌 병원 먼저, 각 묶음 안에서는 최근 등록순 (2026-11-12).
 *
 * 병원 8만여 건 중 대부분이 심평원에서 일괄 등록된 미계약 병원이라, 최근 등록순만으로는
 * 실제 고객 병원이 같은 이름의 미계약 행 아래로 밀렸다(병원 목록·병원 검색 선택 공통).
 * 상태는 문자열 컬럼이라 DB 정렬식으로 못 쓰므로 두 묶음을 이어 붙여 한 페이지의 id를 순서대로 돌려준다.
 */
const UNCONTRACTED = '미계약'
const ORDER: Prisma.HospitalOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { id: 'desc' }]

export async function hospitalPageIdsActiveFirst(where: Prisma.HospitalWhereInput, skip: number, take: number): Promise<number[]> {
  const activeWhere: Prisma.HospitalWhereInput = { AND: [where, { status: { not: UNCONTRACTED } }] }
  const restWhere: Prisma.HospitalWhereInput = { AND: [where, { status: UNCONTRACTED }] }
  const activeCount = await prisma.hospital.count({ where: activeWhere })

  const ids: number[] = []
  if (skip < activeCount) {
    const rows = await prisma.hospital.findMany({ where: activeWhere, skip, take, orderBy: ORDER, select: { id: true } })
    ids.push(...rows.map((r) => r.id))
  }
  if (ids.length < take) {
    const rows = await prisma.hospital.findMany({
      where: restWhere, skip: Math.max(0, skip - activeCount), take: take - ids.length, orderBy: ORDER, select: { id: true },
    })
    ids.push(...rows.map((r) => r.id))
  }
  return ids
}

/** `id in (...)`로 읽은 행을 id 목록 순서로 되돌린다 */
export function sortByIdOrder<T extends { id: number }>(rows: T[], ids: number[]): T[] {
  const pos = new Map(ids.map((id, i) => [id, i]))
  return [...rows].sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0))
}
