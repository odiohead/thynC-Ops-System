import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { checkWeeklyAccess } from '@/lib/weeklyAccess'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { isMondayYmd, type WeeklyUpdateDto } from '@/lib/weekly'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

/**
 * 주간업무 항목 × 주차 진행 기록 — (itemId, weekStart) 당 1건 upsert.
 * 빈 문자열 저장 = 해당 주차 기록 삭제 (weekly_ops_design.md §5)
 */
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
  const week = body.week
  if (!isMondayYmd(week)) {
    return NextResponse.json({ error: 'week는 월요일 날짜(YYYY-MM-DD)여야 합니다.' }, { status: 400 })
  }
  if (typeof body.content !== 'string') {
    return NextResponse.json({ error: 'content는 문자열이어야 합니다.' }, { status: 400 })
  }
  const content: string = body.content

  const item = await prisma.weeklyItem.findUnique({ where: { id }, select: { id: true, title: true } })
  if (!item) return NextResponse.json({ error: '항목을 찾을 수 없습니다.' }, { status: 404 })

  const weekStart = new Date(week)
  const existing = await prisma.weeklyItemUpdate.findUnique({
    where: { itemId_weekStart: { itemId: id, weekStart } },
  })

  // 빈 내용 → 해당 주차 기록 삭제
  if (content.trim() === '') {
    if (existing) {
      await prisma.weeklyItemUpdate.delete({ where: { id: existing.id } })
      await logAudit({
        req: request,
        actor: auditActorFromJWT(user),
        action: 'DELETE',
        resource: 'weekly_item_update',
        resourceId: existing.id,
        resourceLabel: `${item.title} ${week}`,
        before: existing,
      })
    }
    return NextResponse.json({ deleted: true })
  }

  const saved = await prisma.weeklyItemUpdate.upsert({
    where: { itemId_weekStart: { itemId: id, weekStart } },
    update: { content, updatedById: user.userId },
    create: { itemId: id, weekStart, content, updatedById: user.userId },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: existing ? 'UPDATE' : 'CREATE',
    resource: 'weekly_item_update',
    resourceId: saved.id,
    resourceLabel: `${item.title} ${week}`,
    before: existing ?? undefined,
    after: saved,
  })

  const update: WeeklyUpdateDto = {
    weekStart: week,
    content: saved.content,
    updatedByName: user.name,
    updatedAt: saved.updatedAt.toISOString(),
  }
  return NextResponse.json({ update })
}
