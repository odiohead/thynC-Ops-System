import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'

type Params = { params: { code: string; sid: string } }

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user || user.role === 'VIEWER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const existing = await prisma.daewoongHospitalAssignment.findFirst({
    where: { hospitalCode: params.code, assignedUserId: params.sid },
    include: { assignedUser: { select: { id: true, name: true, email: true } } },
  })

  await prisma.daewoongHospitalAssignment.deleteMany({
    where: { hospitalCode: params.code, assignedUserId: params.sid },
  })

  if (existing) {
    await logAudit({
      req: request,
      actor: auditActorFromJWT(user),
      action: 'DELETE',
      resource: 'hospital_daewoong_assignment',
      resourceId: `${params.code}/${params.sid}`,
      resourceLabel: `${params.code} ↔ ${existing.assignedUser.name}`,
      before: existing,
    })
  }

  return NextResponse.json({ success: true })
}
