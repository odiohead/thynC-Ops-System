import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { checkWeeklyAccess } from '@/lib/weeklyAccess'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { isMondayYmd } from '@/lib/weekly'
import { isEmptyRichText, sanitizeRichTextHtml } from '@/lib/richtext'
import { NOTE_INCLUDE, toNoteDto } from '../shared'

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
  // 리치텍스트(HTML) 저장 — sanitize 후 태그 제거 기준으로 빈 내용 판정 (2026-08-20)
  const content = typeof body.content === 'string' ? sanitizeRichTextHtml(body.content.trim()) : ''
  if (!content || isEmptyRichText(content)) {
    return NextResponse.json({ error: '내용을 입력하세요.' }, { status: 400 })
  }

  const row = await prisma.weeklyWeekNote.create({
    data: { weekStart: new Date(week), content, createdById: user.userId, updatedById: user.userId },
    include: NOTE_INCLUDE,
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

  return NextResponse.json({ note: toNoteDto(row) }, { status: 201 })
}
