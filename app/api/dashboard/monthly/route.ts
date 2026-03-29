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
      hospital: { select: { introBeds: true } },
    },
  })

  if (projects.length === 0) {
    return NextResponse.json({ months: [] })
  }

  // 서비스 시작월 = endDateExpected 익월
  const monthMap = new Map<string, { newHospitals: number; newBeds: number }>()

  for (const p of projects) {
    const end = p.endDateExpected!
    // 익월 계산
    const d = new Date(end)
    d.setMonth(d.getMonth() + 1)
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

    const entry = monthMap.get(month) ?? { newHospitals: 0, newBeds: 0 }
    entry.newHospitals += 1
    entry.newBeds += p.hospital.introBeds ?? 0
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

  // firstMonth부터 currentMonth까지 순회
  const cursor = new Date(`${firstMonth}-01`)
  const endCursor = new Date(`${currentMonth}-01`)

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
