import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const staff = await prisma.daewoongStaff.findUnique({
    where: { id: params.id },
    include: {
      assignments: {
        include: {
          hospital: { select: { hospitalCode: true, hospitalName: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!staff) return NextResponse.json({ error: '직원을 찾을 수 없습니다.' }, { status: 404 })
  return NextResponse.json({ staff })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { name, email, phoneNumber, branchInfo, etc } = await request.json()
  const staff = await prisma.daewoongStaff.update({
    where: { id: params.id },
    data: { name, email, phoneNumber, branchInfo, etc },
  })
  return NextResponse.json({ staff })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  // 매핑 먼저 삭제 후 직원 삭제
  await prisma.daewoongHospitalAssignment.deleteMany({ where: { staffId: params.id } })
  await prisma.daewoongStaff.delete({ where: { id: params.id } })
  return NextResponse.json({ success: true })
}
