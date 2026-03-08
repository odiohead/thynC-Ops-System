import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: { code: string; sid: string } }

export async function DELETE(_req: NextRequest, { params }: Params) {
  await prisma.daewoongHospitalAssignment.deleteMany({
    where: { hospitalCode: params.code, staffId: params.sid },
  })
  return NextResponse.json({ success: true })
}
