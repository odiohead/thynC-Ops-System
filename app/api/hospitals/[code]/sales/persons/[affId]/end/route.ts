import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { parseDateOnly } from '@/lib/sales'
import { guardAffiliation } from '../../shared'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string; affId: string } }

/** 소속 종료 (퇴직·이동처 불명 — 이력 보존). body: { endedOn? } */
export async function POST(request: NextRequest, { params }: Params) {
  const g = await guardAffiliation(request, params.code, params.affId)
  if ('error' in g) return g.error
  if (!g.affiliation.isCurrent) return NextResponse.json({ error: '이미 종료된 소속입니다.' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const endedOn = parseDateOnly(body.endedOn) ?? new Date()

  const updated = await prisma.personAffiliation.update({
    where: { id: g.affId },
    data: { isCurrent: false, endedOn },
    include: { person: { select: { name: true } } },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(g.user),
    action: 'UPDATE',
    resource: 'sales_person_affiliation',
    resourceId: g.affId,
    resourceLabel: `${updated.person.name} 소속 종료`,
    after: updated,
  })

  return NextResponse.json({ affiliation: updated })
}
