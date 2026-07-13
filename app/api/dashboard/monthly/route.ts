import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // buildStatus가 "완료" 또는 "구축완료"이고 endDateExpected가 있는 프로젝트 조회
  const projects = await prisma.project.findMany({
    where: {
      endDateExpected: { not: null },
      buildStatus: {
        label: { in: ['완료', '구축완료'] },
      },
    },
    select: {
      endDateExpected: true,
      hospitalCode: true,
      bedCount: true,
    },
    orderBy: { endDateExpected: 'asc' },
  })

  if (projects.length === 0) {
    return NextResponse.json({ months: [] })
  }

  // 서비스 시작월 = endDateExpected 익월
  // 신규 병상 = 각 완료 프로젝트(차수)의 bedCount를 해당 차수의 서비스 시작월에 집계
  // 신규 병원 = 병원별 최초 완료 프로젝트의 서비스 시작월에 1회만 집계 (2차·3차는 병상만 가산)
  const monthMap = new Map<string, { newHospitals: number; newBeds: number }>()
  const seenHospitals = new Set<string>()

  for (const p of projects) {
    const end = p.endDateExpected!
    // 익월 계산
    const d = new Date(end)
    d.setMonth(d.getMonth() + 1)
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

    const entry = monthMap.get(month) ?? { newHospitals: 0, newBeds: 0 }
    if (!seenHospitals.has(p.hospitalCode)) {
      seenHospitals.add(p.hospitalCode)
      entry.newHospitals += 1
    }
    entry.newBeds += p.bedCount ?? 0
    monthMap.set(month, entry)
  }

  // 가장 오래된 월 ~ 현재 월까지 gap 없이 생성
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const allMonthKeys = Array.from(monthMap.keys()).sort()
  const firstMonth = allMonthKeys[0]

  const months: {
    month: string
    label: string
    newHospitals: number
    newBeds: number
    totalHospitals: number
    totalBeds: number
  }[] = []

  let totalHospitals = 0
  let totalBeds = 0

  // firstMonth부터 max(currentMonth, monthMap 마지막 키)까지 순회
  // (endDateExpected 익월을 서비스 시작월로 계산하므로, 당월 완료 프로젝트는 다음 달 버킷에 쌓임)
  const lastMonthInMap = allMonthKeys[allMonthKeys.length - 1]
  const endMonth = currentMonth >= lastMonthInMap ? currentMonth : lastMonthInMap
  const cursor = new Date(`${firstMonth}-01`)
  const endCursor = new Date(`${endMonth}-01`)

  while (cursor <= endCursor) {
    const month = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
    const yy = String(cursor.getFullYear()).slice(2)
    const mm = cursor.getMonth() + 1
    const label = `${yy}년 ${mm}월`

    const entry = monthMap.get(month) ?? { newHospitals: 0, newBeds: 0 }
    totalHospitals += entry.newHospitals
    totalBeds += entry.newBeds

    months.push({
      month,
      label,
      newHospitals: entry.newHospitals,
      newBeds: entry.newBeds,
      totalHospitals,
      totalBeds,
    })

    cursor.setMonth(cursor.getMonth() + 1)
  }

  return NextResponse.json({ months })
}
