import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { checkWeeklyAccess } from '@/lib/weeklyAccess'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { isMondayYmd, type WeeklyNoteDto } from '@/lib/weekly'
import { ymd } from '../shared'

export const dynamic = 'force-dynamic'

/**
 * 주간 특이사항 엔트리 생성 (weekly_ops_design.md §6a 개정 — 주차별 N건 자유 기재)
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkWeeklyAccess(user, { write: true })
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }
  const week = body.week
  if (!isMondayYmd(week)) {
    return NextResponse.json({ error: 'week는 월요일 날짜(YYYY-MM-DD)여야 합니다.' }, { status: 400 })
  }
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content) return NextResponse.json({ error: '내용을 입력하세요.' }, { status: 400 })

  const row = await prisma.weeklyWeekNote.create({
    data: { weekStart: new Date(week), content, createdById: user.userId, updatedById: user.userId },
    include: { createdBy: { select: { name: true } }, updatedBy: { select: { name: true } } },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'weekly_week_note',
    resourceId: row.id,
    resourceLabel: `주간 특이사항 ${week}`,
    after: row,
  })

  const note: WeeklyNoteDto = {
    id: row.id,
    weekStart: ymd(row.weekStart),
    content: row.content,
    createdByName: row.createdBy?.name ?? null,
    updatedByName: row.updatedBy?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
  return NextResponse.json({ note }, { status: 201 })
}
