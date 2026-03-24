import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const staff = await prisma.daewoongStaff.findUnique({
    where: { id: params.id },
  })
  if (!staff) return NextResponse.json({ error: '직원을 찾을 수 없습니다.' }, { status: 404 })
  return NextResponse.json({ staff })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { name, email, phoneNumber, branchInfo, etc } = await request.json()
  const staff = await prisma.daewoongStaff.update({
    where: { id: params.id },
    data: { name, email, phoneNumber, branchInfo, etc },
  })
  return NextResponse.json({ staff })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // 매핑 먼저 삭제 후 직원 삭제
  await prisma.daewoongHospitalAssignment.deleteMany({ where: { assignedUserId: params.id } })
  await prisma.daewoongStaff.delete({ where: { id: params.id } })
  return NextResponse.json({ success: true })
}
