import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit, auditActorFromJWT } from '@/lib/audit'
import { parseDateOnly } from '@/lib/sales'
import { guardAffiliation, str } from '../../shared'

export const dynamic = 'force-dynamic'

type Params = { params: { code: string; affId: string } }

/**
 * 전원(轉院) 처리 — 액션 1회: 현재 소속 종료 + 대상 병원에 신규 소속 생성 (이력 보존)
 * body: { toHospitalCode, title?, department?, isPrimary?, note?, endedOn?, startedOn? }
 */
export async function POST(request: NextRequest, { params }: Params) {
  const g = await guardAffiliation(request, params.code, params.affId)
  if ('error' in g) return g.error
  if (!g.affiliation.isCurrent) return NextResponse.json({ error: '이미 종료된 소속입니다.' }, { status: 400 })

  const body = await request.json()
  const toHospitalCode = str(body.toHospitalCode)
  if (!toHospitalCode) return NextResponse.json({ error: '전원할 병원을 선택해주세요.' }, { status: 400 })
  if (toHospitalCode === params.code) return NextResponse.json({ error: '같은 병원으로는 전원할 수 없습니다.' }, { status: 400 })
  const target = await prisma.hospital.findUnique({ where: { hospitalCode: toHospitalCode }, select: { hospitalCode: true, hospitalName: true } })
  if (!target) return NextResponse.json({ error: '전원할 병원을 찾을 수 없습니다.' }, { status: 404 })

  const endedOn = parseDateOnly(body.endedOn) ?? new Date()
  const startedOn = parseDateOnly(body.startedOn)

  const [, created] = await prisma.$transaction([
    prisma.personAffiliation.update({
      where: { id: g.affId },
      data: { isCurrent: false, endedOn },
    }),
    prisma.personAffiliation.create({
      data: {
        personId: g.affiliation.personId,
        hospitalCode: toHospitalCode,
        title: str(body.title),
        department: str(body.department),
        isPrimary: body.isPrimary === true,
        note: str(body.note),
        startedOn,
        isCurrent: true,
      },
      include: { person: { select: { name: true } } },
    }),
  ])

  await logAudit({
    req: request,
    actor: auditActorFromJWT(g.user),
    action: 'UPDATE',
    resource: 'sales_person_transfer',
    resourceId: g.affiliation.personId,
    resourceLabel: `${created.person.name}: ${params.code} → ${target.hospitalName}`,
    after: created,
  })

  return NextResponse.json({ affiliation: created })
}
