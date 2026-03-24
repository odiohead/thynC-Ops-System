import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

type Params = { params: { code: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const assignments = await prisma.daewoongHospitalAssignment.findMany({
    where: { hospitalCode: params.code },
    include: { assignedUser: true },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ assignments })
}

export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { staffId } = await request.json()
  if (!staffId) return NextResponse.json({ error: 'staffId is required' }, { status: 400 })

  try {
    const assignment = await prisma.daewoongHospitalAssignment.create({
      data: { hospitalCode: params.code, assignedUserId: staffId },
      include: { assignedUser: true },
    })
    return NextResponse.json({ assignment }, { status: 201 })
  } catch {
    return NextResponse.json({ error: '이미 배정된 직원입니다.' }, { status: 409 })
  }
}
