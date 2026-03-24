import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

type Params = { params: { code: string } }

/** DAEWOONG 조직 소속 User 목록 반환 */
export async function GET(_req: NextRequest, { params }: Params) {
  const assignments = await prisma.daewoongHospitalAssignment.findMany({
    where: { hospitalCode: params.code },
    include: {
      assignedUser: {
        select: { id: true, name: true, email: true, phone: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ assignments })
}

export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { userId } = await request.json()
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })

  // DAEWOONG 조직 소속 유저인지 검증
  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    include: { organization: true },
  })
  if (!targetUser) return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 })
  if (targetUser.organization?.code !== 'DAEWOONG') {
    return NextResponse.json({ error: '대웅제약 소속 직원만 배정할 수 있습니다.' }, { status: 400 })
  }

  try {
    const assignment = await prisma.daewoongHospitalAssignment.create({
      data: { hospitalCode: params.code, assignedUserId: userId },
      include: {
        assignedUser: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
    })
    return NextResponse.json({ assignment }, { status: 201 })
  } catch {
    return NextResponse.json({ error: '이미 배정된 직원입니다.' }, { status: 409 })
  }
}
