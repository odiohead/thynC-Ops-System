import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const staff = await prisma.daewoongStaff.findMany({
    orderBy: { id: 'asc' },
    include: { _count: { select: { assignments: true } } },
  })
  return NextResponse.json({ staff })
}

export async function POST(request: NextRequest) {
  const { name, email, phoneNumber, branchInfo, etc } = await request.json()

  if (!name || !email) {
    return NextResponse.json({ error: '이름과 이메일은 필수입니다.' }, { status: 400 })
  }

  // 커스텀 ID 생성: 기존 ID에서 숫자 최댓값 + 1, 6자리 zero-padding
  const allIds = await prisma.daewoongStaff.findMany({ select: { id: true } })
  const maxNum = allIds.reduce((max, s) => {
    const match = s.id.match(/^daewoong-(\d+)$/)
    return match ? Math.max(max, parseInt(match[1])) : max
  }, 0)
  const id = `daewoong-${String(maxNum + 1).padStart(6, '0')}`

  const staff = await prisma.daewoongStaff.create({
    data: { id, name, email, phoneNumber, branchInfo, etc },
  })

  return NextResponse.json({ staff }, { status: 201 })
}
