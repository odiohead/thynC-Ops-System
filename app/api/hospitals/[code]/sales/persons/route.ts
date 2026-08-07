import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { checkSalesAccess, parseDateOnly } from '@/lib/sales'
import { parsePersonBody, parseAffiliationBody, validatePersonGroup } from './shared'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string } }

/** 인물 + 이 병원 소속을 한 번에 등록 (UI는 한 폼) */
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denial = await checkSalesAccess(user, { write: true })
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status })

  const hospital = await prisma.hospital.findUnique({ where: { hospitalCode: params.code }, select: { hospitalCode: true, hospitalName: true } })
  if (!hospital) return NextResponse.json({ error: '병원을 찾을 수 없습니다.' }, { status: 404 })

  const body = await request.json()
  const person = parsePersonBody(body)
  if (!person.name) return NextResponse.json({ error: '이름을 입력해주세요.' }, { status: 400 })
  const groupError = await validatePersonGroup(person.personGroupId)
  if (groupError) return NextResponse.json({ error: groupError }, { status: 400 })
  const affiliation = parseAffiliationBody(body)
  const startedOn = parseDateOnly(body.startedOn)

  const created = await prisma.person.create({
    data: {
      ...person,
      name: person.name,
      affiliations: {
        create: { hospitalCode: params.code, ...affiliation, startedOn, isCurrent: true },
      },
    },
    include: { affiliations: true },
  })

  await logAudit({
    req: request,
    actor: auditActorFromJWT(user),
    action: 'CREATE',
    resource: 'sales_person',
    resourceId: created.id,
    resourceLabel: `${created.name} (${hospital.hospitalName})`,
    after: created,
  })

  return NextResponse.json({ person: created }, { status: 201 })
}
