/**
 * 사용량 대시보드 — 저장된 보기 (projects/usage_dashboard_filter_design.md §4.3)
 *
 * 조건 묶음(lib/usage/filters.ts ViewFilters)에 이름을 붙여 본체 DB(usage_dashboard_views)에 저장한다.
 *  - 내 보기 + 공유된 보기를 볼 수 있다. 공유하지 않은 남의 보기는 목록에도, 번호로도 열리지 않는다
 *  - 수정 · 삭제 · 공유 켜기/끄기는 만든 사람 또는 ADMIN 이상
 * 누가 사용량을 볼 수 있는지는 호출부(app/api/usage/_shared.ts usageGate)가 먼저 본다.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isAdminOrAbove, type JWTPayload } from '@/lib/auth'
import { usagePool } from './db'
import { OPERATING_HOSPITAL_STATUS } from './agents'
import { NO_TYPE_LABEL, normalizeViewFilters, readViewFilters, type ViewFilters } from './filters'

export const VIEW_NAME_MAX = 60
/** 한 사람이 만들 수 있는 보기 수 */
export const VIEW_MAX_PER_USER = 50

export type UsageView = {
  id: number
  name: string
  isShared: boolean
  ownerId: string
  ownerName: string
  /** 내가 만든 보기인가 · 내가 고칠 수 있는가(만든 사람 또는 ADMIN 이상) */
  mine: boolean
  canEdit: boolean
  filters: ViewFilters
  updatedAt: string
}

export class ViewError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

type Row = { id: number; name: string; isShared: boolean; ownerId: string; filters: Prisma.JsonValue; updatedAt: Date; owner: { name: string } }
const SELECT = { id: true, name: true, isShared: true, ownerId: true, filters: true, updatedAt: true, owner: { select: { name: true } } } as const

function toView(r: Row, user: JWTPayload): UsageView {
  const mine = r.ownerId === user.userId
  return {
    id: r.id,
    name: r.name,
    isShared: r.isShared,
    ownerId: r.ownerId,
    ownerName: r.owner.name,
    mine,
    canEdit: mine || isAdminOrAbove(user.role),
    filters: readViewFilters(r.filters),
    updatedAt: r.updatedAt.toISOString(),
  }
}

/** 내 보기(이름순) 다음에 공유된 남의 보기(이름순) */
export async function listViews(user: JWTPayload): Promise<UsageView[]> {
  const rows = await prisma.usageDashboardView.findMany({
    where: { OR: [{ ownerId: user.userId }, { isShared: true }] },
    select: SELECT,
    orderBy: { name: 'asc' },
  })
  const views = rows.map((r) => toView(r, user))
  return [...views.filter((v) => v.mine), ...views.filter((v) => !v.mine)]
}

/** 볼 수 있는 보기 하나 — 없거나 공유되지 않은 남의 것이면 null */
export async function getVisibleView(id: number, user: JWTPayload): Promise<UsageView | null> {
  const r = await prisma.usageDashboardView.findUnique({ where: { id }, select: SELECT })
  if (!r || (r.ownerId !== user.userId && !r.isShared)) return null
  return toView(r, user)
}

function cleanName(v: unknown): string {
  const name = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : ''
  if (!name) throw new ViewError(400, '보기 이름을 입력하세요.')
  if (name.length > VIEW_NAME_MAX) throw new ViewError(400, `보기 이름은 ${VIEW_NAME_MAX}자까지입니다.`)
  return name
}

function cleanFilters(v: unknown): ViewFilters {
  const r = normalizeViewFilters(v)
  if ('error' in r) throw new ViewError(400, r.error)
  return r.filters
}

const isUniqueError = (e: unknown) => (e as { code?: string }).code === 'P2002'

export async function createView(user: JWTPayload, body: { name?: unknown; isShared?: unknown; filters?: unknown }): Promise<UsageView> {
  const name = cleanName(body.name)
  const filters = cleanFilters(body.filters)
  if ((await prisma.usageDashboardView.count({ where: { ownerId: user.userId } })) >= VIEW_MAX_PER_USER) {
    throw new ViewError(400, `보기는 ${VIEW_MAX_PER_USER}개까지 만들 수 있습니다. 쓰지 않는 보기를 지워 주세요.`)
  }
  try {
    const r = await prisma.usageDashboardView.create({
      data: { name, ownerId: user.userId, isShared: body.isShared === true, filters: filters as unknown as Prisma.InputJsonValue },
      select: SELECT,
    })
    return toView(r, user)
  } catch (e) {
    if (isUniqueError(e)) throw new ViewError(409, `'${name}' 이름의 보기가 이미 있습니다.`)
    throw e
  }
}

/** 고칠 수 있는 보기를 찾는다 — 볼 수 없는 보기는 없는 것으로(404), 볼 수는 있지만 고칠 수 없으면 403 */
async function editable(id: number, user: JWTPayload): Promise<UsageView> {
  const view = await getVisibleView(id, user)
  // ADMIN 이상은 공유되지 않은 남의 보기도 정리할 수 있어야 한다(만든 사람이 떠난 경우) — 번호를 아는 경우에 한해
  if (!view) {
    if (!isAdminOrAbove(user.role)) throw new ViewError(404, '보기를 찾을 수 없습니다.')
    const r = await prisma.usageDashboardView.findUnique({ where: { id }, select: SELECT })
    if (!r) throw new ViewError(404, '보기를 찾을 수 없습니다.')
    return toView(r, user)
  }
  if (!view.canEdit) throw new ViewError(403, '만든 사람과 관리자만 고칠 수 있습니다.')
  return view
}

export async function updateView(id: number, user: JWTPayload, body: { name?: unknown; isShared?: unknown; filters?: unknown }): Promise<{ before: UsageView; after: UsageView }> {
  const before = await editable(id, user)
  const data: Prisma.UsageDashboardViewUpdateInput = {}
  if (body.name !== undefined) data.name = cleanName(body.name)
  if (body.isShared !== undefined) data.isShared = body.isShared === true
  if (body.filters !== undefined) data.filters = cleanFilters(body.filters) as unknown as Prisma.InputJsonValue
  if (Object.keys(data).length === 0) throw new ViewError(400, '바꿀 내용이 없습니다.')
  try {
    const r = await prisma.usageDashboardView.update({ where: { id }, data, select: SELECT })
    return { before, after: toView(r, user) }
  } catch (e) {
    if (isUniqueError(e)) throw new ViewError(409, `'${String(data.name)}' 이름의 보기가 이미 있습니다.`)
    throw e
  }
}

export async function deleteView(id: number, user: JWTPayload): Promise<UsageView> {
  const view = await editable(id, user)
  await prisma.usageDashboardView.delete({ where: { id } })
  return view
}

export type FilterHospital = { hospitalCode: string; hospitalName: string; type: string; collecting: boolean; tags: string[] }

/**
 * '병원 지정'에서 고를 수 있는 병원 — 운영 중인 병원 + 수집 서버가 등록된 병원. 수집을 시작하지 않은 병원도 담을 수 있다
 * (수집을 시작하면 그 보기에 나타난다).
 */
export async function listFilterHospitals(): Promise<FilterHospital[]> {
  const servers = await usagePool().query(`SELECT DISTINCT hospital_code FROM agent_servers`)
  const collecting = new Set(servers.rows.map((r) => r.hospital_code as string))
  const rows = await prisma.hospital.findMany({
    where: { OR: [{ status: OPERATING_HOSPITAL_STATUS }, { hospitalCode: { in: Array.from(collecting) } }] },
    select: { hospitalCode: true, hospitalName: true, type: true, tagAssignments: { select: { tag: { select: { name: true, isActive: true } } } } },
    orderBy: { hospitalName: 'asc' },
  })
  return rows.map((h) => ({
    hospitalCode: h.hospitalCode,
    hospitalName: h.hospitalName,
    type: h.type && h.type.trim() ? h.type.trim() : NO_TYPE_LABEL,
    collecting: collecting.has(h.hospitalCode),
    tags: h.tagAssignments.filter((a) => a.tag.isActive).map((a) => a.tag.name),
  }))
}
