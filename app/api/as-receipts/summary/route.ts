import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * AS업무 목록 상단 요약 (2026-09-07 사용자 요청)
 * - byStatus: 상태별 건수 (AS_STATUS 순서, 0건 포함)
 * - thisWeek: 이번 주(KST 월요일~) 접수 건수 (receiptDate 기준)
 * - avgResolutionDays: 최근 3개월 접수 건 중 완료 건의 접수→완료 평균 일수 (2026-09-07 사용자 확정)
 * - avgResolution: 위 평균을 일반 AS / 선교체(pre_replace)로 분리 — 각 {days, count} (2026-09-12 사용자 요청)
 * - overdue2w: 접수 후 14일 경과 & 미종결(완료·취소 아님) 건수
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 이번 주 시작(KST 월요일) — DATE 컬럼은 UTC 자정 저장이라 YMD 문자열로 비교
  const kstNow = new Date(new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }))
  const dow = (kstNow.getDay() + 6) % 7 // 월=0
  const monday = new Date(kstNow)
  monday.setDate(kstNow.getDate() - dow)
  const mondayYmd = monday.toLocaleDateString('sv-SE') // 로컬 파싱과 대칭 — 서버 TZ 무관 (리뷰 결함1)
  const kstTodayYmd = kstNow.toLocaleDateString('sv-SE')
  const overdueCut = new Date(new Date(`${kstTodayYmd}T00:00:00Z`).getTime() - 14 * 86400000) // KST 날짜 기준 14일 (리뷰 결함3)

  const [statuses, byStatusRaw, thisWeek, avgRow, overdue2w] = await Promise.all([
    prisma.statusCode.findMany({ where: { category: 'AS_STATUS' }, orderBy: { order: 'asc' }, select: { id: true, name: true, color: true, ticketStatus: true } }),
    prisma.asReceipt.groupBy({ by: ['statusId'], _count: true }),
    prisma.asReceipt.count({ where: { receiptDate: { gte: new Date(`${mondayYmd}T00:00:00Z`) } } }),
    prisma.$queryRaw<{ pre_replace: boolean; avg_days: number | null; cnt: number }[]>(
      Prisma.sql`SELECT r.pre_replace, AVG(r.resolved_at - r.receipt_date)::float AS avg_days, COUNT(*)::int AS cnt
        FROM as_receipts r JOIN status_codes s ON s.id = r.status_id
        WHERE r.resolved_at IS NOT NULL AND r.receipt_date >= CURRENT_DATE - INTERVAL '3 months'
          AND s.category = 'AS_STATUS' AND s.name = '완료'
        GROUP BY r.pre_replace` // 취소 제외 (리뷰 결함2). 선교체/일반 분리 (2026-09-12)
    ),
    prisma.asReceipt.count({
      where: {
        receiptDate: { lt: overdueCut },
        OR: [
          { statusId: null },
          { status: { ticketStatus: { notIn: ['RESOLVED', 'CLOSED'] } } },
          { status: { ticketStatus: null } },
        ],
      },
    }),
  ])

  const countBy = new Map(byStatusRaw.map((x) => [x.statusId, x._count]))
  const byStatus = statuses.map((s) => ({ id: s.id, name: s.name, color: s.color, count: countBy.get(s.id) ?? 0 }))
  const total = byStatusRaw.reduce((sum, x) => sum + x._count, 0)
  const openTotal = statuses
    .filter((s) => s.ticketStatus !== 'RESOLVED' && s.ticketStatus !== 'CLOSED')
    .reduce((sum, s) => sum + (countBy.get(s.id) ?? 0), 0)
    + (countBy.get(null) ?? 0) // 상태 없음 = 미종결 취급 — overdue2w와 일치 (리뷰 결함4)

  // 평균 처리시간 — 일반/선교체 분리 + 가중 합산(기존 avgResolutionDays 호환)
  const round1 = (v: number | null | undefined) => (v != null ? Math.round(v * 10) / 10 : null)
  const normalRow = avgRow.find((x) => !x.pre_replace)
  const preRow = avgRow.find((x) => x.pre_replace)
  const totalCnt = avgRow.reduce((sum, x) => sum + x.cnt, 0)
  const avgAll = totalCnt > 0 ? avgRow.reduce((sum, x) => sum + (x.avg_days ?? 0) * x.cnt, 0) / totalCnt : null

  return NextResponse.json({
    byStatus,
    total,
    openTotal,
    thisWeek,
    avgResolutionDays: round1(avgAll),
    avgResolution: {
      normal: { days: round1(normalRow?.avg_days), count: normalRow?.cnt ?? 0 },
      preReplace: { days: round1(preRow?.avg_days), count: preRow?.cnt ?? 0 },
    },
    overdue2w,
    weekStart: mondayYmd,
  })
}
