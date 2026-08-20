import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { checkWeeklyAccess } from '@/lib/weeklyAccess'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { currentMondayKstYmd, isMondayYmd, isWeeklyBizType, isWeeklyItemKind, isWeeklyItemStatus, isYmd, type WeeklyItemDetailDto } from '@/lib/weekly'
import { isEmptyRichText, sanitizeRichTextHtml } from '@/lib/richtext'
import { ITEM_INCLUDE, toItemDto, toUpdateDto } from '../../shared'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * 주간업무 항목 단건 — 상세 / 수정(완료·재개·순서이동·필드) / 삭제 (weekly_ops_design.md §5)
 */

// GET — 상세 (updates 전체 역순)
export async function GET(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkWeeklyAccess(user)
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: '잘못된 id입니다.' }, { status: 400 })
  }

  const item = await prisma.weeklyItem.findUnique({
    where: { id },
    include: {
      ...ITEM_INCLUDE,
      createdBy: { select: { name: true } },
      updates: {
        orderBy: { weekStart: 'desc' },
        include: { updatedBy: { select: { name: true } } },
      },
    },
  })
  if (!item) return NextResponse.json({ error: '항목을 찾을 수 없습니다.' }, { status: 404 })

  const detail: WeeklyItemDetailDto = {
    ...toItemDto(item), // thisWeek/lastWeek/latestUpdate는 null로 포함되나 상세 계약에서 미사용
    createdByName: item.createdBy?.name ?? null,
    updates: item.updates.map(toUpdateDto),
  }
  return NextResponse.json({ item: detail })
}

// PUT — { complete: { week } } | { reopen: true } | { move: 'up'|'down' } | 필드 수정 (액션 키가 있으면 액션만)
export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkWeeklyAccess(user, { write: true })
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: '잘못된 id입니다.' }, { status: 400 })
  }
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }

  const before = await prisma.weeklyItem.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '항목을 찾을 수 없습니다.' }, { status: 404 })

  // ── 액션: 완료 처리 ──
  if (body.complete !== undefined) {
    const week = body.complete?.week
    if (!isMondayYmd(week)) {
      return NextResponse.json({ error: 'week는 월요일 날짜(YYYY-MM-DD)여야 합니다.' }, { status: 400 })
    }
    if (week > currentMondayKstYmd()) {
      return NextResponse.json({ error: '미래 주에는 완료 처리할 수 없습니다.' }, { status: 400 })
    }
    const item = await prisma.weeklyItem.update({
      where: { id },
      data: { completedWeek: new Date(week), completedAt: new Date() },
      include: ITEM_INCLUDE,
    })
    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'weekly_item',
      resourceId: id,
      resourceLabel: before.title,
      before,
      after: item,
    })
    return NextResponse.json({ item: toItemDto(item) })
  }

  // ── 액션: 완료 취소(재개) ──
  if (body.reopen === true) {
    const item = await prisma.weeklyItem.update({
      where: { id },
      data: { completedWeek: null, completedAt: null },
      include: ITEM_INCLUDE,
    })
    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'weekly_item',
      resourceId: id,
      resourceLabel: before.title,
      before,
      after: item,
    })
    return NextResponse.json({ item: toItemDto(item) })
  }

  // ── 액션: 순서 이동 (같은 kind·미완료 목록 내 이웃과 sortOrder swap) ──
  if (body.move === 'up' || body.move === 'down') {
    const list = await prisma.weeklyItem.findMany({
      where: { kind: before.kind, completedWeek: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, sortOrder: true },
    })
    const idx = list.findIndex((x) => x.id === id)
    const nIdx = body.move === 'up' ? idx - 1 : idx + 1
    if (idx === -1 || nIdx < 0 || nIdx >= list.length) {
      // 이웃 없음(맨 끝) 또는 미완료 목록에 없음 — no-op
      const item = await prisma.weeklyItem.findUnique({ where: { id }, include: ITEM_INCLUDE })
      return NextResponse.json({ item: toItemDto(item!) })
    }
    const a = list[idx]
    const b = list[nIdx]
    if (a.sortOrder === b.sortOrder) {
      // 값 충돌 — 목록 전체를 index*10으로 재부여한 뒤 대상·이웃만 swap
      await prisma.$transaction(
        list.map((x, i) => {
          const order = x.id === a.id ? nIdx * 10 : x.id === b.id ? idx * 10 : i * 10
          return prisma.weeklyItem.update({ where: { id: x.id }, data: { sortOrder: order } })
        })
      )
    } else {
      await prisma.$transaction([
        prisma.weeklyItem.update({ where: { id: a.id }, data: { sortOrder: b.sortOrder } }),
        prisma.weeklyItem.update({ where: { id: b.id }, data: { sortOrder: a.sortOrder } }),
      ])
    }
    const item = await prisma.weeklyItem.findUnique({ where: { id }, include: ITEM_INCLUDE })
    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'UPDATE',
      resource: 'weekly_item',
      resourceId: id,
      resourceLabel: before.title,
      before,
      after: item,
    })
    return NextResponse.json({ item: toItemDto(item!) })
  }

  // ── 필드 수정 (전달된 키만 반영) ──
  const data: Record<string, unknown> = {}

  if (body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 })
    data.title = title
  }
  if (body.detail !== undefined) {
    if (body.detail !== null && typeof body.detail !== 'string') {
      return NextResponse.json({ error: 'detail이 올바르지 않습니다.' }, { status: 400 })
    }
    // 설명은 리치텍스트(HTML) — sanitize 후 태그 제거 기준으로 빈 값 판정 (2026-08-20)
    const detailHtml = typeof body.detail === 'string' ? sanitizeRichTextHtml(body.detail.trim()) : ''
    data.detail = detailHtml && !isEmptyRichText(detailHtml) ? detailHtml : null
  }
  if (body.kind !== undefined) {
    if (!isWeeklyItemKind(body.kind)) {
      return NextResponse.json({ error: 'kind가 올바르지 않습니다. (BIZ | OPS | DEV)' }, { status: 400 })
    }
    data.kind = body.kind
  }
  if (body.status !== undefined) {
    if (!isWeeklyItemStatus(body.status)) {
      return NextResponse.json({ error: 'status가 올바르지 않습니다. (진행 | 보류)' }, { status: 400 })
    }
    data.status = body.status
  }
  if (body.bizType !== undefined) {
    if (!isWeeklyBizType(body.bizType)) {
      return NextResponse.json({ error: 'bizType이 올바르지 않습니다. (thynC | mobiCARE | 공통)' }, { status: 400 })
    }
    data.bizType = body.bizType
  }
  if (body.hospitalCode !== undefined) {
    const code = typeof body.hospitalCode === 'string' && body.hospitalCode ? body.hospitalCode : null
    if (code) {
      const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: code }, select: { hospitalCode: true } })
      if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 400 })
    }
    data.hospitalCode = code
  }
  if (body.ownerTeamId !== undefined) {
    if (body.ownerTeamId !== null && !(Number.isInteger(body.ownerTeamId) && body.ownerTeamId > 0)) {
      return NextResponse.json({ error: 'ownerTeamId가 올바르지 않습니다.' }, { status: 400 })
    }
    const teamId = Number.isInteger(body.ownerTeamId) && body.ownerTeamId > 0 ? (body.ownerTeamId as number) : null
    if (teamId) {
      const team = await prisma.department.findUnique({ where: { id: teamId }, select: { id: true } })
      if (!team) return NextResponse.json({ error: '담당 팀을 찾을 수 없습니다.' }, { status: 400 })
    }
    data.ownerTeamId = teamId
  }
  if (body.ownerId !== undefined) {
    const ownerId = typeof body.ownerId === 'string' && body.ownerId ? body.ownerId : null
    if (ownerId) {
      const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true } })
      if (!owner) return NextResponse.json({ error: '담당자를 찾을 수 없습니다.' }, { status: 400 })
    }
    data.ownerId = ownerId
  }
  if (body.targetDate !== undefined) {
    if (body.targetDate === null || body.targetDate === '') {
      data.targetDate = null
    } else if (isYmd(body.targetDate)) {
      data.targetDate = new Date(body.targetDate)
    } else {
      return NextResponse.json({ error: 'targetDate 형식이 올바르지 않습니다. (YYYY-MM-DD)' }, { status: 400 })
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: '수정할 내용이 없습니다.' }, { status: 400 })
  }

  const item = await prisma.weeklyItem.update({ where: { id }, data, include: ITEM_INCLUDE })
  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'UPDATE',
    resource: 'weekly_item',
    resourceId: id,
    resourceLabel: item.title,
    before,
    after: item,
  })
  return NextResponse.json({ item: toItemDto(item) })
}

// DELETE — 항목 삭제 (updates는 FK CASCADE)
export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkWeeklyAccess(user, { write: true })
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: '잘못된 id입니다.' }, { status: 400 })
  }

  const before = await prisma.weeklyItem.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: '항목을 찾을 수 없습니다.' }, { status: 404 })

  await prisma.weeklyItem.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'weekly_item',
    resourceId: id,
    resourceLabel: before.title,
    before,
  })
  return NextResponse.json({ success: true })
}
