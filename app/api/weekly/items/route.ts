import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { checkWeeklyAccess } from '@/lib/weeklyAccess'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { isWeeklyBizType, isWeeklyItemKind, isWeeklyItemStatus, isYmd } from '@/lib/weekly'
import { isEmptyRichText, sanitizeRichTextHtml } from '@/lib/richtext'
import { ITEM_INCLUDE, toItemDto } from '../shared'

export const dynamic = 'force-dynamic'

/**
 * 주간업무 항목 목록(아카이브·병원 스코프)·생성 (weekly_ops_design.md §5)
 */

// GET ?scope=archive|hospital|overdue&includeDone=1
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkWeeklyAccess(user)
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const scope = request.nextUrl.searchParams.get('scope')
  if (scope !== 'archive' && scope !== 'hospital' && scope !== 'overdue') {
    return NextResponse.json({ error: 'scope는 archive·hospital·overdue 중 하나여야 합니다.' }, { status: 400 })
  }

  // overdue: 미완료 + 목표일이 오늘(KST) 이전 — 보드 행 강조와 동일 판정 축
  const todayKstYmd = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)

  const includeDone = request.nextUrl.searchParams.get('includeDone') === '1'
  const rows = await prisma.weeklyItem.findMany({
    where:
      scope === 'archive'
        ? { completedWeek: { not: null } }
        : scope === 'overdue'
          ? { completedWeek: null, targetDate: { lt: new Date(todayKstYmd) } }
          : includeDone
            ? {}
            : { completedWeek: null },
    include: {
      ...ITEM_INCLUDE,
      updates: {
        orderBy: { weekStart: 'desc' },
        take: 1,
        include: { updatedBy: { select: { name: true } } },
      },
    },
    orderBy:
      scope === 'archive'
        ? [{ completedWeek: 'desc' }, { completedAt: 'desc' }]
        : scope === 'overdue'
          ? [{ targetDate: 'asc' }, { id: 'asc' }]
          : [{ sortOrder: 'asc' }, { id: 'asc' }],
  })

  const items = rows.map((row) => toItemDto(row, { latestUpdate: row.updates[0] ?? null }))
  return NextResponse.json({ items })
}

// POST — 항목 생성
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkWeeklyAccess(user, { write: true })
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }

  if (!isWeeklyItemKind(body.kind)) {
    return NextResponse.json({ error: 'kind가 올바르지 않습니다. (BIZ | OPS | DEV)' }, { status: 400 })
  }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return NextResponse.json({ error: '제목을 입력하세요.' }, { status: 400 })

  let status: string | undefined
  if (body.status !== undefined) {
    if (!isWeeklyItemStatus(body.status)) {
      return NextResponse.json({ error: 'status가 올바르지 않습니다. (진행 | 보류)' }, { status: 400 })
    }
    status = body.status
  }

  let bizType: string | undefined
  if (body.bizType !== undefined) {
    if (!isWeeklyBizType(body.bizType)) {
      return NextResponse.json({ error: 'bizType이 올바르지 않습니다. (thynC | mobiCARE | 공통)' }, { status: 400 })
    }
    bizType = body.bizType
  }

  let targetDate: Date | null = null
  if (body.targetDate !== undefined && body.targetDate !== null && body.targetDate !== '') {
    if (!isYmd(body.targetDate)) {
      return NextResponse.json({ error: 'targetDate 형식이 올바르지 않습니다. (YYYY-MM-DD)' }, { status: 400 })
    }
    targetDate = new Date(body.targetDate)
  }

  const hospitalCode = typeof body.hospitalCode === 'string' && body.hospitalCode ? body.hospitalCode : null
  const ownerId = typeof body.ownerId === 'string' && body.ownerId ? body.ownerId : null
  if (body.ownerTeamId !== undefined && body.ownerTeamId !== null && !(Number.isInteger(body.ownerTeamId) && body.ownerTeamId > 0)) {
    return NextResponse.json({ error: 'ownerTeamId가 올바르지 않습니다.' }, { status: 400 })
  }
  const ownerTeamId = Number.isInteger(body.ownerTeamId) && body.ownerTeamId > 0 ? (body.ownerTeamId as number) : null
  if (hospitalCode) {
    const hospital = await prisma.hospital.findUnique({ where: { hospitalCode }, select: { hospitalCode: true } })
    if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 400 })
  }
  if (ownerId) {
    const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true } })
    if (!owner) return NextResponse.json({ error: '담당자를 찾을 수 없습니다.' }, { status: 400 })
  }
  if (ownerTeamId) {
    const team = await prisma.department.findUnique({ where: { id: ownerTeamId }, select: { id: true } })
    if (!team) return NextResponse.json({ error: '담당 팀을 찾을 수 없습니다.' }, { status: 400 })
  }

  const agg = await prisma.weeklyItem.aggregate({ where: { kind: body.kind }, _max: { sortOrder: true } })
  const sortOrder = (agg._max.sortOrder ?? 0) + 10

  const item = await prisma.weeklyItem.create({
    data: {
      kind: body.kind,
      title,
      // 설명은 리치텍스트(HTML) — sanitize 후 빈 값 판정 (2026-08-20)
      detail: (() => {
        const html = typeof body.detail === 'string' ? sanitizeRichTextHtml(body.detail.trim()) : ''
        return html && !isEmptyRichText(html) ? html : null
      })(),
      ...(status ? { status } : {}),
      ...(bizType ? { bizType } : {}),
      hospitalCode,
      ownerId,
      ownerTeamId,
      targetDate,
      sortOrder,
      createdById: user.userId,
    },
    include: ITEM_INCLUDE,
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'weekly_item',
    resourceId: item.id,
    resourceLabel: title,
    after: item,
  })

  return NextResponse.json({ item: toItemDto(item) }, { status: 201 })
}
