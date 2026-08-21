import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { checkWeeklyAccess } from '@/lib/weeklyAccess'
import { addDaysYmd, isMondayYmd, kstMidnight, type WeeklyBoardResponse } from '@/lib/weekly'
import { ITEM_INCLUDE, NOTE_INCLUDE, toItemDto, toNoteDto, ymd } from '../shared'

export const dynamic = 'force-dynamic'

/**
 * 주간업무 보드 — 선택 주차의 항목 목록 + 주간 특이사항 엔트리 (weekly_ops_design.md §5)
 * 표시 대상: 해당 주가 끝나기 전(KST) 생성 AND (미완료 OR 해당 주 이후 완료)
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkWeeklyAccess(user)
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const week = request.nextUrl.searchParams.get('week')
  if (!isMondayYmd(week)) {
    return NextResponse.json({ error: 'week는 월요일 날짜(YYYY-MM-DD)여야 합니다.' }, { status: 400 })
  }
  const weekDate = new Date(week)

  const [rows, noteRows] = await Promise.all([
    prisma.weeklyItem.findMany({
      where: {
        createdAt: { lt: kstMidnight(addDaysYmd(week, 7)) },
        OR: [{ completedWeek: null }, { completedWeek: { gte: weekDate } }],
      },
      include: {
        ...ITEM_INCLUDE,
        // 전체 이력 반환 — 진행 컬럼 주차 네비(◀▶)가 임의 주차를 클라이언트에서 조회 (2026-08-21)
        updates: {
          orderBy: { weekStart: 'desc' },
          include: { updatedBy: { select: { name: true } } },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    }),
    prisma.weeklyWeekNote.findMany({
      where: { weekStart: weekDate },
      orderBy: { id: 'asc' },
      include: NOTE_INCLUDE,
    }),
  ])

  const items = rows.map((row) =>
    toItemDto(row, {
      thisWeek: row.updates.find((u) => ymd(u.weekStart) === week) ?? null,
      lastWeek: row.updates.find((u) => u.weekStart.getTime() < weekDate.getTime()) ?? null,
      all: row.updates,
    })
  )

  const response: WeeklyBoardResponse = {
    week,
    items,
    weekNotes: noteRows.map(toNoteDto),
  }
  return NextResponse.json(response)
}
