import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// 한국 시간(Asia/Seoul) 기준 이번주/차주 월~일 범위 계산
function getWeekRange(offsetWeeks: number): { start: Date; end: Date } {
  const now = new Date()
  // UTC+9 보정
  const KST_OFFSET = 9 * 60 * 60 * 1000
  const kstNow = new Date(now.getTime() + KST_OFFSET)

  // 이번주 월요일 (KST)
  const dayOfWeek = kstNow.getUTCDay() // 0=일, 1=월 ... 6=토
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const monday = new Date(kstNow)
  monday.setUTCDate(kstNow.getUTCDate() + diffToMonday + offsetWeeks * 7)
  monday.setUTCHours(0, 0, 0, 0)

  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  sunday.setUTCHours(23, 59, 59, 999)

  // KST → UTC 변환
  return {
    start: new Date(monday.getTime() - KST_OFFSET),
    end: new Date(sunday.getTime() - KST_OFFSET),
  }
}

const projectSelect = {
  projectCode: true,
  startDate: true,
  endDateExpected: true,
  remark: true,
  builderUserId: true,
  builderNameManual: true,
  hospital: { select: { hospitalName: true, hiraHospitalName: true } },
  buildStatus: { select: { label: true, color: true } },
  builder: { select: { name: true } },
} as const

export async function GET() {
  const thisWeek = getWeekRange(0)
  const nextWeek = getWeekRange(1)

  // 이번주 구축현황:
  // (A) buildStatus가 null이거나 label이 "완료"가 아닌 프로젝트
  // (B) startDate가 이번주 범위 내인 프로젝트
  const thisWeekProjects = await prisma.project.findMany({
    where: {
      OR: [
        { startDate: { gte: thisWeek.start, lte: thisWeek.end } },
        { buildStatus: { label: '진행중' } },
      ],
    },
    select: projectSelect,
    orderBy: [
      { endDateExpected: { sort: 'asc', nulls: 'last' } },
    ],
  })

  // 중복 제거 (projectCode 기준)
  const seenCodes = new Set<string>()
  const thisWeekDeduped = thisWeekProjects.filter((p) => {
    if (seenCodes.has(p.projectCode)) return false
    seenCodes.add(p.projectCode)
    return true
  })

  // 차주 구축현황: startDate가 차주 범위 내인 프로젝트
  const nextWeekProjects = await prisma.project.findMany({
    where: {
      startDate: { gte: nextWeek.start, lte: nextWeek.end },
    },
    select: projectSelect,
    orderBy: { startDate: 'asc' },
  })

  return NextResponse.json({
    thisWeek: thisWeekDeduped,
    nextWeek: nextWeekProjects,
  })
}
