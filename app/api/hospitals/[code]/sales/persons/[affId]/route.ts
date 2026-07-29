import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { parseDateOnly } from '@/lib/sales'
import { parsePersonBody, parseAffiliationBody, validatePersonGroup, guardAffiliation } from '../shared'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string; affId: string } }

/** 인물 + 소속 동시 수정 (UI는 한 폼) */
export async function PUT(request: NextRequest, { params }: Params) {
  const g = await guardAffiliation(request, params.code, params.affId)
  if ('error' in g) return g.error

  const body = await request.json()
  const person = parsePersonBody(body)
  if (!person.name) return NextResponse.json({ error: '이름을 입력해주세요.' }, { status: 400 })
  const groupError = await validatePersonGroup(person.personGroupId)
  if (groupError) return NextResponse.json({ error: groupError }, { status: 400 })
  const affiliation = parseAffiliationBody(body)
  const startedOn = parseDateOnly(body.startedOn)

  const [updatedPerson, updatedAff] = await prisma.$transaction([
    prisma.person.update({ where: { id: g.affiliation.personId }, data: { ...person, name: person.name } }),
    prisma.personAffiliation.update({ where: { id: g.affId }, data: { ...affiliation, startedOn } }),
  ])

  await logAudit({
    req: request,
    actor: auditActorFromJWT(g.user),
    action: 'UPDATE',
    resource: 'sales_person',
    resourceId: updatedPerson.id,
    resourceLabel: updatedPerson.name,
    after: { person: updatedPerson, affiliation: updatedAff },
  })

  return NextResponse.json({ person: updatedPerson, affiliation: updatedAff })
}

/** 소속 삭제 (오입력 정정용 — 이력 종료는 end 사용). 인물은 다른 소속이 없어도 보존 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const g = await guardAffiliation(request, params.code, params.affId)
  if ('error' in g) return g.error

  const before = await prisma.personAffiliation.findUnique({ where: { id: g.affId }, include: { person: { select: { name: true } } } })
  await prisma.personAffiliation.delete({ where: { id: g.affId } })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(g.user),
    action: 'DELETE',
    resource: 'sales_person_affiliation',
    resourceId: g.affId,
    resourceLabel: before?.person.name ?? String(g.affId),
    before,
  })

  return NextResponse.json({ ok: true })
}
