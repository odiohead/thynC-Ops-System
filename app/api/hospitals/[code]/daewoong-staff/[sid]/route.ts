import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

type Params = { params: { code: string; sid: string } }

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await prisma.daewoongHospitalAssignment.deleteMany({
    where: { hospitalCode: params.code, assignedUserId: params.sid },
  })
  return NextResponse.json({ success: true })
}
