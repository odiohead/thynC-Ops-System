import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkSalesAccess } from '@/lib/sales'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string; id: string } }

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkSalesAccess(user)
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 })
  const channel = await prisma.hospitalDaewoongChannel.findUnique({ where: { id } })
  if (!channel || channel.hospitalCode !== params.code) return NextResponse.json({ error: '채널을 찾을 수 없습니다.' }, { status: 404 })

  await prisma.hospitalDaewoongChannel.delete({ where: { id } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'DELETE',
    resource: 'sales_channel',
    resourceId: id,
    resourceLabel: `${params.code} 대웅 채널`,
    before: channel,
  })

  return NextResponse.json({ ok: true })
}
