import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkSalesAccess } from '@/lib/sales'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string } }

/** 대웅 채널 추가 — 기본 '현재 라인'으로 추가하며 기존 현재 라인은 이력으로 전환 */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkSalesAccess(user)
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: params.code }, select: { hospitalCode: true, hospitalName: true } })
  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const officeId = Number.isInteger(body.officeId) ? body.officeId : null
  const repId = Number.isInteger(body.repId) ? body.repId : null
  if (officeId === null && repId === null) return NextResponse.json({ error: '사무소 또는 담당자를 선택해주세요.' }, { status: 400 })

  if (repId !== null) {
    const rep = await prisma.salesRep.findUnique({ where: { id: repId }, select: { officeId: true } })
    if (!rep) return NextResponse.json({ error: '담당자를 찾을 수 없습니다.' }, { status: 400 })
    if (officeId !== null && rep.officeId !== null && rep.officeId !== officeId) {
      return NextResponse.json({ error: '담당자가 선택한 사무소 소속이 아닙니다.' }, { status: 400 })
    }
  }

  const channel = await prisma.$transaction(async (tx) => {
    await tx.hospitalDaewoongChannel.updateMany({
      where: { hospitalCode: params.code, isCurrent: true },
      data: { isCurrent: false },
    })
    return tx.hospitalDaewoongChannel.create({
      data: {
        hospitalCode: params.code,
        officeId,
        repId,
        isCurrent: true,
        note: typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null,
      },
      include: {
        office: { select: { id: true, division: true, name: true } },
        rep: { select: { id: true, name: true, phone: true } },
      },
    })
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'sales_channel',
    resourceId: channel.id,
    resourceLabel: `${hospital.hospitalName} 대웅 채널`,
    after: channel,
  })

  return NextResponse.json({ channel }, { status: 201 })
}
